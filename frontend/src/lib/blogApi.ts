const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

/* ------------------------------------------------------------------ *
 * The blog
 *
 * Read-only from the public site. Bodies arrive as HTML that the server
 * has already sanitised — see backend/src/lib/articleContent.js — which
 * is why the article page can set it directly. Nothing here sanitises
 * anything: doing it in two places is how one of them ends up out of
 * date.
 * ------------------------------------------------------------------ */

export interface ArticleCard {
  slug: string;
  title: string;
  excerpt: string;
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  authorName: string | null;
  tags: string[];
  specialty: { slug: string; name: string } | null;
  publishedAt: string;
  readingMinutes: number;
}

export interface Article extends ArticleCard {
  bodyHtml: string;
  outline: { level: number; text: string; id: string }[];
  seoTitle: string | null;
  seoDescription: string;
  updatedAt: string;
}

export interface ArticleList {
  results: ArticleCard[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  tags: { name: string; count: number }[];
  specialty: { slug: string; name: string } | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function listArticles(params: { tag?: string; specialty?: string; page?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.tag) qs.set("tag", params.tag);
  if (params.specialty) qs.set("specialty", params.specialty);
  if (params.page && params.page > 1) qs.set("page", String(params.page));
  const query = qs.toString();
  return get<ArticleList>(`/articles${query ? `?${query}` : ""}`);
}

export function getArticle(slug: string) {
  return get<{ article: Article; related: ArticleCard[] }>(`/articles/${encodeURIComponent(slug)}`);
}

/** "12 September 2026" — the form a UK reader expects. */
export function formatArticleDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
