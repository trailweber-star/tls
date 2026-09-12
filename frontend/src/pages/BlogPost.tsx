import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Clock, Loader2, Share2 } from "lucide-react";
import { HEADER_HEIGHT } from "../components/Header";
import { Seo, ORGANISATION_JSON_LD } from "../components/Seo";
import { formatArticleDate, getArticle } from "../lib/blogApi";
import type { Article, ArticleCard } from "../lib/blogApi";

/* ------------------------------------------------------------------ *
 * One article
 *
 * The body arrives as HTML the server has already sanitised — tags
 * restricted to an allow-list, every href and src checked, scripts and
 * iframes removed (backend/src/lib/articleContent.js). That is why
 * dangerouslySetInnerHTML is acceptable here and nowhere else in this
 * app: the guarantee is made once, on the way into the database, rather
 * than trusted at the point of rendering.
 *
 * The prose styling is written against the site's own tokens rather
 * than a typography plugin, so an imported article looks like the rest
 * of the site instead of like whatever generated it.
 * ------------------------------------------------------------------ */

export default function BlogPost() {
  const { slug = "" } = useParams();
  const [data, setData] = useState<{ article: Article; related: ArticleCard[] } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    window.scrollTo({ top: 0 });
    getArticle(slug)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function share() {
    const url = window.location.href;
    // The native sheet where there is one — phones, mostly — and the
    // clipboard everywhere else, because a share button that silently
    // does nothing on a laptop is worse than no share button.
    if (navigator.share) {
      try {
        await navigator.share({ title: data?.article.title, url });
        return;
      } catch {
        /* dismissed — fall through to the clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked; nothing useful to say */
    }
  }

  if (state === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center gap-2.5 py-32 text-ink-muted">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" strokeWidth={2} />
        <span className="text-[14px] font-semibold">Loading…</span>
      </main>
    );
  }

  if (state === "missing" || !data) {
    return (
      <main className="flex-1 bg-paper">
        <Seo title="Guide not found" description="That guide does not exist." path={`/blog/${slug}`} noIndex />
        <div className="mx-auto max-w-[640px] px-5 py-28 text-center sm:px-8">
          <h1 className="font-display text-[28px] font-bold text-ink">We couldn't find that guide</h1>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">
            It may have been renamed or removed. Everything we've published is on the guides page.
          </p>
          <Link
            to="/blog"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-navy-950 px-5 py-3 text-[14px] font-bold text-white transition hover:bg-teal-700"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.4} />
            All guides
          </Link>
        </div>
      </main>
    );
  }

  const { article, related } = data;

  return (
    <main className="flex-1 bg-paper">
      <Seo
        title={article.seoTitle ?? article.title}
        description={article.seoDescription}
        path={`/blog/${article.slug}`}
        image={article.heroImageUrl ?? undefined}
        jsonLd={[
          ORGANISATION_JSON_LD,
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: article.title,
            description: article.seoDescription,
            datePublished: article.publishedAt,
            dateModified: article.updatedAt,
            author: { "@type": "Organization", name: article.authorName ?? "Top Local Specialists" },
            publisher: {
              "@type": "Organization",
              name: "Top Local Specialists",
            },
            ...(article.heroImageUrl ? { image: article.heroImageUrl } : {}),
          },
        ]}
      />

      {/* ==================================================== hero */}
      <section
        className="relative overflow-hidden bg-navy-950 text-white"
        style={{ marginTop: -HEADER_HEIGHT, paddingTop: HEADER_HEIGHT }}
      >
        {article.heroImageUrl && (
          <>
            <img
              src={article.heroImageUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover opacity-25"
            />
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-b from-navy-950/85 via-navy-950/90 to-navy-950"
            />
          </>
        )}
        <div className="relative mx-auto w-full max-w-[760px] px-5 py-12 sm:px-8 sm:py-16">
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 text-[13px] font-bold text-teal-300 transition hover:text-teal-200"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.4} />
            All guides
          </Link>
          <h1 className="mt-5 font-display text-[30px] font-bold leading-[1.14] sm:text-[40px]">
            {article.title}
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] font-semibold text-white/65">
            <time dateTime={article.publishedAt}>{formatArticleDate(article.publishedAt)}</time>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" strokeWidth={2} />
              {article.readingMinutes} min read
            </span>
            {article.specialty && (
              <>
                <span aria-hidden>·</span>
                <Link
                  to={`/search?specialty=${article.specialty.slug}`}
                  className="text-teal-300 underline-offset-4 hover:underline"
                >
                  {article.specialty.name}
                </Link>
              </>
            )}
          </p>
        </div>
      </section>

      {/* ================================================== the body */}
      <article className="mx-auto w-full max-w-[760px] px-5 py-10 sm:px-8 sm:py-14">
        {article.excerpt && (
          <p className="border-l-[3px] border-teal-500 pl-5 text-[17px] font-medium leading-relaxed text-ink">
            {article.excerpt}
          </p>
        )}

        {article.outline.length > 2 && (
          <nav
            aria-label="On this page"
            className="mt-8 rounded-2xl border border-line bg-paper-muted p-5"
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-teal-700">
              On this page
            </p>
            <ul className="mt-3 space-y-2">
              {article.outline
                .filter((h) => h.level === 2)
                .map((h) => (
                  <li key={h.id}>
                    <a
                      href={`#${h.id}`}
                      className="text-[14px] font-semibold text-ink transition hover:text-teal-700"
                    >
                      {h.text}
                    </a>
                  </li>
                ))}
            </ul>
          </nav>
        )}

        {/* Sanitised server-side — see the note at the top of this file. */}
        <div
          className="prose-tls mt-9"
          dangerouslySetInnerHTML={{ __html: article.bodyHtml }}
        />

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
          <div className="flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <Link
                key={tag}
                to={`/blog?tag=${encodeURIComponent(tag)}`}
                className="rounded-full bg-paper-muted px-3.5 py-1.5 text-[12.5px] font-bold text-ink ring-1 ring-line transition hover:bg-teal-50 hover:ring-teal-300"
              >
                {tag}
              </Link>
            ))}
          </div>
          <button
            type="button"
            onClick={share}
            className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[13px] font-bold text-ink transition hover:border-teal-300 hover:bg-teal-50"
          >
            <Share2 className="h-4 w-4" strokeWidth={2.2} />
            {copied ? "Link copied" : "Share"}
          </button>
        </div>

        {/* The point of a blog on a directory: a way back into it. */}
        <aside className="mt-10 overflow-hidden rounded-2xl bg-navy-950 p-7 text-white sm:p-9">
          <h2 className="font-display text-[21px] font-bold leading-tight sm:text-[25px]">
            {article.specialty
              ? `Find a verified ${article.specialty.name.toLowerCase()} specialist`
              : "Find a verified specialist near you"}
          </h2>
          <p className="mt-2.5 max-w-[52ch] text-[14px] leading-relaxed text-white/70">
            Every clinician on the directory is checked against their regulator before their profile
            appears, and the badge comes off automatically if their registration lapses.
          </p>
          <Link
            to={article.specialty ? `/search?specialty=${article.specialty.slug}` : "/search"}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-teal-500 px-5 py-3 text-[14px] font-bold text-navy-950 transition hover:bg-teal-400"
          >
            Search the directory
            <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
          </Link>
        </aside>
      </article>

      {/* ================================================== related */}
      {related.length > 0 && (
        <section className="border-t border-line bg-paper-muted">
          <div className="mx-auto w-full max-w-[1180px] px-5 py-12 sm:px-8 sm:py-16">
            <h2 className="font-display text-[22px] font-bold text-ink">Related guides</h2>
            <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    to={`/blog/${r.slug}`}
                    className="group flex h-full flex-col gap-2.5 rounded-2xl bg-white p-5 ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-teal-300"
                  >
                    <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-teal-700">
                      {r.tags[0] ?? "Guide"}
                    </p>
                    <h3 className="font-display text-[16.5px] font-bold leading-snug text-ink group-hover:text-teal-700">
                      {r.title}
                    </h3>
                    <p className="line-clamp-2 text-[13.5px] leading-relaxed text-ink-muted">
                      {r.excerpt}
                    </p>
                    <p className="mt-auto pt-2 text-[12.5px] font-semibold text-ink-faint">
                      {r.readingMinutes} min read
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
