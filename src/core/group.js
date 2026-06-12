/*
 * group.js — Cluster valued items into unit families (PRD FR-7/9).
 * Items are never compared across families; per-lb and per-each are separate.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  const exported = factory(UPS);
  Object.assign(UPS, exported);
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof self !== "undefined" ? self : globalThis, function (UPS) {
  const { FAMILY } = UPS;

  // Stable display order of groups, with the unresolved bucket last (FR-9).
  const GROUP_ORDER = [
    { key: FAMILY.WEIGHT, label: "Price per pound ($/lb)" },
    { key: FAMILY.VOLUME, label: "Price per fluid ounce ($/fl oz)" },
    { key: FAMILY.COUNT, label: "Price per item ($/each)" },
    { key: "__unresolved__", label: "No unit price available" },
  ];

  /**
   * Group items (each carrying a `.valuation`) into ordered families.
   * Returns [{ key, label, items: [...] }] preserving GROUP_ORDER.
   */
  function groupItems(items) {
    const buckets = new Map();
    for (const g of GROUP_ORDER) buckets.set(g.key, []);

    for (const item of items) {
      const fam = item.valuation && item.valuation.family;
      const key = fam && buckets.has(fam) ? fam : "__unresolved__";
      buckets.get(key).push(item);
    }

    return GROUP_ORDER.map((g) => ({
      key: g.key,
      label: g.label,
      items: buckets.get(g.key),
    })).filter((g) => g.items.length > 0);
  }

  return { GROUP_ORDER, groupItems };
});
