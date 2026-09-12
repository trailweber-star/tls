import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { DashboardShell, Panel } from "../../components/DashboardShell";
import { EmptyState, ErrorBlock, LoadingBlock, relativeTime } from "../../components/dashboard/ui";
import { articlesApi } from "../../lib/dashboardApi";
import type { AdminArticleRow, ArticleImportInput } from "../../lib/dashboardApi";

/* ------------------------------------------------------------------ *
 * Articles
 *
 * The blog's back office. Abun generates the writing and has no API,
 * webhook or Zapier action to hand it over with — its integrations are
 * WordPress, Webflow, Wix, Shopify and Ghost, none of which this site
 * is — so the handover is a paste, and this screen exists to make that
 * paste take fifteen seconds rather than be a chore.
 *
 * Paste the markdown Abun exports, give it a title, publish. The server
 * derives the slug, the excerpt, the reading time and the on-page
 * contents, and sanitises the body on the way in. Nothing here has to
 * know whether the body was markdown or HTML.
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
            This server is running on demo data, so the three sample guides are read-only. Importing
            needs a database — run <code className="rounded bg-paper-muted px-1.5 py-0.5">npm run db:migrate</code>{" "}
            and restart with a <code className="rounded bg-paper-muted px-1.5 py-0.5">DATABASE_URL</code>.
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
            onClick={() => setComposing(true)}
            disabled={demo}
            className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Paste from Abun
          </button>
        </div>
      </div>

      {composing && (
        <ImportForm
          onClose={() => setComposing(false)}
          onDone={async (message) => {
            setComposing(false);
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
            body="Generate an article in Abun, copy its markdown, and paste it here. The slug, excerpt and reading time are worked out for you."
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
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
                  <tr key={row.id} className="border-b border-line-soft last:border-0">
                    <td className="px-5 py-4">
                      <a
                        href={`/blog/${row.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold text-ink hover:text-teal-700"
                      >
                        {row.title}
                      </a>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-faint">
                        <span>/blog/{row.slug}</span>
                        <span aria-hidden>·</span>
                        <span>{row.readingMinutes} min</span>
                        {row.tags.slice(0, 2).map((t) => (
                          <span key={t} className="rounded-full bg-paper-muted px-2 py-0.5 font-semibold">
                            {t}
                          </span>
                        ))}
                      </p>
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
 * The paste form
 * ------------------------------------------------------------------ */

function ImportForm({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => Promise<void> | void;
}) {
  const [form, setForm] = useState<ArticleImportInput>({
    title: "",
    body: "",
    format: "auto",
    status: "draft",
    tags: [],
    source: "abun",
  });
  const [tagText, setTagText] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const words = form.body.trim() ? form.body.trim().split(/\s+/).length : 0;

  function set<K extends keyof ArticleImportInput>(key: K, value: ArticleImportInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(status: "draft" | "published") {
    if (!form.title.trim() || !form.body.trim()) {
      setProblem("A title and a body are both needed.");
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const tags = tagText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8);
      const res = await articlesApi.import({
        ...form,
        status,
        tags,
        specialtySlug: form.specialtySlug || undefined,
        heroImageUrl: form.heroImageUrl?.trim() || undefined,
        excerpt: form.excerpt?.trim() || undefined,
        // The Abun title is the stable reference: re-pasting an edited
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
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Paste an article from Abun"
      className="mb-5"
      action={
        <button type="button" onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink">
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      }
    >
      <div className="grid gap-4">
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
            placeholder={"## A heading\n\nParagraph text, **bold**, [links](https://example.com) and lists — paste exactly what Abun gives you."}
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
          <label className="block">
            <span className="text-[12.5px] font-bold text-ink">Hero image URL</span>
            <input
              type="url"
              value={form.heroImageUrl ?? ""}
              onChange={(e) => set("heroImageUrl", e.target.value)}
              placeholder="https://… or /images/…"
              className={`mt-1.5 ${inputClass}`}
            />
          </label>
          <label className="block">
            <span className="text-[12.5px] font-bold text-ink">Image description</span>
            <input
              type="text"
              value={form.heroImageAlt ?? ""}
              onChange={(e) => set("heroImageAlt", e.target.value)}
              placeholder="A physiotherapist supporting a patient"
              className={`mt-1.5 ${inputClass}`}
            />
          </label>
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
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />}
            Publish now
          </button>
          <button
            type="button"
            onClick={() => submit("draft")}
            disabled={saving}
            className="rounded-full border border-line px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50 disabled:opacity-60"
          >
            Save as draft
          </button>
          <p className="text-[12.5px] text-ink-faint">
            The slug, reading time and contents list are worked out from the body.
          </p>
        </div>
      </div>
    </Panel>
  );
}
