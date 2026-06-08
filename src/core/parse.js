/*
 * parse.js — Conservative text parsing for prices, listed unit prices and sizes.
 *
 * Strategy (PRD FR-3/4/5, R-3): match stable text patterns, not CSS classes.
 * Everything here is pure (string in, data out) so it is unit-testable in Node.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  const exported = factory(UPS);
  Object.assign(UPS, exported);
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof self !== "undefined" ? self : globalThis, function (UPS) {
  const { ALIASES_BY_LENGTH, resolveUnit } = UPS;

  // A regex fragment that matches any known unit alias, longest first.
  // Escape spaces/dots so multi-word aliases like "fl oz" work.
  const UNIT_PATTERN = ALIASES_BY_LENGTH
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*"))
    .join("|");

  const NUM = "\\d+(?:[.,]\\d+)?";

  // Listed unit price, e.g. "$3.49/lb", "$0.50 / fl oz", "$1.20 per each".
  const LISTED_RE = new RegExp(
    `\\$\\s*(${NUM})\\s*(?:\\/|per)\\s*(${UNIT_PATTERN})\\b`,
    "i"
  );

  // A plain price, e.g. "$6.00", "$12". Used for package price.
  const PRICE_RE = new RegExp(`\\$\\s*(${NUM})`, "g");

  // A size token in free text, e.g. "3 lb", "16 oz", "500 ml", "12 ct".
  // Optional leading multiplier, e.g. "2 x 12 oz" -> 24 oz.
  const SIZE_RE = new RegExp(
    `(?:(${NUM})\\s*(?:x|×)\\s*)?(${NUM})\\s*(${UNIT_PATTERN})\\b`,
    "ig"
  );

  function toNumber(s) {
    if (s == null) return NaN;
    return parseFloat(String(s).replace(/,/g, ""));
  }

  /** Parse a listed "$X/unit" from text. Returns {price, unitKey, unitRaw} or null. */
  function parseListedUnitPrice(text) {
    if (!text) return null;
    const m = LISTED_RE.exec(text);
    if (!m) return null;
    const price = toNumber(m[1]);
    const unitKey = resolveUnit(m[2]);
    if (!isFinite(price) || price <= 0 || !unitKey) return null;
    return { price, unitKey, unitRaw: m[2] };
  }

  /**
   * Parse the package price from text: the largest "$X" that is NOT part of a
   * "$X/unit" listed unit price. Returns a number or null.
   */
  function parsePackagePrice(text) {
    if (!text) return null;
    // Blank out any listed unit prices so we don't pick them up as package price.
    const cleaned = text.replace(
      new RegExp(`\\$\\s*${NUM}\\s*(?:\\/|per)\\s*(?:${UNIT_PATTERN})\\b`, "ig"),
      " "
    );
    let m;
    const prices = [];
    PRICE_RE.lastIndex = 0;
    while ((m = PRICE_RE.exec(cleaned)) !== null) {
      const v = toNumber(m[1]);
      if (isFinite(v) && v > 0) prices.push(v);
    }
    if (!prices.length) return null;
    // Listings often show "$6.00 $8.00" (sale + struck-through original).
    // The current price is the lowest shown; pick the minimum to be safe.
    return Math.min(...prices);
  }

  /**
   * Parse the first plausible size from free text (title/description).
   * Returns {qty, unitKey, unitRaw} or null. Honors "N x M unit" multipliers.
   */
  function parseSize(text) {
    if (!text) return null;
    SIZE_RE.lastIndex = 0;
    let m;
    while ((m = SIZE_RE.exec(text)) !== null) {
      const mult = m[1] != null ? toNumber(m[1]) : 1;
      const base = toNumber(m[2]);
      const unitKey = resolveUnit(m[3]);
      if (!unitKey || !isFinite(base) || base <= 0) continue;
      const qty = (isFinite(mult) && mult > 0 ? mult : 1) * base;
      return { qty, unitKey, unitRaw: m[3] };
    }
    return null;
  }

  return {
    UNIT_PATTERN,
    LISTED_RE,
    SIZE_RE,
    parseListedUnitPrice,
    parsePackagePrice,
    parseSize,
    _toNumber: toNumber,
  };
});
