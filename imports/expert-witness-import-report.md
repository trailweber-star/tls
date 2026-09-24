# Expert witness import CSV — build report

Sources: 71 original (medical-listings) + 329 richer-pass rows
Deduplicated on `source_url`: 38 richer-pass rows were already in the
original 71 (dropped, not double-imported).
Rows with no name at all (dropped): 0
**Final row count: 362**

## Regions covered
- Matched to a canonical UK region: 292
- Left blank (no region/city signal in the scraped text — not guessed): 70

## Practice areas ("type of report")
Every row defaults to **Personal Injury + Clinical Negligence** — the two case
types both source sites describe almost all of their listed doctors as covering.
Rows where the scraped text also matched a keyword for one of the other 12 leaves
(road traffic, immigration, family law, fitness to practise, industrial disease,
inquest, etc.) got that leaf ADDED on top of the default: 51 rows.

This is a heuristic, not a per-person verified fact — flagged here so it can be
refined by hand later. It is a real improvement over the previous pass, which
mislabelled the sub-category as "Medical" for 100% of rows with no practice-area
distinction at all.

## Ready to import

    cd backend
    node scripts/sync-taxonomy.mjs --write   # first — the 14 new leaf slugs must exist
    npm run import -- expert-witness-import.csv --source "McCollum Consultants / ExpertWitness.co.uk" --dry-run
    npm run import -- expert-witness-import.csv --source "McCollum Consultants / ExpertWitness.co.uk"

Re-running is safe — rows are keyed on `source_url`, so a second run updates
rather than duplicates.
