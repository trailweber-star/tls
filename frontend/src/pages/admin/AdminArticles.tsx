import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { ImageUploadField } from "../../components/ImageUploadField";
import { articlesApi } from "../../lib/dashboardApi";
import type { AdminArticleDetail, AdminArticleRow, ArticleImportInput } from "../../lib/dashboardApi";

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await articlesApi.list();
      setRows(res.results);
      setDemo(res.demo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the articles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      published: rows.filter((r) => r.status === "published").length,
      draft: rows.filter((r) => r.status === "draft").length,
    }),
    [rows]
  );

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
        <p className="text-[13.5px] text-ink-muted">
          <span className="font-bold text-ink">{counts.published}</span> published
          <span className="mx-2 text-ink-faint">·</span>
          <span className="font-bold text-ink">{counts.draft}</span> draft
        </p>
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
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                          row.status === "published"
                            ? "bg-teal-50 text-teal-700"
                            : "bg-paper-tint text-ink-muted"
                        }`}
                      >
                        {row.status === "published" ? "Published" : "Draft"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[13px] text-ink-muted">{relativeTime(row.updatedAt)}</td>
                    <td className="px-5 py-4 text-[13px] tabular-nums text-ink-muted">{row.viewCount}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditor(row)}
                          disabled={openingId === row.id || busyId === row.id || demo}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50 disabled:opacity-40"
                        >
                          {openingId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" strokeWidth={2.2} />
                          )}
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleStatus(row)}
                          disabled={busyId === row.id || demo}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50 disabled:opacity-40"
                        >
                          {busyId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                          ) : row.status === "published" ? (
                            <EyeOff className="h-3.5 w-3.5" strokeWidth={2.2} />
                          ) : (
                            <Eye className="h-3.5 w-3.5" strokeWidth={2.2} />
                          )}
                          {row.status === "published" ? "Unpublish" : "Publish"}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(row)}
                          disabled={busyId === row.id || demo}
                          aria-label={`Delete ${row.title}`}
                          title="Delete"
                          className="rounded-full border border-line p-2 text-ink-faint transition hover:border-danger/40 hover:bg-danger/5 hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </DashboardShell>
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
    status: article?.status ?? "draft",
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

  const words = form.body.trim() ? form.body.trim().split(/\s+/).length : 0;

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

          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className="text-[12.5px] font-bold text-ink">Body</span>
              <span className="text-[12px] text-ink-faint">
                Markdown or HTML — both work. {words > 0 && `${words} words`}
              </span>
            </span>
            <textarea
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              rows={14}
              placeholder={"## A heading\n\nParagraph text, **bold**, [links](https://example.com) and lists. Paste from anywhere — the formatting is preserved."}
              className={`mt-1.5 font-mono text-[13px] leading-relaxed ${inputClass}`}
            />
          </label>

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

          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="flex flex-col gap-4">
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
                <span className="text-[12.5px] font-bold text-ink">…or paste an image URL</span>
                <input
                  type="url"
                  value={form.heroImageUrl ?? ""}
                  onChange={(e) => set("heroImageUrl", e.target.value)}
                  placeholder="https://…"
                  className={`mt-1.5 ${inputClass}`}
                />
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
