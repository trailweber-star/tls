#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Reading the practices' own websites
 *
 *   node scripts/fetch-websites.mjs --limit=25     # a sample, cached
 *   node scripts/fetch-websites.mjs                # all of them
 *   node scripts/fetch-websites.mjs --refresh      # ignore the cache
 *
 * 679 of the 2,457 listings gave a website on the old site. That is
 * first-party content: the practice wrote it about itself and published
 * it, and the client's migration covers it. It is the only source left
 * that is both reachable in bulk and unambiguous about whose words it
 * is -- which is more than can be said for a search result.
 *
 * This script only FETCHES, into data/harvest/sites/. Deciding whether
 * a page may be attributed to a listing is source-match.mjs, and
 * turning its words into treatments is derive-from-websites.mjs. They
 * are separate because fetching 679 sites takes a while and should not
 * have to be repeated every time the extraction changes.
 *
 * MANNERS. These are small businesses' servers, not an API.
 *   - robots.txt is read once per host and obeyed;
 *   - one request at a time per host, with a pause between;
 *   - a real User-Agent that says who is asking and why, so anybody
 *     reading their logs can find us;
 *   - a 12s timeout, one retry, then give up on that listing;
 *   - everything cached, so a second run costs nobody anything.
 * ------------------------------------------------------------------ */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITES = path.join(BACKEND, "data", "harvest", "sites");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => {
  const a = args.find((x) => x.startsWith(`--${f}=`));
  return a ? Number(a.split("=")[1]) || d : d;
};
const LIMIT = num("limit", 0);
const REFRESH = has("--refresh");
const FROM_CSV = has("--from-csv");
const CONCURRENCY = Math.max(1, num("concurrency", 4));

const UA =
  "TopLocalSpecialistsBot/1.0 (+https://www.toplocalspecialists.com; directory listing verification; contact via the website)";

const c = { off: "\u001b[0m", dim: "\u001b[2m", warn: "\u001b[33m", bad: "\u001b[31m", good: "\u001b[32m", bold: "\u001b[1m" };

/* --------------------------------------------------------------- csv */

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/* ------------------------------------------------------------ listings */

const normUrl = (s) => {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return u;
  } catch {
    return null;
  }
};

async function loadListings() {
  if (FROM_CSV) {
    const file = path.join(BACKEND, "data", "harvest", "listings.csv");
    return parseCsv(fs.readFileSync(file, "utf8"))
      .map((r) => ({ slug: r.slug, fullName: r.name, website: r.website }))
      .filter((r) => normUrl(r.website));
  }
  const { getDb, disconnectDb, isDbConfigured } = await import("../src/db/client.js");
  const t = await import("../src/db/schema.js");
  if (!isDbConfigured()) {
    console.error(`\n${c.bad}No DATABASE_URL.${c.off} Pass --from-csv to work from the harvest instead.\n`);
    process.exit(1);
  }
  const db = getDb();
  const rows = await db
    .select({ slug: t.specialists.slug, fullName: t.specialists.fullName, website: t.specialists.websiteUrl })
    .from(t.specialists);
  globalThis.__disconnect = disconnectDb;
  return rows.filter((r) => normUrl(r.website));
}

/* -------------------------------------------------------------- robots */

const robotsByHost = new Map();

async function robotsFor(origin) {
  if (robotsByHost.has(origin)) return robotsByHost.get(origin);
  let rules = { disallow: [], crawlDelayMs: 0 };
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const text = await res.text();
      let applies = false;
      for (const line of text.split(/\r?\n/)) {
        const [rawKey, ...rest] = line.split("#")[0].split(":");
        const key = (rawKey ?? "").trim().toLowerCase();
        const value = rest.join(":").trim();
        if (key === "user-agent") applies = value === "*" || /toplocalspecialists/i.test(value);
        else if (applies && key === "disallow" && value) rules.disallow.push(value);
        else if (applies && key === "crawl-delay" && value) rules.crawlDelayMs = Math.min(10000, Number(value) * 1000 || 0);
      }
    }
  } catch { /* no robots.txt, or unreachable — treat as no rules */ }
  robotsByHost.set(origin, rules);
  return rules;
}

const allowedByRobots = (rules, pathname) =>
  !rules.disallow.some((d) => d === "/" || pathname.startsWith(d));

/* --------------------------------------------------------------- html */

/* Enough of an HTML-to-text pass for prose. Scripts, styles, nav and
   footers carry no clinical claims and plenty of noise. */
function toText(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section)>/gi, ".\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/* The pages worth a second request: the ones a practice puts its
   service list on. Same host only, and never more than a handful. */
const WORTH_FOLLOWING = /(treatment|service|procedure|what-we(-|\s)?do|conditions|specialit|specialt|our-care|clinics?\b)/i;

function internalLinks(html, base) {
  const out = new Map();
  for (const m of String(html ?? "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const label = toText(m[2]).slice(0, 80);
    let u;
    try { u = new URL(href, base); } catch { continue; }
    if (u.origin !== base.origin) continue;
    if (!/^https?:$/.test(u.protocol)) continue;
    u.hash = "";
    if (u.href === base.href) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|mp4)$/i.test(u.pathname)) continue;
    if (!WORTH_FOLLOWING.test(u.pathname) && !WORTH_FOLLOWING.test(label)) continue;
    if (!out.has(u.href)) out.set(u.href, label);
  }
  return [...out.keys()].slice(0, 3);
}

