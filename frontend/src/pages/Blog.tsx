import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, BookOpen, Clock, Loader2, Search, User, X } from "lucide-react";
import { HEADER_HEIGHT } from "../components/Header";
import { Seo, ORGANISATION_JSON_LD } from "../components/Seo";
import { formatArticleDate, listArticles } from "../lib/blogApi";
import type { ArticleCard, ArticleList } from "../lib/blogApi";
import heroImg from "../assets/images/hero-clinic.jpg";

const SITE_URL = import.meta.env.VITE_SITE_URL || "https://www.toplocalspecialists.com";

/* ------------------------------------------------------------------ *
 * The guides
 *
 * Laid out like the blog this replaces — a column of articles with a
 * sidebar beside it — because that shape is what the client and their
 * readers already know, and there is nothing wrong with it.
 *
 * What is different is what the sidebar holds. The old one carried
 * WordPress's defaults: a Recent Comments widget on a site with no
 * comments, and a month-by-month archive nobody has ever clicked. This
 * one carries the two things a reader of a healthcare directory
 * actually wants — a search box, and the specialties the articles are
 * filed under, counted so an empty category never appears.
 *
 * Every filter lives in the URL, as on /search, so a category is a
 * shareable link and the back button steps through filters.
 * ------------------------------------------------------------------ */

