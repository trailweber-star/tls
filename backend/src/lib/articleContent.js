import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { safeUrl } from "./urls.js";

/* ------------------------------------------------------------------ *
 * Article bodies
 *
 * Every article on this site arrives from somewhere else — Abun's
 * generator today, a paste from a Google Doc tomorrow — which makes the
 * body the least trustworthy string in the database and the one most
 * certain to be rendered as HTML on a public page.
 *
 * We already had this bug once, in a specialist's photoUrl: a field
 * accepted as "just a string" and printed into a page. It is the same
 * shape of mistake here, with a far larger surface, so the body is
 * converted and sanitised in one place and there is no route by which
 * raw HTML reaches the front end.
 *
 * Sanitising HTML by hand is a losing game — mXSS, mutated entities,
 * SVG, namespace confusion — so this leans on sanitize-html with a
 * deliberately small allow-list rather than a clever regex.
 * ------------------------------------------------------------------ */

/** Elements an article legitimately needs. Everything else is dropped. */
const ALLOWED_TAGS = [
  "h2", "h3", "h4",          // h1 belongs to the page, not the body
  "p", "br", "hr",
  "strong", "em", "b", "i", "u", "s", "mark", "sup", "sub",
  "ul", "ol", "li",
  "blockquote", "q", "cite",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "code", "pre", "span", "div",
];

const ALLOWED_ATTRIBUTES = {
  // target and rel are here because sanitize-html applies this list
  // AFTER transformTags — without them the transform below adds
  // rel="noopener nofollow" and sanitize-html immediately removes it,
  // which is a silent failure that looks like working code.
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title", "width", "height", "loading"],
  th: ["colspan", "rowspan", "scope"],
  td: ["colspan", "rowspan"],
  // Kept so a generator's semantic classes survive; style is not, because
  // a style attribute is a paint job over our own design system.
  "*": ["class"],
};

/**
 * Markdown or HTML in, safe HTML out.
 *
 * Abun exports either, and which one is a setting on their side rather
 * than a promise, so the format is detected instead of configured: a
 * body with block-level tags is treated as HTML, anything else goes
 * through the markdown parser first. Getting this wrong in either
 * direction is visible immediately — markdown rendered as HTML shows
 * its own asterisks — which is why it is a detection and not a guess
 * buried in a flag.
 */
export function renderArticleBody(raw, { format = "auto" } = {}) {
  const input = String(raw ?? "");
  if (!input.trim()) return "";

  const looksLikeHtml = /<(p|div|h[1-6]|ul|ol|table|figure|blockquote|img|br)\b/i.test(input);
  const asHtml = format === "html" || (format === "auto" && looksLikeHtml);

  const html = asHtml ? input : marked.parse(input, { breaks: false, gfm: true });

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // No <iframe>, no <video>, no <script>, no <style>. An embed is a
    // request to run somebody else's code on a page a patient reads.
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    transformTags: {
      // Every outbound link in generated content is untrusted by
      // definition, and an article is exactly where a generator likes
      // to put citations.
      a: (tagName, attribs) => {
        const href = safeUrl(attribs.href);
        /* An unsafe link keeps its tag and loses its href; the filter
           below then drops the empty anchor and keeps the words. It is
           done this way rather than by renaming the tag because
           sanitize-html derives closing tags from the LAST transform it
           ran — renaming one anchor mid-document closed a later, valid
           one with the wrong name and leaked "</unsafe-link>" into the
           prose. */
        if (!href) return { tagName: "a", attribs: {} };
        const external = /^https?:\/\//i.test(href) && !href.includes("toplocalspecialists.com");
        return {
          tagName: "a",
          attribs: {
            href,
            ...(attribs.title ? { title: attribs.title } : {}),
            ...(external ? { target: "_blank", rel: "noopener nofollow ugc" } : {}),
          },
        };
      },
      img: (tagName, attribs) => {
        const src = safeUrl(attribs.src);
        // Same reasoning as the anchor above; a src-less <img> is
        // stripped after sanitising.
        if (!src) return { tagName: "img", attribs: {} };
        return {
          tagName: "img",
          attribs: {
            src,
            alt: attribs.alt ?? "",
            loading: "lazy",
            decoding: "async",
          },
        };
      },
    },
    exclusiveFilter: (frame) => {
      // An anchor stripped of its href is no longer a link.
      if (frame.tag === "a" && !frame.attribs?.href) return false;
      // An empty paragraph left behind by a generator is a gap in the
      // page that looks like a rendering fault.
      return (
        ["p", "span", "div", "li"].includes(frame.tag) &&
        !frame.text.trim() &&
        !/<img/i.test(frame.mediaChildren?.join("") ?? "")
      );
    },
  })
    // A void element cannot be dropped by exclusiveFilter, so the
    // src-less images the transform left behind go here.
    .replace(/<img(?![^>]*\ssrc=)[^>]*>/gi, "")
    .trim();
}

/** Plain text, for excerpts, meta descriptions and reading time. */
export function toPlainText(html) {
  // "</h2><p>" is a sentence boundary in HTML and nothing at all once the
  // tags are gone, so the break is inserted before stripping. Without
  // this, an excerpt reads "HKnee recovery starts…".
  const spaced = String(html ?? "").replace(
    /<\/(h[1-6]|p|li|div|blockquote|tr|figcaption|td|th)>/gi,
    " "
  );
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A first paragraph's worth, cut on a word boundary.
 *
 * Used when the source supplies no excerpt of its own — which is most
 * of the time — and truncated to the length Google will actually show
 * rather than an arbitrary round number.
 */
export function excerptFrom(html, max = 180) {
  const text = toPlainText(html);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).replace(/[,;:.\s]+$/, "")}…`;
}

/** 225 words a minute, the middle of the range for adult reading. */
export function readingMinutes(html) {
  const words = toPlainText(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 225));
}

/**
 * A URL-safe slug.
 *
 * Abun supplies titles, not slugs, and a title becomes a permanent
 * public URL — so this strips accents rather than dropping them, which
 * is the difference between /blog/knee-replacement-recovery and
 * /blog/knee-replacement-recovery-2.
 */
export function slugify(title) {
  return String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** The headings in a body, for an on-page contents list. */
export function outlineOf(html) {
  const out = [];
  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(String(html ?? "")))) {
    const text = toPlainText(m[2]);
    if (text) out.push({ level: Number(m[1]), text, id: slugify(text) });
  }
  return out;
}

/**
 * The same ids the outline points at, injected into the body.
 *
 * Done server-side so the anchors exist in the HTML a crawler reads,
 * rather than being added by script after hydration.
 */
export function withHeadingIds(html) {
  return String(html ?? "").replace(
    /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_full, level, attrs, inner) => {
      const id = slugify(toPlainText(inner));
      if (!id || /\bid=/.test(attrs)) return `<h${level}${attrs}>${inner}</h${level}>`;
      return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
    }
  );
}