/* --------------------------------------------------------------- fetch */

const lastHitAt = new Map();

async function politeGet(url, crawlDelayMs) {
  const origin = new URL(url).origin;
  const gap = Math.max(1000, crawlDelayMs || 0);
  const since = Date.now() - (lastHitAt.get(origin) ?? 0);
  if (since < gap) await new Promise((r) => setTimeout(r, gap - since));
  lastHitAt.set(origin, Date.now());

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok) return { status: res.status, finalUrl: res.url, html: "" };
      if (!/html/i.test(type)) return { status: res.status, finalUrl: res.url, html: "", note: `content-type ${type}` };
      return { status: res.status, finalUrl: res.url, html: await res.text() };
    } catch (e) {
      if (attempt === 1) return { status: 0, finalUrl: url, html: "", note: String(e.message ?? e).slice(0, 120) };
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { status: 0, finalUrl: url, html: "" };
}

/* ---------------------------------------------------------------- main */

fs.mkdirSync(SITES, { recursive: true });

const listings = await loadListings();
console.log(`\n${listings.length} listing(s) with a website`);

/* A url given by more than one listing is recorded on every one of
   them, so the match gate can refuse all of them later. */
const claimants = new Map();
for (const l of listings) {
  const u = normUrl(l.website);
  const key = u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
  claimants.set(key, (claimants.get(key) ?? 0) + 1);
}

/* A cached record only counts as cached if it actually holds something.
   A failed fetch that left a husk behind must not be mistaken for a
   site with nothing on it, or one bad afternoon on the network becomes
   a permanent hole in the data. robots.txt is different: that is a
   real answer and it is not going to change by asking again today. */
function alreadyHave(slug) {
  const file = path.join(SITES, `${slug}.json`);
  if (!fs.existsSync(file)) return false;
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    if (r.blocked) return true;
    return (r.pages ?? []).some((p) => (p.text ?? "").length > 0);
  } catch {
    return false;
  }
}

const todo = listings.filter((l) => REFRESH || !alreadyHave(l.slug));
const queue = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
console.log(
  `${listings.length - todo.length} already cached, ${queue.length} to fetch` +
    (LIMIT > 0 && todo.length > LIMIT ? ` ${c.dim}(--limit=${LIMIT})${c.off}` : "") +
    "\n"
);

let done = 0;
const summary = { ok: 0, empty: 0, failed: 0, blocked: 0, extraPages: 0 };

async function handle(listing) {
  const base = normUrl(listing.website);
  const key = base.hostname.replace(/^www\./, "") + base.pathname.replace(/\/+$/, "");
  const record = {
    slug: listing.slug,
    fullName: listing.fullName,
    url: base.href,
    claimedByOtherListings: (claimants.get(key) ?? 1) - 1,
    fetchedAt: new Date().toISOString(),
    pages: [],
  };

  const rules = await robotsFor(base.origin);
  if (!allowedByRobots(rules, base.pathname)) {
    record.blocked = "robots.txt";
    summary.blocked += 1;
  } else {
    const first = await politeGet(base.href, rules.crawlDelayMs);
    record.status = first.status;
    record.finalUrl = first.finalUrl;
    if (first.note) record.note = first.note;
    if (first.html) {
      record.pages.push({ url: first.finalUrl, text: toText(first.html) });
      for (const link of internalLinks(first.html, base)) {
        if (!allowedByRobots(rules, new URL(link).pathname)) continue;
        const more = await politeGet(link, rules.crawlDelayMs);
        if (more.html) {
          record.pages.push({ url: more.finalUrl, text: toText(more.html) });
          summary.extraPages += 1;
        }
      }
    }
    const chars = record.pages.reduce((n, p) => n + p.text.length, 0);
    if (!record.pages.length) summary.failed += 1;
    else if (chars < 400) summary.empty += 1;
    else summary.ok += 1;
  }

  fs.writeFileSync(path.join(SITES, `${listing.slug}.json`), JSON.stringify(record, null, 1));
  done += 1;
  const chars = record.pages.reduce((n, p) => n + p.text.length, 0);
  const tag = record.blocked
    ? `${c.warn}robots${c.off}`
    : record.pages.length
      ? `${c.good}${String(chars).padStart(6)} chars${c.off}${record.pages.length > 1 ? ` +${record.pages.length - 1}p` : ""}`
      : `${c.bad}${record.status || "err"}${c.off}${record.note ? ` ${c.dim}${record.note}${c.off}` : ""}`;
  console.log(`  ${String(done).padStart(4)}/${queue.length}  ${listing.slug.slice(0, 44).padEnd(44)} ${tag}`);
}

let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
    while (cursor < queue.length) {
      const item = queue[cursor];
      cursor += 1;
      try { await handle(item); } catch (e) { console.log(`  ${c.bad}!${c.off} ${item.slug}: ${e.message}`); summary.failed += 1; }
    }
  })
);

console.log(
  `\n${c.good}${summary.ok}${c.off} with usable text, ${summary.empty} nearly empty, ` +
    `${summary.failed} unreachable, ${summary.blocked} disallowed by robots.txt` +
    (summary.extraPages ? `, ${summary.extraPages} extra service page(s) followed` : "") +
    `\n  → data/harvest/sites/\n\nNothing has been attributed to any listing yet — that is\nnpm run treatments:websites, which runs the match gate first.\n`
);

if (globalThis.__disconnect) await globalThis.__disconnect();
