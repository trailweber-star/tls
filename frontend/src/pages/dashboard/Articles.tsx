import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BookOpen, Clock, ExternalLink, FileText, Loader2, Lock, Plus, X } from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { BodyEditor } from "../../components/BodyEditor";
import { ImageUploadField } from "../../components/ImageUploadField";
import { ApiError, myArticlesApi } from "../../lib/dashboardApi";
import type { MyArticle, MyArticleDetail } from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * Writing for the guides
 *
 * The member's half of the workflow. Two things arrive here: articles
 * they wrote themselves, and articles Top Local Specialists wrote for
 * them to check.
 *
 * The second is the reason this screen is arranged the way it is.
 * "Waiting for you" sits at the top, before anything else, because an
 * article sitting in a clinician's dashboard unread is the whole thing
 * stalled — and nothing goes out under their name until they have been
 * through it.
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

/** What each state means to the person reading it, in their terms. */
const STATE: Record<string, { label: string; tone: string; says: string }> = {
  awaiting_author: {
    label: "Waiting for you",
    tone: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
    says: "Written for you. Read it, change anything, then send it back.",
  },
  changes_requested: {
    label: "Needs a change",
    tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
    says: "Sent back with a note.",
  },
  in_review: {
    label: "With the team",
    tone: "bg-paper-tint text-ink-muted ring-1 ring-line",
    says: "Being checked before it goes live. Nothing for you to do.",
  },
  draft: {
    label: "Your draft",
    tone: "bg-paper-tint text-ink-muted ring-1 ring-line",
    says: "Only you can see this.",
  },
  published: {
    label: "Live",
    tone: "bg-teal-50 text-teal-700 ring-1 ring-teal-100",
    says: "Published on the guides.",
  },
};

const MINE = (s: string) => s === "awaiting_author" || s === "changes_requested" || s === "draft";

