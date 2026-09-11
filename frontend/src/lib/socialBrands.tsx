/* ------------------------------------------------------------------ *
 * Social platforms — the marks, and their real colours
 *
 * One place for the five platforms a listing can link to. The glyphs are
 * the wordmark-free ones each platform publishes for exactly this use
 * (linking to a profile on it); lucide dropped brand marks, and a
 * look-alike is worse than none on a site whose product is trust.
 *
 * They are coloured here because a profile is somebody's shopfront: a
 * row of grey smudges reads as decoration, and a person scanning for
 * "is she on LinkedIn" finds the blue square in a fraction of the time
 * it takes to read five identical grey circles. The footer keeps its
 * monochrome treatment on purpose — that row is our own accounts on a
 * quiet band at the bottom of the page, and it should stay quiet.
 *
 * `prefix` is what gets stripped and re-added around what someone types,
 * so a specialist can paste a full URL, an @handle or a bare username
 * and all three end up as the same stored link.
 * ------------------------------------------------------------------ */

export type SocialPlatform = "linkedin" | "x" | "instagram" | "facebook" | "youtube";

export interface SocialBrand {
  key: SocialPlatform;
  name: string;
  /** The brand's own colour, for the glyph. */
  color: string;
  /** A tint of it, for the chip the glyph sits on. */
  tint: string;
  path: string;
  /** Shown in the form field, and what a bare handle is prefixed with. */
  prefix: string;
  placeholder: string;
}

export const SOCIAL_BRANDS: SocialBrand[] = [
  {
    key: "linkedin",
    name: "LinkedIn",
    color: "#0A66C2",
    tint: "#0A66C216",
    prefix: "https://www.linkedin.com/in/",
    placeholder: "your-name",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z",
  },
  {
    key: "x",
    name: "X",
    // X's mark is black, which on a light card reads as ink rather than
    // as a brand. Their own guidance allows the near-black, so it keeps
    // its identity without becoming the loudest thing on the row.
    color: "#0F1419",
    tint: "#0F141912",
    prefix: "https://x.com/",
    placeholder: "handle",
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
  {
    key: "instagram",
    name: "Instagram",
    // The gradient is the real mark, but a single mid-magenta is what
    // their guidance permits at small sizes and it stays legible at 18px.
    color: "#E1306C",
    tint: "#E1306C16",
    prefix: "https://www.instagram.com/",
    placeholder: "handle",
    path: "M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0Zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03Zm0 3.678a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7.846-10.405a1.441 1.441 0 0 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z",
  },
  {
    key: "facebook",
    name: "Facebook",
    color: "#1877F2",
    tint: "#1877F216",
    prefix: "https://www.facebook.com/",
    placeholder: "your.page",
    path: "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  },
  {
    key: "youtube",
    name: "YouTube",
    color: "#FF0000",
    tint: "#FF000014",
    prefix: "https://www.youtube.com/@",
    placeholder: "channel",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z",
  },
];

export const SOCIAL_BY_KEY: Record<SocialPlatform, SocialBrand> = Object.fromEntries(
  SOCIAL_BRANDS.map((b) => [b.key, b])
) as Record<SocialPlatform, SocialBrand>;

/** The glyph, in the platform's own colour unless told otherwise. */
export function SocialGlyph({
  platform,
  className = "h-[18px] w-[18px]",
  color,
}: {
  platform: SocialPlatform;
  className?: string;
  /** Override — "currentColor" for the footer's monochrome row. */
  color?: string;
}) {
  const brand = SOCIAL_BY_KEY[platform];
  if (!brand) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} fill={color ?? brand.color} aria-hidden focusable="false">
      <path d={brand.path} />
    </svg>
  );
}

/**
 * Normalise what someone typed into a full URL.
 *
 * Specialists paste whatever is in front of them: the whole address bar,
 * an @handle, or just their username. Rejecting two of those three is a
 * validation error over something we can work out ourselves.
 */
export function normaliseSocial(platform: SocialPlatform, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, "").replace(/^\/+/, "");
  if (!handle) return null;
  return SOCIAL_BY_KEY[platform].prefix + handle;
}

/** The other direction: show the handle, not a 60-character URL. */
export function socialHandle(platform: SocialPlatform, url: string): string {
  const brand = SOCIAL_BY_KEY[platform];
  const stripped = url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "");
  const prefix = brand.prefix.replace(/^https?:\/\/(www\.)?/i, "");
  return stripped.startsWith(prefix) ? stripped.slice(prefix.length) : stripped;
}
