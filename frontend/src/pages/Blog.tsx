import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, BookOpen, Clock, Loader2 } from "lucide-react";
import { HEADER_HEIGHT } from "../components/Header";
import { Seo, ORGANISATION_JSON_LD } from "../components/Seo";
import { formatArticleDate, listArticles } from "../lib/blogApi";
import type { ArticleCard, ArticleList } from "../lib/blogApi";
import heroImg from "../assets/images/hero-clinic.jpg";

const SITE_URL = import.meta.env.VITE_SITE_URL || "https://www.toplocalspecialists.com";

/* ------------------------------------------------------------------ *
 * The blog
 *
 * Articles are imported through the admin screen and rendered in this
 * site's own clothes rather than in a syndicated widget — same navy hero, same teal
 * accent, same card geometry as the directory, so a reader who arrives
 * from Google lands somewhere that plainly belongs to the site they are
 * about to be asked to trust.
 *
 * The filter state lives in the URL, as it does on /search, so a tag is
 * a shareable link and the back button steps through filters.
 * ------------------------------------------------------------------ */

export default function Blog() {
  const [params, setParams] = useSearchParams();
  const tag = params.get("tag") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [data, setData] = useState<ArticleList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    listArticles({ tag: tag || undefined, page })
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
  }, [tag, page]);

  function setTag(next: string) {
    const qs = new URLSearchParams();
    if (next) qs.set("tag", next);
    setParams(qs);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToPage(next: number) {
    const qs = new URLSearchParams(params);
    if (next > 1) qs.set("page", String(next));
    else qs.delete("page");
    setParams(qs);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const articles = data?.results ?? [];
  // The newest article leads the page at full width. A grid of equal
  // cards gives a reader no way in; one lead does.
  const [lead, ...rest] = page === 1 && !tag ? articles : [];
  const grid = page === 1 && !tag ? rest : articles;

  return (
    <main className="flex-1 bg-paper">
      {/* A tag or a page-two view is a near-duplicate of this page with
          a subset of the same cards. Both stay crawlable — the links on
          them lead to articles — but the canonical points home and they
          are kept out of the index, which is what stops a blog of nine
          guides competing with itself across thirty thin URLs. */}
      <Seo
        title={tag ? `${tag} guides` : "Health Guides & Articles"}
        description={
          tag
            ? `Guides about ${tag.toLowerCase()} — treatments, recovery and choosing a specialist, written in plain English by the Top Local Specialists team.`
            : "Plain-English guides to treatments, recovery and choosing a private specialist in the UK — written and reviewed by the Top Local Specialists team."
        }
        path="/blog"
        noIndex={Boolean(tag) || page > 1}
        jsonLd={[
          ORGANISATION_JSON_LD,
          {
            "@context": "https://schema.org",
            "@type": "Blog",
            "@id": `${SITE_URL}/blog`,
            name: "Top Local Specialists — Health Guides",
            description:
              "Guides to treatments, recovery and choosing a private healthcare specialist in the UK.",
            inLanguage: "en-GB",
            publisher: { "@type": "Organization", name: "Top Local Specialists" },
            /* The posts themselves, so the listing can be understood
               without crawling every card first. */
            blogPost: articles.slice(0, 10).map((a) => ({
              "@type": "BlogPosting",
              headline: a.title,
              description: a.excerpt,
              datePublished: a.publishedAt,
              url: `${SITE_URL}/blog/${a.slug}`,
              ...(a.heroImageUrl
                ? {
                    image: /^https?:\/\//i.test(a.heroImageUrl)
                      ? a.heroImageUrl
                      : `${SITE_URL}${a.heroImageUrl}`,
                  }
                : {}),
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
              { "@type": "ListItem", position: 2, name: "Health guides", item: `${SITE_URL}/blog` },
            ],
          },
        ]}
      />

      {/* ==================================================== hero */}
      <section
        className="relative overflow-hidden bg-navy-950 text-white"
        style={{ marginTop: -HEADER_HEIGHT, paddingTop: HEADER_HEIGHT }}
      >
        <img
          src={heroImg}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-[0.22]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-navy-950 via-navy-950/95 to-navy-900/80"
        />
        <div className="relative mx-auto w-full max-w-[1180px] px-5 py-14 sm:px-8 sm:py-20">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-200 ring-1 ring-white/15">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={2.2} />
            Health guides
          </p>
          <h1 className="mt-5 max-w-[18ch] font-display text-[34px] font-bold leading-[1.08] sm:text-[46px]">
            Straight answers about
            <span className="text-teal-300"> private healthcare</span>
          </h1>
          <p className="mt-4 max-w-[62ch] text-[15.5px] leading-relaxed text-white/70">
            What treatment involves, how long recovery really takes, and how to tell whether the
            specialist in front of you is the right one. Written plainly, with no product to sell you
            beyond finding the right clinician.
          </p>
        </div>
      </section>

      {/* ================================================== filters */}
      {(data?.tags.length ?? 0) > 0 && (
        <div className="border-b border-line bg-paper-muted">
          <div className="mx-auto flex w-full max-w-[1180px] gap-2 overflow-x-auto px-5 py-4 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <FilterChip label="All guides" active={!tag} onClick={() => setTag("")} />
            {data?.tags.map((t) => (
              <FilterChip
                key={t.name}
                label={t.name}
                count={t.count}
                active={tag === t.name}
                onClick={() => setTag(t.name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ================================================== articles */}
      <div className="mx-auto w-full max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16">
        {loading ? (
          <div className="flex items-center justify-center gap-2.5 py-24 text-ink-muted">
            <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" strokeWidth={2} />
            <span className="text-[14px] font-semibold">Loading guides…</span>
          </div>
        ) : failed ? (
          <Empty
            title="We couldn't load the guides"
            body="Something went wrong at our end rather than yours. Refreshing usually fixes it."
          />
        ) : articles.length === 0 ? (
          <Empty
            title={tag ? `Nothing filed under "${tag}" yet` : "No guides published yet"}
            body={
              tag
                ? "Try another topic, or browse everything."
                : "New guides are added regularly. In the meantime, the directory is the fastest way to find a specialist."
            }
            action={tag ? { label: "Browse all guides", onClick: () => setTag("") } : undefined}
          />
        ) : (
          <>
            {lead && <LeadCard article={lead} />}

            <ul
              className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-3 ${lead ? "mt-10" : ""}`}
            >
              {grid.map((a) => (
                <li key={a.slug}>
                  <Card article={a} />
                </li>
              ))}
            </ul>

            {(data?.pageCount ?? 1) > 1 && (
              <nav className="mt-12 flex items-center justify-center gap-2" aria-label="Pagination">
                <PageButton disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                  Previous
                </PageButton>
                <span className="px-3 text-[13.5px] font-semibold text-ink-muted">
                  Page {page} of {data?.pageCount}
                </span>
                <PageButton
                  disabled={page >= (data?.pageCount ?? 1)}
                  onClick={() => goToPage(page + 1)}
                >
                  Next
                </PageButton>
              </nav>
            )}
          </>
        )}
      </div>

      {/* ====================================================== CTA */}
      <section className="border-t border-line bg-navy-950 text-white">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col items-start gap-6 px-5 py-12 sm:px-8 sm:py-16 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-[24px] font-bold leading-tight sm:text-[30px]">
              Ready to find the right specialist?
            </h2>
            <p className="mt-2 max-w-[54ch] text-[14.5px] leading-relaxed text-white/70">
              Every clinician on the directory is checked against their regulator before they appear.
            </p>
          </div>
          <Link
            to="/search"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-teal-500 px-6 py-3.5 text-[14px] font-bold text-navy-950 transition hover:bg-teal-400"
          >
            Search the directory
            <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
          </Link>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------- parts */

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-bold transition ${
        active
          ? "bg-navy-950 text-white"
          : "bg-white text-ink ring-1 ring-line hover:bg-teal-50 hover:ring-teal-300"
      }`}
    >
      {label}
      {count != null && (
        <span className={active ? "ml-1.5 text-white/60" : "ml-1.5 text-ink-faint"}>{count}</span>
      )}
    </button>
  );
}

function Meta({ article, tone = "muted" }: { article: ArticleCard; tone?: "muted" | "light" }) {
  const colour = tone === "light" ? "text-white/65" : "text-ink-faint";
  return (
    <p className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] font-semibold ${colour}`}>
      <time dateTime={article.publishedAt}>{formatArticleDate(article.publishedAt)}</time>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3.5 w-3.5" strokeWidth={2} />
        {article.readingMinutes} min read
      </span>
      {article.specialty && (
        <>
          <span aria-hidden>·</span>
          <span>{article.specialty.name}</span>
        </>
      )}
    </p>
  );
}

function LeadCard({ article }: { article: ArticleCard }) {
  return (
    <Link
      to={`/blog/${article.slug}`}
      className="group grid overflow-hidden rounded-3xl bg-navy-950 text-white ring-1 ring-navy-800 transition hover:ring-teal-500 md:grid-cols-[1.05fr_1fr]"
    >
      <div className="relative min-h-[220px] overflow-hidden md:min-h-[340px]">
        {article.heroImageUrl ? (
          <img
            src={article.heroImageUrl}
            alt={article.heroImageAlt ?? ""}
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-teal-700 to-navy-900" />
        )}
      </div>
      <div className="flex flex-col justify-center gap-3 p-7 sm:p-10">
        <span className="inline-flex w-fit rounded-full bg-teal-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-teal-300">
          Latest
        </span>
        <h2 className="font-display text-[24px] font-bold leading-tight sm:text-[30px]">
          {article.title}
        </h2>
        <p className="text-[14.5px] leading-relaxed text-white/70">{article.excerpt}</p>
        <Meta article={article} tone="light" />
        <span className="mt-1 inline-flex items-center gap-2 text-[14px] font-bold text-teal-300">
          Read the guide
          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" strokeWidth={2.4} />
        </span>
      </div>
    </Link>
  );
}

function Card({ article }: { article: ArticleCard }) {
  return (
    <Link
      to={`/blog/${article.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-[0_24px_48px_-28px_rgba(6,22,38,0.45)] hover:ring-teal-300"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-paper-tint">
        {article.heroImageUrl ? (
          <img
            src={article.heroImageUrl}
            alt={article.heroImageAlt ?? ""}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-teal-100 to-paper-tint" />
        )}
        {article.tags[0] && (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-teal-700 shadow-sm">
            {article.tags[0]}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <h3 className="font-display text-[17px] font-bold leading-snug text-ink group-hover:text-teal-700">
          {article.title}
        </h3>
        <p className="line-clamp-3 text-[13.5px] leading-relaxed text-ink-muted">{article.excerpt}</p>
        <div className="mt-auto pt-2">
          <Meta article={article} />
        </div>
      </div>
    </Link>
  );
}

function PageButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-line px-5 py-2.5 text-[13.5px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="rounded-3xl border border-line bg-paper-muted px-6 py-20 text-center">
      <BookOpen className="mx-auto h-8 w-8 text-teal-600" strokeWidth={1.6} />
      <h2 className="mt-4 font-display text-[20px] font-bold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-[48ch] text-[14px] leading-relaxed text-ink-muted">{body}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-6 rounded-full bg-navy-950 px-5 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-700"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
