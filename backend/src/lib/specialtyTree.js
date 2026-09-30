/* ------------------------------------------------------------------ *
 * Walking the specialty tree from a leaf back up to its root.
 *
 * The taxonomy is up to three tiers deep (top -> sub -> narrow) and a
 * specialist or article is tagged at whatever tier fits, never forced
 * up to the top. Several places need the top-level ancestor of a tag
 * they were given — the search sidebar's "Specialty" dropdown only
 * ever renders root-level options, so a link built from a bare
 * sub-specialty slug (e.g. `?specialty=braces`) has nothing to select
 * and the Sub-specialty checklist beneath it never renders at all,
 * since that list requires a specialty to already be chosen.
 *
 * This used to be written out separately wherever it was needed. One
 * walk now, shared by every caller, so "how do we find the root" has
 * one answer instead of three that can quietly drift apart.
 * ------------------------------------------------------------------ */

/**
 * The top-level node a specialty belongs to — "Orthopaedics", not
 * "Total Knee Replacement" — or null if `id` is missing or unknown.
 * `specialtyById` is a Map<id, node> where each node carries at least
 * `id`, `slug`, `name` and `parentId`.
 */
export function rootSpecialtyOf(specialtyById, id) {
  let node = id ? specialtyById.get(id) : null;
  const guard = new Set();
  while (node?.parentId && !guard.has(node.id)) {
    guard.add(node.id);
    node = specialtyById.get(node.parentId);
  }
  return node ?? null;
}

/**
 * The `/search` link for a specialty node, carrying both the root
 * specialty slug and, when `sp` is itself a sub-specialty, the
 * sub-specialty slug too — the shape the sidebar's Specialty dropdown
 * and Sub-specialty checklist both need to render pre-selected.
 */
export function specialtyHref(specialtyById, sp) {
  if (!sp.parentId) return `/search?specialty=${sp.slug}`;
  const root = rootSpecialtyOf(specialtyById, sp.id);
  return root?.slug
    ? `/search?specialty=${root.slug}&subspecialty=${sp.slug}`
    : `/search?subspecialty=${sp.slug}`;
}
