/*
 * discovery.js — DOM discovery helper (PRD R-2, NFR-5).
 *
 * Paste this whole file into the DevTools Console while on an Uber Eats store
 * page. It reports how many priced cards the heuristic finds, suggests a stable
 * `cardSelector` you can pin via `window.__UPS_CONFIG__`, and prints a few
 * sample extractions so you can re-tune after a site redesign.
 *
 * It does NOT modify the page.
 */
(function () {
  const PRICE_MARKER = /\$\s*\d+(?:[.,]\d+)?/;
  const LISTED = /\$\s*\d+(?:[.,]\d+)?\s*(?:\/|per)\s*[a-z ]+/i;

  function hasPrice(el) {
    return PRICE_MARKER.test(el.textContent || "");
  }

  // Mirror the adapter's innermost-card heuristic.
  function findCards() {
    const candidates = [];
    document.querySelectorAll("li, a[href]").forEach((el) => {
      const len = (el.textContent || "").trim().length;
      if (hasPrice(el) && len > 0 && len <= 600) candidates.push(el);
    });
    return candidates.filter(
      (el) => !candidates.some((o) => o !== el && el.contains(o))
    );
  }

  // Suggest a selector by finding the most common tag + first stable-ish attr.
  function suggestSelector(cards) {
    const tagCounts = {};
    cards.forEach((c) => (tagCounts[c.tagName.toLowerCase()] = (tagCounts[c.tagName.toLowerCase()] || 0) + 1));
    const tag = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0];
    const sample = cards.find((c) => c.tagName.toLowerCase() === (tag && tag[0]));
    let attrHint = "";
    if (sample) {
      for (const attr of ["data-testid", "role"]) {
        const v = sample.getAttribute(attr);
        if (v) {
          attrHint = `[${attr}="${v}"]`;
          break;
        }
      }
    }
    return tag ? `${tag[0]}${attrHint}` : null;
  }

  const cards = findCards();
  const parents = new Map();
  cards.forEach((c) => parents.set(c.parentElement, (parents.get(c.parentElement) || 0) + 1));
  const dominant = [...parents.entries()].sort((a, b) => b[1] - a[1])[0];

  console.group("%cUnit Price Sorter — discovery", "color:#06c167;font-weight:bold");
  console.log("Priced cards found:", cards.length);
  console.log("Suggested cardSelector:", suggestSelector(cards));
  console.log("Dominant grid container:", dominant ? dominant[0] : null, "holds", dominant ? dominant[1] : 0, "cards");
  console.log("Pin it with:  window.__UPS_CONFIG__ = { cardSelector: '…' }");
  console.log("Samples:");
  cards.slice(0, 5).forEach((c, i) => {
    const text = (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    console.log(`  [${i}]`, { listed: LISTED.test(text), text, node: c });
  });
  console.groupEnd();

  return cards;
})();
