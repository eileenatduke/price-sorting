/*
 * scroll.js — Single-pass full-page load (PRD FR-2) + virtualization probe (R-1).
 *
 * Browser-only (uses window/document). On click we auto-scroll to force every
 * item to render, then return to the top so the user never scrolls manually.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  Object.assign(UPS, factory(global, UPS));
  if (typeof module !== "undefined" && module.exports) module.exports = factory(global, UPS);
})(typeof self !== "undefined" ? self : globalThis, function (global, UPS) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Tunable scroll pacing (NFR-2). step = px per tick, delay = ms between ticks.
  const DEFAULTS = { step: 1200, delay: 120, maxTicks: 400, settleTicks: 4 };

  /**
   * Auto-scroll the page to the bottom to render all items, counting cards via
   * `countCards()` along the way, then scroll back to top.
   *
   * Returns { maxSeen, finalCount, virtualized } where:
   *   maxSeen     — most cards ever simultaneously in the DOM during the pass
   *   finalCount  — cards in the DOM at the end (back at top)
   *   virtualized — true if the DOM appears to recycle cards (R-1)
   */
  async function autoLoad(countCards, opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };
    const win = global;
    const doc = global.document;
    const scroller = doc.scrollingElement || doc.documentElement;

    let maxSeen = 0;
    let stable = 0;
    let lastHeight = -1;

    for (let tick = 0; tick < cfg.maxTicks; tick++) {
      const seen = countCards();
      if (seen > maxSeen) maxSeen = seen;

      const height = scroller.scrollHeight;
      const atBottom = win.scrollY + win.innerHeight >= height - 4;

      if (height === lastHeight && atBottom) {
        if (++stable >= cfg.settleTicks) break;
      } else {
        stable = 0;
      }
      lastHeight = height;

      win.scrollBy(0, cfg.step);
      await sleep(cfg.delay);
    }

    // Return to top (FR-2) and let a final render settle.
    win.scrollTo(0, 0);
    await sleep(cfg.delay * 2);

    const finalCount = countCards();
    // If the DOM holds materially fewer cards than we saw at peak, the grid is
    // recycling off-screen cards — in-place reordering can't cover everything.
    const virtualized = finalCount < maxSeen * 0.9 && maxSeen > 0;

    return { maxSeen, finalCount, virtualized };
  }

  return { autoLoad, _scrollDefaults: DEFAULTS };
});
