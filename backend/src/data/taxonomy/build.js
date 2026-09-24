// Turns a taxonomy tree — top category, subcategory, and however many
// further levels of narrower subcategory a given branch actually has —
// into a flat, self-referencing list shaped like the
// Specialty/FacilityCategory Mongoose schemas: { id, parentId, slug,
// name, level }. Shared by the Specialty taxonomy (Orthopaedics,
// Physiotherapy, Dentistry, Aesthetics Specialists, ENT, Gynaecology,
// Expert Witness) and the FacilityCategory taxonomy (Hospital Care,
// Care Homes, Pharmacy, Clinics, Hospitals) — same shape, different
// tree, different idPrefix so the two id-spaces never collide.
//
// Depth is not assumed. Most branches are top -> sub -> leaf (3
// levels), but Expert Witness -> Medicolegal -> Personal Injury ->
// Orthopaedic & Musculoskeletal Injury is 4, and a hard-coded 3-level
// walk here silently drops that 4th level rather than erroring, which
// is exactly the kind of bug that goes unnoticed until someone asks
// why a dropdown that should narrow further doesn't. So this recurses
// to whatever depth each branch actually has.
export function flattenTaxonomyTree(tree, idPrefix) {
  const flat = [];
  function walk(nodes, parentId, level) {
    for (const node of nodes) {
      const id = `${idPrefix}-${node.slug}`;
      flat.push({ id, parentId, slug: node.slug, name: node.name, level });
      if (node.children?.length) walk(node.children, id, level + 1);
    }
  }
  walk(tree, null, 0);
  return flat;
}

// A node (at any level) is tagged on real records only at leaf level in
// practice, but a search might be scoped to a top-level or mid-level
// slug — so "the branch" for any slug means that node's own slug plus
// every descendant slug beneath it, all the way down. Falls back to a
// single-slug set if the slug isn't found in this tree at all.
export function branchSlugs(flatList, slug) {
  const node = flatList.find((n) => n.slug === slug);
  if (!node) return new Set([slug]);
  const result = new Set([node.slug]);
  const stack = [node.id];
  while (stack.length) {
    const id = stack.pop();
    for (const child of flatList.filter((n) => n.parentId === id)) {
      result.add(child.slug);
      stack.push(child.id);
    }
  }
  return result;
}

export function childrenOf(flatList, slug) {
  const node = flatList.find((n) => n.slug === slug);
  if (!node) return [];
  return flatList.filter((n) => n.parentId === node.id);
}

export function topLevelOf(flatList) {
  return flatList.filter((n) => n.level === 0);
}
