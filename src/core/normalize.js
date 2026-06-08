/*
 * normalize.js — Turn raw item text into a canonical unit price (PRD FR-4/5/6).
 *
 * Produces a "valuation" describing how the unit price was derived:
 *   { canonicalPrice, family, canonicalUnit, source, detail }
 *   source: "listed"   -> Uber Eats showed the unit price (parsed directly)
 *           "computed" -> derived from package price / size in text
 *           null       -> unresolved (FR-9)
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  const exported = factory(UPS);
  Object.assign(UPS, exported);
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof self !== "undefined" ? self : globalThis, function (UPS) {
  const { UNITS, CANONICAL } = UPS;

  function round2(n) {
    // Round half up to cents for display; keep full precision for sorting.
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Compute a canonical unit price from already-parsed fields.
   * Pass a listed unit price OR a (packagePrice + size); listed wins.
   * Returns a valuation object or an unresolved valuation.
   */
  function valuate({ listed, packagePrice, size }) {
    // FR-4: prefer the value Uber Eats listed.
    if (listed) {
      const u = UNITS[listed.unitKey];
      if (u) {
        const canonicalPrice = listed.price * u.factor; // $/unit * (units/canonical)
        return {
          canonicalPrice,
          displayPrice: round2(canonicalPrice),
          family: u.family,
          canonicalUnit: CANONICAL[u.family],
          source: "listed",
          detail: `$${listed.price}/${listed.unitRaw}`,
        };
      }
    }

    // FR-5: fall back to package price / size-in-text.
    if (packagePrice != null && packagePrice > 0 && size) {
      const u = UNITS[size.unitKey];
      if (u) {
        const canonicalQty = size.qty / u.factor; // qty in canonical units
        if (canonicalQty > 0) {
          const canonicalPrice = packagePrice / canonicalQty;
          return {
            canonicalPrice,
            displayPrice: round2(canonicalPrice),
            family: u.family,
            canonicalUnit: CANONICAL[u.family],
            source: "computed",
            detail: `$${round2(packagePrice)} ÷ ${size.qty} ${size.unitRaw}`,
          };
        }
      }
    }

    // FR-9: unresolved.
    return {
      canonicalPrice: null,
      displayPrice: null,
      family: null,
      canonicalUnit: null,
      source: null,
      detail: null,
    };
  }

  return { valuate, round2 };
});