export default function Blog() {
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag") ?? "";
  const specialty = params.get("specialty") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [data, setData] = useState<ArticleList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /* Typed into, but not yet committed to the URL — so the list does not
     re-fetch on every keystroke and the back button does not fill up
     with half-typed words. */
  const [typed, setTyped] = useState(q);

  useEffect(() => setTyped(q), [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    listArticles({ tag: tag || undefined, specialty: specialty || undefined, q: q || undefined, page })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tag, specialty, q, page]);

  /** One place that writes the URL, so filters can never contradict. */
  function apply(next: { tag?: string; specialty?: string; q?: string; page?: number }) {
    const qs = new URLSearchParams();
    const merged = { tag, specialty, q, page: 1, ...next };
    if (merged.tag) qs.set("tag", merged.tag);
    if (merged.specialty) qs.set("specialty", merged.specialty);
    if (merged.q) qs.set("q", merged.q);
    if (merged.page && merged.page > 1) qs.set("page", String(merged.page));
    setParams(qs);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const filtered = Boolean(tag || specialty || q);
  const heading = useMemo(() => {
    if (q) return `Results for “${q}”`;
    if (data?.specialty) return data.specialty.name;
    if (tag) return tag;
    return "Latest guides";
  }, [q, tag, data?.specialty]);

  return (
    <main className="flex-1 bg-paper">
      <Seo
        title={
          specialty && data?.specialty
            ? `${data.specialty.name} guides`
            : "Health guides — Top Local Specialists"
        }
        description="Plain-English guides to treatments, recovery and choosing private care in the UK, written and checked by verified specialists."
        path="/blog"
        jsonLd={[
          ORGANISATION_JSON_LD,
          {
            "@context": "https://schema.org",
            "@type": "Blog",
            "@id": `${SITE_URL}/blog`,
            name: "Top Local Specialists — Health guides",
            url: `${SITE_URL}/blog`,
            inLanguage: "en-GB",
            publisher: { "@type": "Organization", name: "Top Local Specialists" },
          },
        ]}
      />

      {/* ==================================================== hero */}
      <section
        className="relative overflow-hidden bg-navy-950 text-white"
        style={{ marginTop: -HEADER_HEIGHT, paddingTop: HEADER_HEIGHT }}
      >
        <img src={heroImg} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-20" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-navy-950 via-navy-950/90 to-navy-950/60" />
        <div className="relative mx-auto w-full max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-teal-300 ring-1 ring-white/15">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={2.5} />
            Health guides
          </span>
          <h1 className="mt-5 max-w-[20ch] font-display text-[32px] font-bold leading-[1.1] sm:text-[42px]">
            Written by the people who do the work.
          </h1>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-white/70">
            Treatments, recovery and how private care actually works — in plain English, from verified
            specialists and the clinics they practise in.
          </p>
        </div>
      </section>

      {/* ================================================== body */}
      <div className="mx-auto w-full max-w-[1180px] px-5 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
          {/* ------------------------------------------- articles */}
          <div className="min-w-0">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
              <h2 className="font-display text-[22px] font-bold text-ink">{heading}</h2>
              {data && (
                <p className="text-[13px] text-ink-muted">
                  {data.total} {data.total === 1 ? "guide" : "guides"}
                  {filtered && (
                    <button
                      type="button"
                      onClick={() => apply({ tag: "", specialty: "", q: "" })}
                      className="ml-3 inline-flex items-center gap-1 font-bold text-teal-700 hover:underline"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                      Clear
                    </button>
                  )}
                </p>
              )}
            </div>

            {loading ? (
              <p className="flex items-center gap-2 py-16 text-[14px] text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading guides…
              </p>
            ) : failed ? (
              <p className="rounded-2xl border border-line bg-white p-8 text-[14px] text-ink-muted">
                The guides could not be loaded just now. Please try again shortly.
              </p>
            ) : !data || data.results.length === 0 ? (
              <div className="rounded-2xl border border-line bg-white p-10 text-center">
                <p className="font-display text-[19px] font-bold text-ink">
                  {q ? `Nothing matches “${q}”` : "No guides here yet"}
                </p>
                <p className="mx-auto mt-2 max-w-[46ch] text-[14px] leading-relaxed text-ink-muted">
                  {q
                    ? "Try a condition or a treatment — knee, physiotherapy, recovery."
                    : "New guides are published regularly. Try another category."}
                </p>
                {filtered && (
                  <button
                    type="button"
                    onClick={() => apply({ tag: "", specialty: "", q: "" })}
                    className="mt-5 inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
                  >
                    Show every guide
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {data.results.map((article) => (
                  <ArticleRow key={article.slug} article={article} onTag={(t) => apply({ tag: t, q: "" })} />
                ))}
              </div>
            )}

            {data && data.pageCount > 1 && (
              <nav className="mt-9 flex items-center justify-center gap-2" aria-label="Pages">
                {Array.from({ length: data.pageCount }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => apply({ page: n })}
                    aria-current={n === page ? "page" : undefined}
                    className={`h-10 min-w-10 rounded-xl px-3 text-[13.5px] font-bold transition ${
                      n === page
                        ? "bg-navy-950 text-white"
                        : "border border-line bg-white text-ink hover:border-teal-300 hover:bg-teal-50"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </nav>
            )}
          </div>

          {/* -------------------------------------------- sidebar */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="space-y-5">
              {/* Search first, because it is the only thing on this
                  column that answers a question the reader arrived
                  with. */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  apply({ q: typed.trim(), tag: "", specialty: "" });
                }}
                className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(6,22,38,.04)]"
              >
                <label htmlFor="blog-search" className="text-[12px] font-bold uppercase tracking-[0.1em] text-ink-faint">
                  Search the guides
                </label>
                <div className="mt-2.5 flex gap-2">
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
                      strokeWidth={2.2}
                    />
                    <input
                      id="blog-search"
                      type="search"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder="Knee, recovery, physio…"
                      className="w-full rounded-xl border border-line bg-paper py-2.5 pl-9 pr-3 text-[14px] text-ink outline-none transition placeholder:text-ink-faint focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>
                  <button
                    type="submit"
                    className="shrink-0 rounded-xl bg-navy-950 px-4 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
                  >
                    Go
                  </button>
                </div>
              </form>

              {data && data.categories.length > 0 && (
                <SidebarCard title="Categories">
                  <ul className="-mx-1">
                    {data.categories.map((cat) => (
                      <li key={cat.slug}>
                        <SidebarLink
                          label={cat.name}
                          count={cat.count}
                          active={specialty === cat.slug}
                          onClick={() => apply({ specialty: specialty === cat.slug ? "" : cat.slug, tag: "", q: "" })}
                        />
                        {cat.children.length > 0 && (
                          <ul className="ml-3 border-l border-line-soft pl-2">
                            {cat.children.map((child) => (
                              <li key={child.slug}>
                                <SidebarLink
                                  label={child.name}
                                  count={child.count}
                                  small
                                  active={specialty === child.slug}
                                  onClick={() =>
                                    apply({ specialty: specialty === child.slug ? "" : child.slug, tag: "", q: "" })
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </SidebarCard>
              )}

              {data && data.tags.length > 0 && (
                <SidebarCard title="Topics">
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.slice(0, 12).map((t) => (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => apply({ tag: tag === t.name ? "" : t.name, specialty: "", q: "" })}
                        className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${
                          tag === t.name
                            ? "bg-navy-950 text-white"
                            : "bg-paper-tint text-ink-muted hover:bg-teal-50 hover:text-teal-700"
                        }`}
                      >
                        {t.name}
                      </button>
                    ))}
                  </div>
                </SidebarCard>
              )}

              {data && data.recent.length > 0 && (
                <SidebarCard title="Recently published">
                  <ul className="space-y-3">
                    {data.recent.map((r) => (
                      <li key={r.slug}>
                        <Link
                          to={`/blog/${r.slug}`}
                          className="group block text-[13.5px] font-semibold leading-snug text-ink transition hover:text-teal-700"
                        >
                          {r.title}
                          <span className="mt-0.5 block text-[12px] font-normal text-ink-faint">
                            {formatArticleDate(r.publishedAt)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </SidebarCard>
              )}

              {/* The reason the blog exists on a directory. */}
              <div className="overflow-hidden rounded-2xl bg-navy-950 p-5 text-white">
                <p className="font-display text-[17px] font-bold leading-snug">
                  Ready to speak to someone?
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-white/70">
                  Every specialist here is checked against their regulator before they appear.
                </p>
                <Link
                  to="/search"
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-teal-500 px-4 py-2.5 text-[13px] font-bold text-navy-950 transition hover:bg-teal-400"
                >
                  Find a specialist
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.6} />
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * One article in the list
 *
 * Image on the left where there is one, and the card holds its shape
 * when there is not — an empty grey rectangle where a photograph should
 * be looks worse than a card that was never going to have one.
 * ------------------------------------------------------------------ */

function ArticleRow({ article, onTag }: { article: ArticleCard; onTag: (tag: string) => void }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-line bg-white transition hover:border-teal-300 hover:shadow-[0_18px_40px_-28px_rgba(6,22,38,.45)]">
      <div className={article.heroImageUrl ? "grid sm:grid-cols-[240px_1fr]" : ""}>
        {article.heroImageUrl && (
          <Link to={`/blog/${article.slug}`} className="relative block overflow-hidden bg-paper-tint">
            <img
              src={article.heroImageUrl}
              alt={article.heroImageAlt ?? ""}
              loading="lazy"
              className="h-48 w-full object-cover transition duration-500 group-hover:scale-[1.03] sm:h-full"
            />
            {article.specialty && (
              <span className="absolute left-3 top-3 rounded-full bg-navy-950/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-teal-300 backdrop-blur">
                {article.specialty.name}
              </span>
            )}
          </Link>
        )}

        <div className="p-5 sm:p-6">
          {!article.heroImageUrl && article.specialty && (
            <span className="mb-2.5 inline-block rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-teal-700">
              {article.specialty.name}
            </span>
          )}

          <h3 className="font-display text-[20px] font-bold leading-snug text-ink sm:text-[22px]">
            <Link to={`/blog/${article.slug}`} className="transition hover:text-teal-700">
              {article.title}
            </Link>
          </h3>

          {/* The byline the old blog had, and the one thing a directory
              can put in it that a WordPress blog cannot: the author is a
              clinician with a profile on this site. */}
          <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-faint">
            {article.authorName && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-ink-muted">
                <User className="h-3.5 w-3.5" strokeWidth={2.2} />
                {article.authorName}
              </span>
            )}
            <time dateTime={article.publishedAt}>{formatArticleDate(article.publishedAt)}</time>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" strokeWidth={2.2} />
              {article.readingMinutes} min read
            </span>
          </p>

          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">{article.excerpt}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              to={`/blog/${article.slug}`}
              className="inline-flex items-center gap-2 rounded-full bg-navy-950 px-4 py-2 text-[13px] font-bold text-white transition group-hover:bg-teal-700"
            >
              Continue reading
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={2.6} />
            </Link>
            {article.tags.slice(0, 2).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTag(t)}
                className="rounded-full bg-paper-tint px-2.5 py-1 text-[12px] font-semibold text-ink-muted transition hover:bg-teal-50 hover:text-teal-700"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(6,22,38,.04)]">
      <h2 className="mb-3 text-[12px] font-bold uppercase tracking-[0.1em] text-ink-faint">{title}</h2>
      {children}
    </section>
  );
}

function SidebarLink({
  label,
  count,
  active,
  small,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  small?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition ${
        small ? "text-[13px]" : "text-[13.5px] font-semibold"
      } ${active ? "bg-teal-50 text-teal-700" : "text-ink hover:bg-paper-tint"}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span
        className={`shrink-0 text-[11.5px] font-bold tabular-nums ${
          active ? "text-teal-700" : "text-ink-faint"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
