/* ------------------------------------------------------------------ *
 * The listings that are places, not people
 *
 * data/facility-moves.csv is the record of a decision somebody made by
 * reading each listing: this one is a hospital, not a clinician. The
 * move script turns them into facilities, and a facility holds facility
 * categories -- it has no treatments and no conditions, because a
 * building does not perform an operation.
 *
 * So the two derivation passes skip them. Birmingham Dental Hospital's
 * own website naturally says "Root Canal Treatment", and the pass was
 * right to read it; but filing it against the listing only creates a
 * link that move-to-facilities must then refuse or throw away. Skipping
 * the fourteen is cheaper than unpicking them, and it keeps the two
 * scripts from disagreeing about what a hospital is.
 *
 * Read from the csv rather than hard-coded, so adding a row to the file
 * is the whole of adding a listing to this set. If the file is missing
 * the set is empty and both passes behave exactly as they did before.
 *
 * Only the first column is read. It is the specialists-table slug, it
 * is kebab-case, and it never contains a comma or a quote -- unlike the
 * reason column, which contains both. The header is checked rather than
 * assumed, so if the columns are ever reordered this throws instead of
 * quietly returning the wrong set.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = path.join(BACKEND, "data", "facility-moves.csv");

export function placeListingSlugs() {
  if (!fs.existsSync(FILE)) return new Set();
  const lines = fs
    .readFileSync(FILE, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() && !/^\s*#/.test(l));
  if (!lines.length) return new Set();

  const header = lines.shift();
  const firstColumn = header.split(",")[0].trim();
  if (firstColumn !== "slug") {
    throw new Error(
      `data/facility-moves.csv: expected the first column to be "slug", found "${firstColumn}". ` +
        "scripts/lib/place-listings.mjs reads the first column only — see its header."
    );
  }
  return new Set(lines.map((l) => l.split(",")[0].trim()).filter(Boolean));
}

export const PLACE_LISTINGS_FILE = path.relative(BACKEND, FILE);
