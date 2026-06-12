/*
 * units.js — Unit normalization reference (PRD Appendix A).
 *
 * Canonical units per family:
 *   weight -> lb, volume -> fl oz, count -> each
 *
 * `factor` = how many of this unit fit in one canonical unit.
 *   - A listed `$/unit`  -> multiply by factor to get `$/canonical`.
 *   - A size `qty unit`  -> divide  by factor to get the size in canonical units.
 *
 * Both directions stay consistent because factor is "units per canonical".
 *   e.g. $0.25/oz  * 16   = $4.00/lb        (16 oz per lb)
 *        16 oz     / 16   = 1 lb            (16 oz per lb)
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  const exported = factory();
  Object.assign(UPS, exported);
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof self !== "undefined" ? self : globalThis, function () {
  const FAMILY = { WEIGHT: "weight", VOLUME: "volume", COUNT: "count" };

  // Canonical unit label per family (for display).
  const CANONICAL = {
    [FAMILY.WEIGHT]: "lb",
    [FAMILY.VOLUME]: "fl oz",
    [FAMILY.COUNT]: "each",
  };

  // Each entry: canonical key -> { family, factor, aliases }
  // `aliases` are the lowercased strings we expect to see in page text.
  const UNITS = {
    // ---- weight (canonical: lb) ----
    lb: { family: FAMILY.WEIGHT, factor: 1, aliases: ["lb", "lbs", "pound", "pounds"] },
    oz: { family: FAMILY.WEIGHT, factor: 16, aliases: ["oz", "ounce", "ounces"] },
    g: { family: FAMILY.WEIGHT, factor: 453.592, aliases: ["g", "gram", "grams"] },
    kg: { family: FAMILY.WEIGHT, factor: 0.453592, aliases: ["kg", "kilogram", "kilograms"] },

    // ---- volume (canonical: fl oz) ----
    floz: { family: FAMILY.VOLUME, factor: 1, aliases: ["fl oz", "floz", "fluid ounce", "fluid ounces"] },
    ml: { family: FAMILY.VOLUME, factor: 29.5735, aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"] },
    l: { family: FAMILY.VOLUME, factor: 0.0295735, aliases: ["l", "liter", "liters", "litre", "litres"] },
    pt: { family: FAMILY.VOLUME, factor: 0.0625, aliases: ["pt", "pint", "pints"] },
    qt: { family: FAMILY.VOLUME, factor: 0.03125, aliases: ["qt", "quart", "quarts"] },
    gal: { family: FAMILY.VOLUME, factor: 0.0078125, aliases: ["gal", "gallon", "gallons"] },

    // ---- count (canonical: each) ----
    each: { family: FAMILY.COUNT, factor: 1, aliases: ["each", "ea", "ct", "count", "pk", "pack", "packs", "piece", "pieces", "unit", "units"] },
  };

  // Build a lookup from any alias -> canonical unit key.
  // Longer aliases are matched first by consumers (e.g. "fl oz" before "oz").
  const ALIAS_TO_KEY = (() => {
    const map = {};
    for (const key of Object.keys(UNITS)) {
      for (const alias of UNITS[key].aliases) map[alias] = key;
    }
    return map;
  })();

  // All aliases sorted longest-first so regex/lookup prefers "fl oz" over "oz".
  const ALIASES_BY_LENGTH = Object.keys(ALIAS_TO_KEY).sort((a, b) => b.length - a.length);

  /** Resolve a raw unit string (any case/spacing) to a canonical unit key, or null. */
  function resolveUnit(raw) {
    if (!raw) return null;
    const norm = String(raw).toLowerCase().trim().replace(/\s+/g, " ").replace(/\.$/, "");
    if (ALIAS_TO_KEY[norm]) return ALIAS_TO_KEY[norm];
    // collapse "fl. oz" / "fl-oz" style
    const collapsed = norm.replace(/[.\-]/g, " ").replace(/\s+/g, " ").trim();
    return ALIAS_TO_KEY[collapsed] || null;
  }

  return { FAMILY, CANONICAL, UNITS, ALIAS_TO_KEY, ALIASES_BY_LENGTH, resolveUnit };
});
