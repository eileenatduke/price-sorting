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

  // "N-pack of per-item weight": "6 ct • 1.06 oz", "12 pack 1.06 oz", "2 x 12 oz".
  // The per-item weight must come IMMEDIATELY after the count (only spaces, a
  // bullet, or a comma between) so we multiply genuine per-item specs but NOT a
  // total like "(25 oz, 30 ct) 750 oz", where ")" breaks the adjacency.
  const PACK_RE = new RegExp(
    `(${NUM})\\s*(?:ct|cnt|count|pk|packs?|pcs?|pieces?|ea|each|x|×)\\b[\\s•·,]*(${NUM})\\s*(${UNIT_PATTERN})\\b`,
    "i"
  );

  // Coupon / discount amounts that are NOT the item's price, e.g.
  // "Claim $0.25 off", "$1 off", "save $2", "get $0.50 back". Stripped before
  // we read the package price so a coupon can't be mistaken for a cheap price.
  const DISCOUNT_RE = new RegExp(
    `\\b(?:claim|save|get|earn|coupon)\\s*\\$\\s*${NUM}|\\$\\s*${NUM}\\s*(?:off|back|cash\\s*back|coupon)\\b`,
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
    // Blank out listed unit prices AND coupon/discount amounts so neither is
    // mistaken for the package price.
    const cleaned = text
      .replace(new RegExp(`\\$\\s*${NUM}\\s*(?:\\/|per)\\s*(?:${UNIT_PATTERN})\\b`, "ig"), " ")
      .replace(DISCOUNT_RE, " ");
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
   * Parse the best size from free text (title/description). Honors "N x M unit"
   * multipliers. Returns {qty, unitKey, unitRaw} or null.
   *
   * A card can carry conflicting sizes — a typo in the name ("20.5 lbs" instead
   * of "20.5 oz") or a bogus size field ("750 oz" for tortillas) — alongside the
   * real one. The error always *inflates* the size, so among weight/volume
   * candidates we pick the SMALLEST canonical size (preferring weight, then
   * volume, then count). That self-corrects both failure modes.
   */
  function parseSize(text) {
    if (!text) return null;

    // "N ct • W oz" can mean N items of W *each* (multiply to get the box total).
    // But the SAME shape appears when W is already the package TOTAL ("12 ct,
    // 14 oz" = a 14 oz box of 12). The two are indistinguishable in text, so we
    // only multiply when W is small enough to be a single serving; a larger W is
    // the total and is used directly by the candidate logic below. (Explicit
    // "2 x 12 oz" multipliers are still handled there via SIZE_RE.)
    const PER_ITEM_MAX = {
      [UPS.FAMILY.WEIGHT]: 0.25, // lb (~4 oz): a single bar/waffle/pouch/cup
      [UPS.FAMILY.VOLUME]: 20, // fl oz: a single can/bottle
    };
    const pack = PACK_RE.exec(text);
    if (pack) {
      const n = toNumber(pack[1]);
      const per = toNumber(pack[2]);
      const unitKey = resolveUnit(pack[3]);
      const u = unitKey && UPS.UNITS[unitKey];
      if (
        u &&
        (u.family === UPS.FAMILY.WEIGHT || u.family === UPS.FAMILY.VOLUME) &&
        isFinite(n) && n > 0 && isFinite(per) && per > 0 &&
        per / u.factor <= PER_ITEM_MAX[u.family]
      ) {
        return { qty: n * per, unitKey, unitRaw: pack[3] };
      }
    }

    SIZE_RE.lastIndex = 0;
    let m;
    const cands = [];
    while ((m = SIZE_RE.exec(text)) !== null) {
      const mult = m[1] != null ? toNumber(m[1]) : 1;
      const base = toNumber(m[2]);
      const unitKey = resolveUnit(m[3]);
      if (!unitKey || !isFinite(base) || base <= 0) continue;
      const u = UPS.UNITS[unitKey];
      if (!u) continue;
      const qty = (isFinite(mult) && mult > 0 ? mult : 1) * base;
      cands.push({ qty, unitKey, unitRaw: m[3], family: u.family, canonical: qty / u.factor });
    }
    if (!cands.length) return null;

    // A "tiny" candidate (below these canonical sizes) is usually a nutrition
    // fact ("6g") or a per-serving value, not the package size. But a genuinely
    // tiny product (0.35 oz seaweed, 0.7 oz jel dessert) may have no larger size
    // at all — so we drop the tiny ones ONLY when a real size remains in the
    // same family; otherwise we keep them. Among the kept set the smallest wins,
    // which still defeats inflated errors (a "20.5 lbs" typo, a bogus "750 oz").
    const MIN_CANONICAL = {
      [UPS.FAMILY.WEIGHT]: 0.05, // lb (~0.8 oz)
      [UPS.FAMILY.VOLUME]: 0.3, // fl oz
      [UPS.FAMILY.COUNT]: 1, // each
    };
    // Prefer VOLUME first: a volume unit (fl oz, L, gal) means the item is a
    // liquid, priced by volume — Uber often lists a wrong density-derived weight
    // in the name, which we must NOT pick. Then weight, then count.
    const order = [UPS.FAMILY.VOLUME, UPS.FAMILY.WEIGHT, UPS.FAMILY.COUNT];
    for (const fam of order) {
      const all = cands.filter((c) => c.family === fam);
      if (!all.length) continue;
      const real = all.filter((c) => c.canonical >= MIN_CANONICAL[fam]);
      const pick = (real.length ? real : all).sort((a, b) => a.canonical - b.canonical)[0];
      return { qty: pick.qty, unitKey: pick.unitKey, unitRaw: pick.unitRaw };
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
