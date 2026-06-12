/*
 * global.js — "True global sort" for virtualized grids (PRD R-1). Browser-only.
 *
 * Uber Eats keeps only a sliding window of product cards in the DOM and recycles
 * them as you scroll, so we can't reorder items that aren't rendered. Instead we
 * scroll the whole list once, SNAPSHOT (clone) every card as it appears, then
 * build our own static grid of all items in sorted order and show it in place of
 * Uber's live grid.
 *
 * Trade-off: snapshot cards are static copies — ideal for browsing/comparing by
 * unit price; the live "+"/Quick view stays on Uber's hidden grid. Clicking a
 * snapshot scrolls the (hidden→shown) real grid to the matching item.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  Object.assign(UPS, factory(global, UPS));
  if (typeof module !== "undefined" && module.exports) module.exports = factory(global, UPS);
})(typeof self !== "undefined" ? self : globalThis, function (global, UPS) {
  const SORTED_GRID_CLASS = "ups-sorted-grid";
  // While this class is on <html>, panel.css hides every LIVE product card via a
  // stylesheet !important rule — which beats Uber's inline styles and survives
  // React re-renders (toggling the container's own display did not). Our clones
  // carry no data-testid, so they're unaffected.
  const ACTIVE_CLASS = "ups-global-active";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Does a string contain a size token at all?
  const SIZE_HINT = /\d+(?:[.,]\d+)?\s*(?:fl\s*oz|oz|ounce|lb|lbs|pound|kg|g|ml|l|gal|qt|pt|ct|count|pk|pack|each|ea)\b/i;
  // Is a string ENTIRELY a size (a standalone size label, e.g. "23 fl oz")?
  const PURE_SIZE = /^\s*\d+(?:[.,]\d+)?\s*(?:fl\s*oz|fluid\s*ounces?|oz|ounces?|lbs?|pounds?|kg|g|ml|l|gal|qt|pt|ct|count|pk|packs?|each|ea)(?:\s*[•·,]\s*\d+(?:[.,]\d+)?\s*[a-z][a-z .]*)?\s*$/i;

  // Collect every standalone size label currently on screen, with its position.
  function collectSizeLabels(doc) {
    const labels = [];
    doc.querySelectorAll("div, span, p").forEach((n) => {
      if (n.firstElementChild) return; // leaf elements only
      const t = (n.textContent || "").trim();
      if (!t || t.length > 24 || !PURE_SIZE.test(t)) return;
      const r = n.getBoundingClientRect();
      if (r.width) labels.push({ t, r });
    });
    return labels;
  }

  // Some Uber cards (sponsored / certain layouts) render the size as a label
  // positioned visually UNDER the card but not inside its DOM. Find it by
  // geometry: the closest standalone size label directly below the card and
  // horizontally within it.
  function sizeBelow(card, labels) {
    if (!card.getBoundingClientRect) return null;
    const r = card.getBoundingClientRect();
    if (!r.width) return null;
    let best = null;
    let bestGap = Infinity;
    for (const { t, r: nr } of labels) {
      const gap = nr.top - r.bottom;
      if (gap < -8 || gap > 140) continue; // must sit just under the card
      if (nr.left < r.left - 14 || nr.right > r.right + 14) continue; // horizontally within
      if (gap < bestGap) { bestGap = gap; best = t; }
    }
    return best;
  }

  /**
   * Scroll the whole list once, cloning every card (deduped by data-testid).
   * Returns { byId: Map<id, cloneNode>, virtualized: bool }.
   */
  async function collectAll(adapter, config = {}, panel) {
    const doc = global.document;
    // Show the real page while scanning so cards render normally as we scroll.
    doc.documentElement.classList.remove(ACTIVE_CLASS);
    doc.querySelectorAll("." + SORTED_GRID_CLASS).forEach((n) => n.remove());

    const scroller = doc.scrollingElement || doc.documentElement;
    const byId = new Map();
    let stable = 0;
    let lastCount = -1;

    const capture = () => {
      const cards = adapter.findCards(doc, config);
      let labels = null; // computed lazily, only when a card lacks an in-DOM size
      for (const el of cards) {
        const id = el.getAttribute("data-testid") || "ups-" + (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
        const existing = byId.get(id);
        if (existing && existing.__upsSized) continue; // already captured WITH a size

        const elHasSize = SIZE_HINT.test(el.textContent || "");
        let injected = null;
        if (!elHasSize) {
          if (!labels) labels = collectSizeLabels(doc);
          injected = sizeBelow(el, labels); // size rendered just under the card
        }

        const clone = el.cloneNode(true);
        // Strip data-testid from the clone so findCards never re-detects our
        // snapshot as a live card (the id stays as the Map key for click-through).
        clone.removeAttribute("data-testid");
        clone.querySelectorAll("[data-testid]").forEach((n) => n.removeAttribute("data-testid"));
        if (injected) {
          // Carry the geometric size into the clone (hidden) so extract() sees it.
          const tag = doc.createElement("span");
          tag.textContent = " " + injected;
          tag.style.display = "none";
          clone.appendChild(tag);
        }
        clone.__upsSized = elHasSize || !!injected;
        byId.set(id, clone);
      }
    };

    for (let tick = 0; tick < 800; tick++) {
      capture();
      if (panel) panel.setStatus("Scanning all items… (" + byId.size + ")");
      const atBottom = global.scrollY + global.innerHeight >= scroller.scrollHeight - 4;
      if (byId.size === lastCount && atBottom) {
        if (++stable >= 5) break;
      } else {
        stable = 0;
      }
      lastCount = byId.size;
      global.scrollBy(0, Math.max(600, Math.floor(global.innerHeight * 0.9)));
      await sleep(130);
    }

    global.scrollTo(0, 0);
    await sleep(220);
    capture(); // catch anything that mounted on the way back to the top

    const finalLive = adapter.findCards(doc, config).length;
    const virtualized = byId.size > 0 && finalLive < byId.size * 0.9;
    return { byId, virtualized };
  }

  /**
   * Build and show our own sorted grid from the snapshot, hiding Uber's live grid.
   * `groups` carry items with { node: clone, valuation, testid }. Returns count shown.
   */
  function showSorted(groups, doc, anchor) {
    doc.querySelectorAll("." + SORTED_GRID_CLASS).forEach((n) => n.remove());

    const our = doc.createElement("div");
    our.className = SORTED_GRID_CLASS + " ups-grid";

    let count = 0;
    for (const group of groups) {
      const items = group.items.filter((it) => it.node);
      if (!items.length) continue;

      // Full-width category header (e.g. "Price per pound ($/lb)").
      const header = doc.createElement("div");
      header.className = "ups-cat-header";
      header.textContent = group.label + "  (" + items.length + ")";
      our.appendChild(header);

      for (const item of items) {
        const cell = doc.createElement("div");
        cell.className = "ups-cell";
        cell.appendChild(item.node); // the clone

        if (item.valuation && item.valuation.canonicalPrice != null) {
          const line = doc.createElement("div");
          line.className = "ups-unit";
          line.textContent = "$" + item.valuation.displayPrice.toFixed(2) + "/" + item.valuation.canonicalUnit;
          cell.appendChild(line);
        }

        // Click a snapshot → reveal Uber's real card so the user can add it.
        if (item.testid) {
          cell.style.cursor = "pointer";
          cell.addEventListener("click", () => revealReal(doc, item.testid));
        }

        our.appendChild(cell);
        count++;
      }
    }

    // Insert our grid where the live grid sits; CSS (.ups-global-active) hides the
    // live cards. Insertion point is just an anchor — its cards are hidden by class.
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(our, anchor);
    } else {
      doc.body.appendChild(our);
    }
    doc.documentElement.classList.add(ACTIVE_CLASS);
    return count;
  }

  /** Restore Uber's live cards and scroll to the chosen real card so it can be added. */
  function revealReal(doc, testid) {
    doc.documentElement.classList.remove(ACTIVE_CLASS);
    doc.querySelectorAll("." + SORTED_GRID_CLASS).forEach((n) => n.remove());
    const real = doc.querySelector('[data-testid="' + testid + '"]');
    if (real && real.scrollIntoView) real.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /**
   * Tear down the global sorted view and invalidate its cache. Called when the
   * store/category changes so a stale snapshot can't linger or hide the new page.
   */
  function clearSorted(doc) {
    doc.documentElement.classList.remove(ACTIVE_CLASS);
    doc.querySelectorAll("." + SORTED_GRID_CLASS).forEach((n) => n.remove());
    UPS._lastGlobal = null;
  }

  return { collectAll, showSorted, clearSorted, SORTED_GRID_CLASS };
});