export default function DashboardArticles() {
  const [rows, setRows] = useState<MyArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<MyArticleDetail | null>(null);
  const [composing, setComposing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await myArticlesApi.list();
      setRows(res.results);
    } catch (e) {
      // A Basic listing is not an error, it is an upsell.
      if (e instanceof ApiError && e.status === 403) setLocked(true);
      else setError(e instanceof Error ? e.message : "Could not load your articles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(row: MyArticle) {
    setOpeningId(row.id);
    setNote(null);
    try {
      const res = await myArticlesApi.get(row.id);
      setComposing(false);
      setEditing(res.article);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that.");
    } finally {
      setOpeningId(null);
    }
  }

  const waiting = rows.filter((r) => r.status === "awaiting_author" || r.status === "changes_requested");
  const rest = rows.filter((r) => !waiting.includes(r));

  if (locked) {
    return (
      <DashboardShell variant="specialist" title="Write for the guides" icon={BookOpen} eyebrow="Content">
        <Panel>
          <div className="max-w-[58ch]">
            <span className="inline-flex items-center gap-2 rounded-full bg-paper-tint px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
              <Lock className="h-3.5 w-3.5" strokeWidth={2.4} />
              Premium
            </span>
            <h2 className="mt-4 font-display text-[22px] font-bold text-ink">
              Publishing is part of Premium
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">
              Premium members write guides that appear on the public site under their own name, filed
              under their specialty, linked back to their profile. It is the closest thing a directory
              has to letting a clinician explain themselves in their own words — and it is what patients
              read before they choose.
            </p>
            <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">
              If writing is not your thing, the team will draft one for you. You read it, change whatever
              you want, and nothing is published until you say so.
            </p>
            <a
              href="/dashboard/billing"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
            >
              See the plans
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </a>
          </div>
        </Panel>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell variant="specialist" title="Write for the guides" icon={BookOpen} eyebrow="Content">
      {note && (
        <div className="mb-5 flex items-start justify-between gap-3 rounded-xl bg-teal-50 px-4 py-3 text-[13.5px] font-semibold text-teal-800 ring-1 ring-teal-100">
          <span>{note}</span>
          <button type="button" onClick={() => setNote(null)} aria-label="Dismiss">
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-ink-muted">
          Guides appear on the public site under your name, linked to your profile. Everything is read by
          the Top Local Specialists team before it goes live.
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setComposing(true);
          }}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Write one
        </button>
      </div>

      {(composing || editing) && (
        <MemberArticleForm
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

      {/* Before anything else: the ones that cannot move without them. */}
      {waiting.length > 0 && !editing && !composing && (
        <Panel title="Waiting for you" className="mb-5">
          <ul className="space-y-3">
            {waiting.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper-tint/40 px-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="font-bold text-ink">{row.title}</p>
                  <p className="mt-1 text-[12.5px] text-ink-muted">
                    {row.writtenForYou
                      ? "Written for you by the team. Read it, change anything, then send it back."
                      : "Sent back for a change."}
                  </p>
                  {row.reviewNote && (
                    <p className="mt-2 border-l-2 border-teal-500 pl-3 text-[13px] leading-relaxed text-ink">
                      {row.reviewNote}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => open(row)}
                  disabled={openingId === row.id}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full bg-navy-950 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
                >
                  {openingId === row.id && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />}
                  Open it
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Your guides" padded={false}>
        {loading ? (
          <LoadingBlock label="Loading your guides…" />
        ) : error ? (
          <ErrorBlock message={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing written yet"
            body="Write about something patients ask you constantly — that is usually the best first guide. Or ask the team to draft one and you can edit it."
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {rest.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink">{row.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-faint">
                    <span>{STATE[row.status]?.says ?? row.status}</span>
                    {row.status === "published" && (
                      <>
                        <span aria-hidden>·</span>
                        <a
                          href={`/blog/${row.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-teal-700 hover:underline"
                        >
                          Read it
                          <ExternalLink className="h-3 w-3" strokeWidth={2.2} />
                        </a>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{row.viewCount} views</span>
                      </>
                    )}
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" strokeWidth={2.2} />
                      {row.readingMinutes} min
                    </span>
                    <span aria-hidden>·</span>
                    <span>{relativeTime(row.updatedAt)}</span>
                  </p>
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                    STATE[row.status]?.tone ?? "bg-paper-tint text-ink-muted"
                  }`}
                >
                  {STATE[row.status]?.label ?? row.status}
                </span>
                {MINE(row.status) && (
                  <button
                    type="button"
                    onClick={() => open(row)}
                    disabled={openingId === row.id}
                    className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50 disabled:opacity-40"
                  >
                    {openingId === row.id ? "Opening…" : "Edit"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </DashboardShell>
  );
}

/* ------------------------------------------------------------------ *
 * Writing or approving one
 *
 * The same form for both, because the difference between writing an
 * article and approving one somebody drafted for you is which words are
 * already in the box.
 * ------------------------------------------------------------------ */

function MemberArticleForm({
  article,
  onClose,
  onDone,
}: {
  article: MyArticleDetail | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void> | void;
}) {
  const handed = article?.status === "awaiting_author";
  const [form, setForm] = useState({
    title: article?.title ?? "",
    body: article?.body ?? "",
    format: article?.bodyFormat ?? ("auto" as "auto" | "markdown" | "html"),
    excerpt: article?.excerpt ?? "",
    heroImageUrl: article?.heroImageUrl ?? "",
    heroImageAlt: article?.heroImageAlt ?? "",
    specialtySlug: article?.specialtySlug ?? "",
  });
  const [tagText, setTagText] = useState((article?.tags ?? []).join(", "));
  const [saving, setSaving] = useState<null | "draft" | "submit">(null);
  const [problem, setProblem] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(submit: boolean) {
    if (!form.title.trim() || !form.body.trim()) {
      setProblem("A title and something to read are both needed.");
      return;
    }
    setSaving(submit ? "submit" : "draft");
    setProblem(null);
    const payload = {
      title: form.title.trim(),
      body: form.body,
      format: form.format,
      excerpt: form.excerpt.trim() || undefined,
      heroImageUrl: form.heroImageUrl.trim() || undefined,
      heroImageAlt: form.heroImageAlt.trim() || undefined,
      specialtySlug: form.specialtySlug || null,
      tags: tagText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8),
      submit,
    };
    try {
      if (article) await myArticlesApi.update(article.id, payload);
      else await myArticlesApi.create(payload);
      await onDone(
        submit
          ? "Sent to the Top Local Specialists team. They will let you know when it is live."
          : "Saved. Only you can see it."
      );
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Panel
      title={handed ? "Read this through" : article ? "Edit your guide" : "Write a guide"}
      className="mb-5"
      action={
        <button type="button" onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink">
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      }
    >
      <div className="grid gap-4">
        {handed && (
          <p className="rounded-xl bg-sky-50 px-4 py-3 text-[13px] leading-relaxed text-sky-900 ring-1 ring-sky-200">
            The team drafted this for you. Change anything you would put differently — it is your name on
            it. Nothing is published until you send it back and it has been checked.
          </p>
        )}
        {article?.reviewNote && !handed && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
            <span className="font-bold">Asked for:</span> {article.reviewNote}
          </p>
        )}

        <label className="block">
          <span className="text-[12.5px] font-bold text-ink">Title</span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="What patients ask me most about knee replacements"
            className={`mt-1.5 ${inputClass}`}
          />
        </label>

        <BodyEditor
          value={form.body}
          onChange={(next) => set("body", next)}
          format={form.format}
          rows={16}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12.5px] font-bold text-ink">Specialty</span>
            <select
              value={form.specialtySlug}
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
              Where it is filed on the guides page.
            </span>
          </label>
          <label className="block">
            <span className="text-[12.5px] font-bold text-ink">Topics</span>
            <input
              type="text"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="Recovery, Knee"
              className={`mt-1.5 ${inputClass}`}
            />
            <span className="mt-1 block text-[12px] text-ink-faint">Comma separated, up to eight.</span>
          </label>
        </div>

        <div className="rounded-2xl border border-line-soft bg-paper-tint/40 p-4">
          <ImageUploadField
            id="member-article-hero"
            label="Cover image"
            hint="Shown on the card and at the top of your guide. Landscape works best."
            kind="article"
            shape="wide"
            value={form.heroImageUrl}
            onChange={(url) => set("heroImageUrl", url)}
          />
          <label className="mt-4 block">
            <span className="text-[12.5px] font-bold text-ink">Image description</span>
            <input
              type="text"
              value={form.heroImageAlt}
              onChange={(e) => set("heroImageAlt", e.target.value)}
              placeholder="A physiotherapist assessing a patient's knee"
              className={`mt-1.5 ${inputClass}`}
            />
            <span className="mt-1 block text-[12px] text-ink-faint">
              What the picture shows, for people using a screen reader.
            </span>
          </label>
        </div>

        <label className="block">
          <span className="text-[12.5px] font-bold text-ink">Summary</span>
          <textarea
            value={form.excerpt}
            onChange={(e) => set("excerpt", e.target.value)}
            rows={2}
            placeholder="Leave empty and the opening lines are used."
            className={`mt-1.5 ${inputClass}`}
          />
        </label>

        {problem && (
          <p className="rounded-xl bg-danger/10 px-4 py-3 text-[13px] font-semibold text-danger">{problem}</p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={() => save(true)}
            disabled={saving !== null}
            className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {saving === "submit" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
            {handed ? "Approve and send back" : "Send for review"}
          </button>
          <button
            type="button"
            onClick={() => save(false)}
            disabled={saving !== null}
            className="inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50 disabled:opacity-60"
          >
            {saving === "draft" && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
            Save and finish later
          </button>
          <p className="text-[12.5px] text-ink-faint">
            Nothing is published until the team has read it.
          </p>
        </div>
      </div>
    </Panel>
  );
}
