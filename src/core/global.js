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
      for (const el of adapter.findCards(doc, config)) {
        const id = el.getAttribute("data-testid") || "ups-" + (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
        const clone = el.cloneNode(true);
        // Strip data-testid from the clone so findCards never re-detects our
        // snapshot as a live card (the id stays as the Map key for click-through).
        clone.removeAttribute("data-testid");
        clone.querySelectorAll("[data-testid]").forEach((n) => n.removeAttribute("data-testid"));
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

        cell.style.cursor = "pointer";
        our.appendChild(cell);
        count++;
      }
    }

    // One delegated handler: clicking a snapshot opens the REAL item popup over
    // the sorted grid via client-side navigation (no reload, sort preserved).
    our.addEventListener("click", (e) => openItem(e, doc), true);

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

  /**
   * Open the real Uber item popup for a clicked snapshot card. The clone carries
   * the item's URL in its <a href>; we prevent the default (which would full-page
   * reload) and instead drive Uber's SPA router with pushState + popstate, so the
   * quick-view opens as an OVERLAY on top of our sorted grid. We flag this on UPS
   * so the content script keeps the sort across the item route (main.js).
   */
  function openItem(e, doc) {
    const cell = e.target.closest && e.target.closest(".ups-cell");
    if (!cell) return;
    const a = cell.querySelector("a[href]");
    const href = a && a.href;
    e.preventDefault();
    e.stopPropagation();
    if (!href) return;
    UPS._listHref = global.location.href; // the list we'll return to
    UPS._itemViewing = true;
    global.history.pushState({}, "", href);
    global.dispatchEvent(new global.PopStateEvent("popstate", { state: global.history.state }));
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
