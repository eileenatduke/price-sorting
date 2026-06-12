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

  // Uber Eats tags every product card with data-testid="store-item-<id>".
  // This is far more reliable than guessing a card from page text/structure.
  const CARD_SELECTOR = '[data-testid^="store-item-"]';

  /**
   * Discover product cards. Primary path uses Uber Eats' own per-card test id
   * (catches every card uniformly); we fall back to the older innermost-<li>/<a>
   * text heuristic only if no tagged cards are present (e.g. a layout change).
   */
  function findCards(root, config = {}) {
    if (config.cardSelector) {
      return Array.from(root.querySelectorAll(config.cardSelector)).filter(hasPrice);
    }

    // Primary: every product card carries data-testid="store-item-<id>".
    const tagged = Array.from(root.querySelectorAll(CARD_SELECTOR)).filter(hasPrice);
    if (tagged.length) return tagged;

    // Fallback (older/edge layouts): innermost <li>/<a> that contains a price.
    const candidates = [];
    const seen = new Set();
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
    return candidates.filter(
      (el) => !candidates.some((other) => other !== el && el.contains(other))
    );
  }

  /**
   * `textContent` concatenates adjacent elements with NO separator, gluing
   * tokens together (e.g. "Coconut Oil23 fl ozSponsored"). Since our size/price
   * regexes use word boundaries, a glued unit ("ozSponsored") never matches.
   * Re-insert spaces at letter/number/word-start boundaries so the real tokens
   * are parseable again. Purely additive spacing — never changes the numbers.
   */
  function deglue(s) {
    return String(s || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2") // ozSponsored -> oz Sponsored
      .replace(/([A-Za-z])([A-Z][a-z])/g, "$1 $2") // LMany -> L Many
      .replace(/([A-Za-z])(\d)/g, "$1 $2") // Oil23 -> Oil 23
      .replace(/(\d)([A-Za-z])/g, "$1 $2"); // 16oz -> 16 oz
  }

  /**
   * Gather machine-readable text that the *visible* text may omit — image `alt`,
   * `aria-label` and `title` attributes on the card and its descendants. Uber
   * Eats frequently stashes the net weight (e.g. "20 oz (1.25 lb)") in the
   * product image's alt text even when the on-card title leaves it out, so the
   * size parser must see these too (FR-5). Defensive for the Node test's fake card.
   */
  function attrText(card) {
    const parts = [];
    const add = (v) => { if (v) parts.push(String(v)); };
    if (card.getAttribute) {
      add(card.getAttribute("aria-label"));
      add(card.getAttribute("title"));
    }
    if (typeof card.querySelectorAll === "function") {
      card.querySelectorAll("img[alt], [aria-label], [title]").forEach((n) => {
        if (!n.getAttribute) return;
        add(n.getAttribute("alt"));
        add(n.getAttribute("aria-label"));
        add(n.getAttribute("title"));
      });
    }
    return parts.join(" · ").replace(/\s+/g, " ").trim();
  }

  /**
   * Extract the fields the core engine needs from a single card.
   * Returns { node, title, text, listed, packagePrice, size }.
   */
  function extract(card) {
    const text = deglue(card.textContent || "").replace(/\s+/g, " ").trim();
    const attrs = deglue(attrText(card));
    const title =
      (card.getAttribute && card.getAttribute("aria-label")) ||
      (card.querySelector && (card.querySelector("h1,h2,h3,h4,[role='heading']") || {}).textContent) ||
      text.slice(0, 80);

    // Size can hide in alt/aria/title text, so search visible text AND those.
    const sizeText = `${title} ${text} ${attrs}`;

    return {
      node: card,
      title: (title || "").replace(/\s+/g, " ").trim().slice(0, 120),
      text,
      listed: UPS.parseListedUnitPrice(text) || UPS.parseListedUnitPrice(attrs),
      packagePrice: UPS.parsePackagePrice(text),
      size: UPS.parseSize(sizeText),
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
