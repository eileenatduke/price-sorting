/*
 * sort.js — Sort items within a group by canonical unit price (PRD FR-8/11).
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  const exported = factory();
  Object.assign(UPS, exported);
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof self !== "undefined" ? self : globalThis, function () {
  const DIRECTION = { ASC: "asc", DESC: "desc" }; // cheapest-first / priciest-first

  /**
   * Return a new array of items sorted by valuation.canonicalPrice.
   * Items without a price keep their original relative order, pinned last.
   * Sort is stable (each item carries `._index` as a tiebreaker).
   */
  function sortItems(items, direction = DIRECTION.ASC) {
    const sign = direction === DIRECTION.DESC ? -1 : 1;
    return items
      .map((item, i) => ({ item, i }))
      .sort((a, b) => {
        const pa = a.item.valuation ? a.item.valuation.canonicalPrice : null;
        const pb = b.item.valuation ? b.item.valuation.canonicalPrice : null;
        const aNull = pa == null;
        const bNull = pb == null;
        if (aNull && bNull) return a.i - b.i;
        if (aNull) return 1; // nulls last regardless of direction
        if (bNull) return -1;
        if (pa !== pb) return sign * (pa - pb);
        return a.i - b.i; // stable tiebreak
      })
      .map((w) => w.item);
  }

  return { DIRECTION, sortItems };
});
