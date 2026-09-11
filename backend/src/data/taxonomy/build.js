// Turns a 3-level taxonomy tree (top category -> subcategory ->
// sub-subcategory) into a flat, self-referencing list shaped like the
// Specialty/FacilityCategory Mongoose schemas: { id, parentId, slug,
// name, level }. Shared by the Specialty taxonomy (Orthopaedics,
// Physiotherapy, Dentistry, Aesthetics Specialists, ENT, Gynaecology)
// and the FacilityCategory taxonomy (Hospital Care, Care Homes,
// Pharmacy, Clinics, Hospitals) — same shape, different tree, different
// idPrefix so the two id-spaces never collide.
export function flattenTaxonomyTree(tree, idPrefix) {
  const flat = [];
  for (const top of tree) {
    const topId = `${idPrefix}-${top.slug}`;
    flat.push({ id: topId, parentId: null, slug: top.slug, name: top.name, level: 0 });
    for (const sub of top.children) {
      const subId = `${idPrefix}-${sub.slug}`;
      flat.push({ id: subId, parentId: topId, slug: sub.slug, name: sub.name, level: 1 });
      for (const leaf of sub.children) {
        const leafId = `${idPrefix}-${leaf.slug}`;
        flat.push({ id: leafId, parentId: subId, slug: leaf.slug, name: leaf.name, level: 2 });
      }
    }
  }
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
