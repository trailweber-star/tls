import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  ClipboardCheck,
  Loader2,
  MoreVertical,
  Send,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { BodyEditor } from "../../components/BodyEditor";
import { ImageUploadField } from "../../components/ImageUploadField";
import { articlesApi, membersApi } from "../../lib/dashboardApi";
import type {
  AdminArticleDetail,
  AdminArticleRow,
  ArticleImportInput,
  ArticleStatus,
  MemberRow,
} from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * Articles
 *
 * The blog's back office. The writing is done elsewhere and arrives
 * here as a paste — markdown or HTML, both work — and this screen
 * exists to make that paste take fifteen seconds rather than be a
 * chore.
 *
 * Paste, give it a title, publish. The server derives the slug, the
 * excerpt, the reading time and the on-page contents, and sanitises the
 * body on the way in.
 *
 * Editing uses the same form as adding, because a screen where "new"
 * and "edit" are two different forms is a screen where one of them
 * quietly loses a field. The difference is which call it makes on save:
 * a new article goes through the importer, an existing one through
 * PATCH, which leaves the slug — a public URL somebody may have shared
 * — untouched however much the title changes.
 * ------------------------------------------------------------------ */

const SPECIALTIES = [
  { slug: "", name: "No specialty" },
  { slug: "orthopaedics", name: "Orthopaedics" },
  { slug: "physiotherapy", name: "Physiotherapy" },
  { slug: "dentistry", name: "Dentistry" },
  { slug: "aesthetics-specialists", name: "Aesthetics" },
  { slug: "ent", name: "ENT" },
  { slug: "gynaecology", name: "Gynaecology" },
];

const inputClass =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20";

/* Five states, and the two that matter most are the two that say who is
   being waited on. Everything on this screen is arranged around that
   question. */
const STATUS: Record<ArticleStatus, { label: string; tone: string; blurb: string }> = {
  in_review: {
    label: "Needs review",
    tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    blurb: "Waiting on you",
  },
  awaiting_author: {
    label: "With the member",
    tone: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
    blurb: "Waiting on them to read and edit",
  },
  changes_requested: {
    label: "Changes asked for",
    tone: "bg-paper-tint text-ink-muted ring-1 ring-line",
    blurb: "Sent back — waiting on them",
  },
  draft: { label: "Draft", tone: "bg-paper-tint text-ink-muted ring-1 ring-line", blurb: "Not sent anywhere yet" },
  published: { label: "Published", tone: "bg-teal-50 text-teal-700 ring-1 ring-teal-100", blurb: "Live on /blog" },
};

const TABS: { key: string; label: string }[] = [
  { key: "", label: "Everything" },
  { key: "in_review", label: "Needs review" },
  { key: "awaiting_author", label: "With members" },
  { key: "changes_requested", label: "Sent back" },
  { key: "draft", label: "Drafts" },
  { key: "published", label: "Published" },
];

