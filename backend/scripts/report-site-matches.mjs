import fs from "node:fs";
import path from "node:path";
import { verdict } from "./lib/source-match.mjs";

function parseCsv(text){const rows=[];let row=[],cell="",q=false;
for(let i=0;i<text.length;i++){const ch=text[i];
if(q){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')q=false;else cell+=ch;}
else if(ch==='"')q=true;else if(ch===","){row.push(cell);cell="";}
else if(ch==="\n"){row.push(cell);rows.push(row);row=[];cell="";}else if(ch!=="\r")cell+=ch;}
if(cell||row.length){row.push(cell);rows.push(row);}
const h=rows.shift();return rows.filter(r=>r.some(x=>x.trim())).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));}

/* every leaf name, grouped by the root of its branch */
const tree = JSON.parse(fs.readFileSync("src/data/taxonomy/specialty-tree.json","utf8"));
const leavesByRoot = new Map();
(function walk(nodes, root){ for (const n of nodes||[]) {
  const r = root ?? n.slug;
  if (!n.children?.length) { if(!leavesByRoot.has(r)) leavesByRoot.set(r,[]); leavesByRoot.get(r).push(n.name); }
  else walk(n.children, r);
}})(Array.isArray(tree)?tree:tree.nodes ?? tree.children ?? [], null);

const mapped = parseCsv(fs.readFileSync("data/harvest/mapped.csv","utf8"));
const bySlug = new Map(mapped.map(r=>[r.slug,r]));

/* Other listings publishing on the same host — the gate compares the
   names to decide whether they are the same practice or strangers. */
const hostOf = (u) => { try { return new URL(/^https?:/i.test(String(u))?u:`https://${u}`).hostname.toLowerCase().replace(/^www\./,""); } catch { return null; } };
const namesByHost = new Map();
for (const r of mapped) {
  const h = hostOf(r.website); if (!h) continue;
  if (!namesByHost.has(h)) namesByHost.set(h, []);
  namesByHost.get(h).push({ slug: r.slug, name: r.name });
}
const sameHostListings = (url, ownSlug) =>
  (namesByHost.get(hostOf(url)) ?? []).filter(x => x.slug !== ownSlug).map(x => x.name);

const dir = "data/harvest/sites";
const files = fs.readdirSync(dir).filter(f=>f.endsWith(".json"));
const C = { off:"\u001b[0m", dim:"\u001b[2m", good:"\u001b[32m", bad:"\u001b[31m", warn:"\u001b[33m", bold:"\u001b[1m" };

let pass=0, fail=0; const failReasons = new Map();
for (const f of files.sort()) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"));
  const m = bySlug.get(rec.slug);
  const text = (rec.pages||[]).map(p=>p.text).join("\n");
  const root = m?.primarySpecialtySlug ? (mapped.find(x=>x.slug===rec.slug)?.primarySpecialtySlug) : null;
  const rootKey = m?.primarySpecialtySlug || "";
  const branchRoot = [...leavesByRoot.keys()].find(k => k === rootKey) ?? null;
  const leafNames = leavesByRoot.get(branchRoot) ?? [...leavesByRoot.values()].flat().slice(0,0);
  const v = verdict({
    listing: {
      fullName: rec.fullName || m?.name || rec.slug,
      town: m?.townResolved, postcode: m?.postcodeFromAddress, telephone: m?.telephone,
      branch: branchRoot, leafNames,
    },
    source: {
      url: rec.url, text,
      claimedByOtherListings: rec.claimedByOtherListings ?? 0,
      sameHostListings: sameHostListings(rec.url, rec.slug),
    },
  });
  if (v.pass) pass++; else { fail++; for (const c of v.checks) if(!c.pass) failReasons.set(c.name,(failReasons.get(c.name)??0)+1); }
  const mark = v.pass ? `${C.good}PASS${C.off}` : `${C.bad}FAIL${C.off}`;
  console.log(`\n${mark}  ${C.bold}${rec.fullName || rec.slug}${C.off}  ${C.dim}${rec.url}${C.off}`);
  for (const c of v.checks) console.log(`        ${c.pass?C.good+"ok  "+C.off:C.bad+"no  "+C.off} ${c.name.padEnd(13)} ${C.dim}${c.detail}${C.off}`);
}
console.log(`\n${C.bold}${pass} passed, ${fail} refused${C.off} of ${files.length}`);
console.log("refused on:"); for (const [k,n] of [...failReasons].sort((a,b)=>b[1]-a[1])) console.log(`   ${String(n).padStart(3)}  ${k}`);
