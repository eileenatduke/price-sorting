/*
 * ubereats.js — Uber Eats adapter (PRD §5, FR-3/4/5).
 *
 * Heuristic, text-based card discovery: Uber Eats auto-generates and frequently
 * changes CSS class names, so we locate product cards by the price *text* they
 * contain rather than by selector. An optional `config.cardSelector` pins
 * detection to a specific element when the heuristic needs help (FR-3, NFR-5).
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  const exported = factory(UPS);
  if (UPS.registerAdapter) UPS.registerAdapter(exported.adapter);
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof self !== "undefined" ? self : globalThis, function (UPS) {
  // Detects "$3.49", "$3.49/lb", "$0.50 per fl oz" — the marker of a priced card.
  const PRICE_MARKER = /\$\s*\d+(?:[.,]\d+)?/;

  function hasPrice(el) {
    return PRICE_MARKER.test(el.textContent || "");
  }

  /**
   * Discover product cards by price text. We collect likely card containers
   * (links and list items that contain a price), then keep only the innermost
   * ones so each result is a single product, not a section wrapper.
   */
  function findCards(root, config = {}) {
    if (config.cardSelector) {
      return Array.from(root.querySelectorAll(config.cardSelector)).filter(hasPrice);
    }

    const candidates = [];
    const seen = new Set();
    // Cards on Uber Eats are typically <li> or <a href> wrappers.
    const nodeList = root.querySelectorAll("li, a[href]");
    for (const el of nodeList) {
      if (seen.has(el)) continue;
      if (!hasPrice(el)) continue;
      // A real card has a bounded amount of text; skip giant section wrappers.
      const len = (el.textContent || "").trim().length;
      if (len === 0 || len > 600) continue;
      candidates.push(el);
      seen.add(el);
    }

    // Keep innermost cards: drop any candidate that contains another candidate.
    const innermost = candidates.filter(
      (el) => !candidates.some((other) => other !== el && el.contains(other))
    );

    return innermost;
  }

  /**
   * Extract the fields the core engine needs from a single card.
   * Returns { node, title, text, listed, packagePrice, size }.
   */
  function extract(card) {
    const text = (card.textContent || "").replace(/\s+/g, " ").trim();
    const title =
      card.getAttribute("aria-label") ||
      (card.querySelector("h1,h2,h3,h4,[role='heading']") || {}).textContent ||
      text.slice(0, 80);

    return {
      node: card,
      title: (title || "").replace(/\s+/g, " ").trim().slice(0, 120),
      text,
      listed: UPS.parseListedUnitPrice(text),
      packagePrice: UPS.parsePackagePrice(text),
      size: UPS.parseSize(title) || UPS.parseSize(text),
    };
  }

  const adapter = {
    id: "ubereats",
    label: "Uber Eats",
    matches(url) {
      return /(^|\.)ubereats\.com$/i.test(new URL(url).hostname);
    },
    findCards,
    extract,
    hasPrice,
  };

  return { adapter, findCards, extract, hasPrice };
});