export default function AdminArticles() {
  const [rows, setRows] = useState<AdminArticleRow[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<AdminArticleDetail | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reviewing, setReviewing] = useState<AdminArticleRow | null>(null);
  const [assigning, setAssigning] = useState<AdminArticleRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await articlesApi.list(tab || undefined);
      setRows(res.results);
      setCounts(res.counts ?? {});
      setDemo(res.demo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the articles.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The list deliberately carries no bodies, so opening the editor is a
     fetch. Showing the spinner on the row that was clicked, rather than
     on the page, keeps the table readable while it happens. */
  async function openEditor(row: AdminArticleRow) {
    setOpeningId(row.id);
    setError(null);
    setNote(null);
    try {
      const res = await articlesApi.get(row.id);
      setComposing(false);
      setEditing(res.article);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that article.");
    } finally {
      setOpeningId(null);
    }
  }

  /* Only for articles with no member behind them. Anything that came
     through the queue is published by decide(), which records who
     reviewed it and when — a fact worth having the day somebody asks
     why a clinical claim went out. */
  async function toggleStatus(row: AdminArticleRow) {
    setBusyId(row.id);
    setNote(null);
    try {
      const next = row.status === "published" ? "draft" : "published";
      await articlesApi.update(row.id, { status: next });
      setNote(next === "published" ? `“${row.title}” is live on /blog.` : `“${row.title}” is back to draft.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setBusyId(null);
    }
  }

  async function decide(row: AdminArticleRow, decision: "publish" | "changes", reviewNote?: string) {
    setBusyId(row.id);
    setNote(null);
    try {
      await articlesApi.review(row.id, decision, reviewNote);
      setReviewing(null);
      setNote(
        decision === "publish"
          ? `“${row.title}” is live on /blog.`
          : `Sent back to ${row.author?.fullName ?? "the author"} with your note.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setBusyId(null);
    }
  }

  async function handOff(row: AdminArticleRow, specialistId: string, message: string, who: string) {
    setBusyId(row.id);
    setNote(null);
    try {
      await articlesApi.assign(row.id, specialistId, message);
      setAssigning(null);
      setNote(`Sent to ${who}. They will be told, and it stays unpublished until they have read it.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: AdminArticleRow) {
    // Deleting an article deletes a URL somebody may have shared, so the
    // confirmation names the article rather than asking "are you sure?".
    if (!window.confirm(`Delete “${row.title}”? The page at /blog/${row.slug} will stop working.`)) {
      return;
    }
    setBusyId(row.id);
    try {
      await articlesApi.remove(row.id);
      if (editing?.id === row.id) setEditing(null);
      setNote(`Deleted “${row.title}”.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <DashboardShell variant="admin" title="Articles" icon={BookOpen} eyebrow="Blog">
      {demo && (
        <Panel className="mb-5">
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            This server is running on demo data, so the three sample guides are read-only. Adding and
            editing need a database — run{" "}
            <code className="rounded bg-paper-muted px-1.5 py-0.5">npm run db:migrate</code> and restart
            with a <code className="rounded bg-paper-muted px-1.5 py-0.5">DATABASE_URL</code>.
          </p>
        </Panel>
      )}

      {note && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-xl bg-teal-50 px-4 py-3 text-[13.5px] font-semibold text-teal-800 ring-1 ring-teal-100">
          <span>{note}</span>
          <button type="button" onClick={() => setNote(null)} aria-label="Dismiss">
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => {
            const n = t.key ? (counts[t.key] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0);
            if (t.key && n === 0 && tab !== t.key) return null;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-bold transition ${
                  tab === t.key
                    ? "bg-navy-950 text-white"
                    : "border border-line bg-white text-ink-muted hover:border-teal-300 hover:bg-teal-50"
                }`}
              >
                {t.label}
                <span
                  className={`rounded-full px-1.5 text-[11.5px] tabular-nums ${
                    tab === t.key ? "bg-white/15" : "bg-paper-tint text-ink-faint"
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/blog"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50"
          >
            View the blog
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} />
          </a>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setComposing(true);
            }}
            disabled={demo}
            className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            New article
          </button>
        </div>
      </div>

      {(composing || editing) && (
        <ArticleForm
          key={editing?.id ?? "new"}
          article={editing}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
          onDone={async (message) => {
            setComposing(false);
            setEditing(null);
            setNote(message);
            await load();
          }}
        />
      )}

      <Panel title="All articles" padded={false}>
        {loading ? (
          <LoadingBlock label="Loading articles…" />
        ) : error ? (
          <ErrorBlock message={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No articles yet"
            body="Write or paste an article to get started. The slug, excerpt, reading time and contents list are worked out for you."
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-faint">
                  <th className="px-5 py-3">Article</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Updated</th>
                  <th className="px-5 py-3">Views</th>
                  <th className="relative px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-b border-line-soft last:border-0 ${
                      editing?.id === row.id ? "bg-teal-50/50" : ""
                    }`}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        {row.heroImageUrl ? (
                          <img
                            src={row.heroImageUrl}
                            alt=""
                            className="h-12 w-16 shrink-0 rounded-lg object-cover ring-1 ring-line"
                          />
                        ) : (
                          <span
                            title="No cover image"
                            className="grid h-12 w-16 shrink-0 place-items-center rounded-lg bg-paper-tint text-[10px] font-bold uppercase tracking-wide text-ink-faint ring-1 ring-line"
                          >
                            No cover
                          </span>
                        )}
                        <div className="min-w-0">
                          {/* The title opens the editor. Clicking a title
                              to edit it is what everybody tries first,
                              and the public page is one click away on
                              the slug underneath. */}
                          <button
                            type="button"
                            onClick={() => openEditor(row)}
                            disabled={demo}
                            className="text-left font-bold text-ink transition hover:text-teal-700 disabled:cursor-not-allowed disabled:hover:text-ink"
                          >
                            {row.title}
                          </button>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-faint">
                            <a
                              href={`/blog/${row.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 hover:text-teal-700"
                            >
                              /blog/{row.slug}
                              <ExternalLink className="h-3 w-3" strokeWidth={2.2} />
                            </a>
                            <span aria-hidden>·</span>
                            <span>{row.readingMinutes} min</span>
                            {row.author && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="font-semibold text-ink-muted">by {row.author.fullName}</span>
                              </>
                            )}
                            {row.tags.slice(0, 2).map((t) => (
                              <span key={t} className="rounded-full bg-paper-muted px-2 py-0.5 font-semibold">
                                {t}
                              </span>
                            ))}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                          STATUS[row.status]?.tone ?? "bg-paper-tint text-ink-muted"
                        }`}
                      >
                        {STATUS[row.status]?.label ?? row.status}
                      </span>
                      {row.status === "in_review" && row.submittedAt && (
                        <span className="mt-1 block text-[11.5px] text-ink-faint">
                          sent {relativeTime(row.submittedAt)}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-[13px] text-ink-muted">{relativeTime(row.updatedAt)}</td>
                    <td className="px-5 py-4 text-[13px] tabular-nums text-ink-muted">{row.viewCount}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end">
                        <RowMenu
                          row={row}
                          disabled={demo}
                          busy={busyId === row.id || openingId === row.id}
                          onEdit={() => openEditor(row)}
                          onToggle={() => toggleStatus(row)}
                          onDelete={() => remove(row)}
                          onReview={() => setReviewing(row)}
                          onAssign={() => setAssigning(row)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {reviewing && (
        <ReviewDialog
          row={reviewing}
          busy={busyId === reviewing.id}
          onClose={() => setReviewing(null)}
          onDecide={(decision, reviewNote) => decide(reviewing, decision, reviewNote)}
        />
      )}

      {assigning && (
        <AssignDialog
          row={assigning}
          busy={busyId === assigning.id}
          onClose={() => setAssigning(null)}
          onSend={(specialistId, message, who) => handOff(assigning, specialistId, message, who)}
        />
      )}
    </DashboardShell>
  );
}

/* ------------------------------------------------------------------ *
 * The decision at the end of the queue
 *
 * Publish, or send it back with a note. The note is mandatory on the
 * way back and the button says so before it is clicked, because
 * "changes requested" with nothing named is a rejection the member
 * cannot act on — and they will simply resubmit the same article.
 * ------------------------------------------------------------------ */

function ReviewDialog({
  row,
  busy,
  onClose,
  onDecide,
}: {
  row: AdminArticleRow;
  busy: boolean;
  onClose: () => void;
  onDecide: (decision: "publish" | "changes", note?: string) => void;
}) {
  const [note, setNote] = useState("");

  return (
    <Dialog title="Review this article" onClose={onClose}>
      <p className="text-[13.5px] leading-relaxed text-ink-muted">
        <span className="font-bold text-ink">“{row.title}”</span>
        {row.author ? ` by ${row.author.fullName}` : ""}
        {row.submittedAt ? `, submitted ${relativeTime(row.submittedAt)}` : ""}.
      </p>
      <a
        href={`/blog/${row.slug}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-bold text-teal-700 hover:underline"
      >
        Read it as a patient would
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.2} />
      </a>

      <label className="mt-5 block">
        <span className="text-[12.5px] font-bold text-ink">
          What needs changing? <span className="font-semibold text-ink-faint">— only if sending it back</span>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder="Be specific. The member reads this word for word and it is the only thing they have to go on."
          className={`mt-1.5 ${inputClass}`}
        />
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("publish")}
          className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
          Publish it
        </button>
        <button
          type="button"
          disabled={busy || !note.trim()}
          title={note.trim() ? undefined : "Say what needs changing first"}
          onClick={() => onDecide("changes", note.trim())}
          className="rounded-full border border-line px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send back for changes
        </button>
        <button type="button" onClick={onClose} className="text-[13px] font-semibold text-ink-faint hover:text-ink">
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Handing a draft to the person it is about
 * ------------------------------------------------------------------ */

function AssignDialog({
  row,
  busy,
  onClose,
  onSend,
}: {
  row: AdminArticleRow;
  busy: boolean;
  onClose: () => void;
  onSend: (specialistId: string, note: string, who: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberRow[]>([]);
  const [picked, setPicked] = useState<MemberRow | null>(null);
  const [message, setMessage] = useState(
    "Drafted this for you — please read it through and change anything you would put differently. Nothing goes out until you have approved it."
  );
  const [searching, setSearching] = useState(false);

  /* Debounced, because this searches the whole membership and a request
     per keystroke is a request per keystroke. */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      membersApi
        .list({ q, pageSize: 8 })
        .then((res) => setResults(res.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <Dialog title="Send this to a member" onClose={onClose}>
      <p className="text-[13.5px] leading-relaxed text-ink-muted">
        <span className="font-bold text-ink">“{row.title}”</span> will appear in their dashboard to read and
        edit. It stays unpublished until they approve it and you review what comes back.
      </p>

      {picked ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3">
          <span className="text-[13.5px] font-bold text-ink">{picked.fullName}</span>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="text-[12.5px] font-bold text-teal-700 hover:underline"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <label className="block">
            <span className="text-[12.5px] font-bold text-ink">Which member?</span>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Start typing a name"
              className={`mt-1.5 ${inputClass}`}
            />
          </label>
          {searching && <p className="mt-2 text-[12.5px] text-ink-faint">Searching…</p>}
          {results.length > 0 && (
            <ul className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-line">
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(m)}
                    className="flex w-full items-center justify-between gap-3 border-b border-line-soft px-3.5 py-2.5 text-left transition last:border-0 hover:bg-paper-tint"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-bold text-ink">{m.fullName}</span>
                      <span className="block truncate text-[12px] text-ink-faint">
                        {m.specialty ?? "No specialty"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="mt-4 block">
        <span className="text-[12.5px] font-bold text-ink">A note for them</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          className={`mt-1.5 ${inputClass}`}
        />
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          disabled={busy || !picked}
          onClick={() => picked && onSend(picked.id, message.trim(), picked.fullName)}
          className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
          Send it
        </button>
        <button type="button" onClick={onClose} className="text-[13px] font-semibold text-ink-faint hover:text-ink">
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

/** A centred panel over the page. Escape and the backdrop both close it. */
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-navy-950/45 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[88vh] w-full max-w-[520px] overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-display text-[19px] font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink">
            <X className="h-4.5 w-4.5" strokeWidth={2.2} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ *
 * Row actions
 *
 * Three buttons per row pushed the table past the width it had and left
 * the title squeezed into a column too narrow to read. They live behind
 * one menu instead: the row stays legible, and the actions are where
 * everybody already looks for them.
 * ------------------------------------------------------------------ */

function RowMenu({
  row,
  disabled,
  busy,
  onEdit,
  onToggle,
  onDelete,
  onReview,
  onAssign,
}: {
  row: AdminArticleRow;
  disabled: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onReview: () => void;
  onAssign: () => void;
}) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const open = at !== null;
  const button = useRef<HTMLButtonElement>(null);

  /* Positioned against the viewport and rendered at the end of the
     document rather than inside the row.

     The table sits in a horizontally scrolling container, and a
     scrolling container clips its children in BOTH directions — so a
     menu positioned inside one is cut off at the container's edge. On
     the last row that clipped away the entire menu: the button worked,
     the menu opened, and nothing appeared. A portal has no such
     container to be trapped in. */
  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const MENU_HEIGHT = 190;
    const below = window.innerHeight - r.bottom;
    setAt({
      // Flips above the button when there is not room under it.
      top: below < MENU_HEIGHT ? r.top - Math.min(MENU_HEIGHT, r.top - 8) - 6 : r.bottom + 6,
      right: Math.max(8, window.innerWidth - r.right),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      if (!button.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("[data-row-menu]")) {
        setAt(null);
      }
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") setAt(null);
    }
    /* A fixed menu does not move with the page, so it is re-placed
       against the button whenever anything scrolls — including the
       table's own sideways scroll, which on a phone is how you reach
       this button in the first place. Closing on scroll instead looked
       like the menu never opened. */
    const follow = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setAt(null);
      else place();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open, place]);

  const item =
    "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold text-ink transition hover:bg-paper-tint disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => (open ? setAt(null) : place())}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${row.title}`}
        className={`grid h-9 w-9 place-items-center rounded-full border transition disabled:opacity-40 ${
          open ? "border-teal-300 bg-teal-50 text-teal-700" : "border-line text-ink-muted hover:bg-paper-tint"
        }`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
        ) : (
          <MoreVertical className="h-4 w-4" strokeWidth={2.2} />
        )}
      </button>

      {at &&
        createPortal(
          <div
            role="menu"
            data-row-menu
            style={{ position: "fixed", top: at.top, right: at.right }}
            className="z-50 w-48 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-xl shadow-navy-950/15"
          >
            {row.status === "in_review" && (
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setAt(null);
                  onReview();
                }}
                className={`${item} text-teal-700`}
              >
                <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={2.2} />
                Review it
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setAt(null);
                onEdit();
              }}
              className={item}
            >
              <Pencil className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.2} />
              Edit
            </button>
            {(row.status === "draft" || row.status === "awaiting_author") && (
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setAt(null);
                  onAssign();
                }}
                className={item}
              >
                <Send className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.2} />
                {row.status === "awaiting_author" ? "Send to someone else" : "Send to a member"}
              </button>
            )}
            {(row.status === "published" || (row.status === "draft" && !row.author)) && (
              <button
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => {
                  setAt(null);
                  onToggle();
                }}
                className={item}
              >
                {row.status === "published" ? (
                  <EyeOff className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.2} />
                ) : (
                  <Eye className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.2} />
                )}
                {row.status === "published" ? "Unpublish" : "Publish"}
              </button>
            )}
            <a
              role="menuitem"
              href={`/blog/${row.slug}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setAt(null)}
              className={item}
            >
              <ExternalLink className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2.2} />
              View on the site
            </a>
            <div className="my-1 border-t border-line-soft" />
            <button
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setAt(null);
                onDelete();
              }}
              className={`${item} text-danger hover:bg-danger/5`}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              Delete
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The form — one form, two jobs
 * ------------------------------------------------------------------ */

function ArticleForm({
  article,
  onClose,
  onDone,
}: {
  /** Null when adding; the loaded article when editing. */
  article: AdminArticleDetail | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void> | void;
}) {
  const isEdit = Boolean(article);
  const panelRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<ArticleImportInput>(() => ({
    title: article?.title ?? "",
    body: article?.body ?? "",
    format: article?.bodyFormat ?? "auto",
    /* The importer only knows draft and published; the workflow states
       are set by assign() and review(), never by this form. */
    status: article?.status === "published" ? "published" : "draft",
    tags: article?.tags ?? [],
    excerpt: article?.excerpt ?? "",
    heroImageUrl: article?.heroImageUrl ?? "",
    heroImageAlt: article?.heroImageAlt ?? "",
    specialtySlug: article?.specialtySlug ?? "",
    source: "abun",
  }));
  const [tagText, setTagText] = useState((article?.tags ?? []).join(", "));
  const [saving, setSaving] = useState<null | "draft" | "published">(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Opened from a row further down the table, the form would otherwise
  // appear off-screen and look like nothing happened.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  function set<K extends keyof ArticleImportInput>(key: K, value: ArticleImportInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(status: "draft" | "published") {
    if (!form.title.trim() || !form.body.trim()) {
      setProblem("A title and a body are both needed.");
      return;
    }
    setSaving(status);
    setProblem(null);
    const tags = tagText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);

    try {
      if (article) {
        /* PATCH rather than a re-import: the slug stays as it is, which
           is the whole point — an edited title must not break a link
           somebody already shared. */
        await articlesApi.update(article.id, {
          title: form.title.trim(),
          body: form.body,
          format: form.format ?? "auto",
          status,
          tags,
          specialtySlug: form.specialtySlug || null,
          heroImageUrl: form.heroImageUrl?.trim() ?? "",
          heroImageAlt: form.heroImageAlt?.trim() ?? "",
          excerpt: form.excerpt?.trim() ?? "",
        });
        await onDone(
          status === "published"
            ? `Saved and published “${form.title.trim()}”.`
            : `Saved “${form.title.trim()}” as a draft.`
        );
        return;
      }

      const res = await articlesApi.import({
        ...form,
        status,
        tags,
        specialtySlug: form.specialtySlug || undefined,
        heroImageUrl: form.heroImageUrl?.trim() || undefined,
        excerpt: form.excerpt?.trim() || undefined,
        // The title is the stable reference: re-pasting an edited
        // version of the same article updates it rather than creating a
        // near-duplicate with a "-2" slug.
        sourceRef: form.title.trim().toLowerCase().slice(0, 180),
      });
      await onDone(
        res.created
          ? `${status === "published" ? "Published" : "Saved as draft"}: “${res.article.title}”.`
          : `Updated “${res.article.title}”.`
      );
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div ref={panelRef} className="scroll-mt-6">
      <Panel
        title={isEdit ? "Edit article" : "Add an article"}
        className="mb-5"
        action={
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink">
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        }
      >
        <div className="grid gap-4">
          {isEdit && article && (
            <p className="rounded-xl bg-paper-tint px-4 py-3 text-[12.5px] text-ink-muted">
              Published at{" "}
              <a
                href={`/blog/${article.slug}`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-teal-700 hover:underline"
              >
                /blog/{article.slug}
              </a>
              . That address stays the same however you change the title, so any link already shared keeps
              working.
            </p>
          )}

          <label className="block">
            <span className="text-[12.5px] font-bold text-ink">Title</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="What to expect after a knee replacement"
              className={`mt-1.5 ${inputClass}`}
            />
          </label>

          <BodyEditor
            value={form.body}
            onChange={(next) => set("body", next)}
            format={form.format ?? "auto"}
            rows={16}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[12.5px] font-bold text-ink">Tags</span>
              <input
                type="text"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                placeholder="Recovery, Orthopaedics"
                className={`mt-1.5 ${inputClass}`}
              />
              <span className="mt-1 block text-[12px] text-ink-faint">Comma separated, up to eight.</span>
            </label>

            <label className="block">
              <span className="text-[12.5px] font-bold text-ink">Specialty</span>
              <select
                value={form.specialtySlug ?? ""}
                onChange={(e) => set("specialtySlug", e.target.value)}
                className={`mt-1.5 ${inputClass}`}
              >
                {SPECIALTIES.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[12px] text-ink-faint">
                Links the article to that part of the directory.
              </span>
            </label>
          </div>

          {/* The cover gets a full row of its own. Squeezed into half the
              width, the drop zone, the button and its hint stacked into
              a column too narrow for any of them to read properly. */}
          <div className="rounded-2xl border border-line-soft bg-paper-tint/40 p-4">
            {/* Uploaded rather than pasted. An article arrives as words,
                not as a hosted image, and asking somebody to find a URL
                for a picture sitting in their downloads folder is how
                every article ends up without one. */}
            <ImageUploadField
              id="article-hero"
              label="Cover image"
              hint="Shown on the card and at the top of the article. Landscape works best."
              kind="article"
              shape="wide"
              value={form.heroImageUrl ?? ""}
              onChange={(url) => set("heroImageUrl", url)}
            />
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-[12.5px] font-bold text-ink">Image description</span>
                <input
                  type="text"
                  value={form.heroImageAlt ?? ""}
                  onChange={(e) => set("heroImageAlt", e.target.value)}
                  placeholder="A physiotherapist supporting a patient"
                  className={`mt-1.5 ${inputClass}`}
                />
                <span className="mt-1 block text-[12px] text-ink-faint">
                  What the picture shows, for screen readers and for Google.
                </span>
              </label>
              <label className="block">
                <span className="text-[12.5px] font-bold text-ink">…or paste an image address</span>
                <input
                  type="text"
                  value={form.heroImageUrl ?? ""}
                  onChange={(e) => set("heroImageUrl", e.target.value)}
                  placeholder="example.com/photo.jpg"
                  className={`mt-1.5 ${inputClass}`}
                />
                <span className="mt-1 block text-[12px] text-ink-faint">
                  Only if the picture is already online somewhere.
                </span>
              </label>
            </div>
          </div>

          <label className="block">
            <span className="text-[12.5px] font-bold text-ink">Summary</span>
            <textarea
              value={form.excerpt ?? ""}
              onChange={(e) => set("excerpt", e.target.value)}
              rows={2}
              placeholder="Leave empty and the first lines of the article are used."
              className={`mt-1.5 ${inputClass}`}
            />
          </label>

          {problem && (
            <p className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">{problem}</p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => submit("published")}
              disabled={saving !== null}
              className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
            >
              {saving === "published" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
              {isEdit && article?.status === "published" ? "Save changes" : "Publish now"}
            </button>
            <button
              type="button"
              onClick={() => submit("draft")}
              disabled={saving !== null}
              className="inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50 disabled:opacity-60"
            >
              {saving === "draft" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
              Save as draft
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving !== null}
              className="text-[13px] font-semibold text-ink-faint transition hover:text-ink disabled:opacity-60"
            >
              Cancel
            </button>
            <p className="text-[12.5px] text-ink-faint">
              {isEdit
                ? "The reading time and contents list are worked out again from the body."
                : "The slug, reading time and contents list are worked out from the body."}
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
