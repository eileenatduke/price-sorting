/*
 * engine.js — Orchestrates a sort run (PRD FR-2..FR-13).
 *
 * `process()` is the pure pipeline (raw items -> grouped, sorted, with stats)
 * and is unit-tested in Node. `run()` is the browser entry that loads the page,
 * asks the adapter to extract, runs the pipeline, and renders.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  Object.assign(UPS, factory(global, UPS));
  if (typeof module !== "undefined" && module.exports) module.exports = factory(global, UPS);
})(typeof self !== "undefined" ? self : globalThis, function (global, UPS) {
  /**
   * Pure pipeline. `rawItems` = adapter.extract() outputs (with `.node` optional).
   * Returns { groups, stats }.
   *   stats: { total, sorted, listed, computed, unresolved }
   */
  function process(rawItems, direction) {
    const valued = rawItems.map((raw) => {
      const valuation = UPS.valuate({
        listed: raw.listed,
        packagePrice: raw.packagePrice,
        size: raw.size,
      });
      return { ...raw, valuation };
    });

    const groups = UPS.groupItems(valued).map((g) => ({
      ...g,
      items: UPS.sortItems(g.items, direction),
    }));

    const stats = { total: valued.length, sorted: 0, listed: 0, computed: 0, unresolved: 0 };
    for (const v of valued) {
      const src = v.valuation.source;
      if (src === "listed") stats.listed++;
      else if (src === "computed") stats.computed++;
      if (src) stats.sorted++;
      else stats.unresolved++;
    }
    return { groups, stats };
  }

  function statusMsg(stats) {
    return (
      `${stats.total} items · ${stats.sorted} sorted ` +
      `(${stats.listed} listed, ${stats.computed} computed) · ` +
      `${stats.unresolved} no price`
    );
  }

  // Cache of the last GLOBAL (snapshot) sort lives on UPS._lastGlobal (tagged with
  // its URL) so the content script can invalidate it on store/category changes,
  // and a resize can re-show the same grid cheaply without re-scanning.

  function inPlace(adapter, config, direction, doc) {
    const cards = adapter.findCards(doc, config);
    const rawItems = cards.map((c) => adapter.extract(c));
    const { groups, stats } = process(rawItems, direction);
    stats.moved = UPS.apply(groups, doc);
    return { groups, stats };
  }

  /**
   * Browser run: scan the page, then either reorder the live grid in place (the
   * whole list fits in the DOM) or — when Uber virtualizes/recycles the cards —
   * snapshot every item and show our own globally-sorted grid (global.js).
   * `ctx` = { adapter, config, panel, noScroll }. Returns { stats, mode }.
   */
  async function run(ctx) {
    const { adapter, config = {}, panel, noScroll = false } = ctx;
    const doc = global.document;
    const direction = panel ? panel.getDirection() : UPS.DIRECTION.ASC;

    panel && panel.setBusy(true);

    // Cheap re-apply after a resize/re-render (no re-scan) — only reuse the cache
    // for the SAME page, never across a category/store change.
    if (noScroll) {
      const lg = UPS._lastGlobal;
      if (lg && lg.url === global.location.href) {
        const liveGrid = UPS.findGrid(adapter.findCards(doc, config)).container;
        UPS.showSorted(lg.groups, doc, liveGrid);
        panel && panel.setBusy(false);
        return { stats: lg.stats, mode: "global" };
      }
      const { stats } = inPlace(adapter, config, direction, doc);
      panel && panel.setBusy(false);
      panel && panel.setStatus(statusMsg(stats), "ok");
      return { stats, mode: "inplace" };
    }

    // Full run: scan the whole list once, capturing a snapshot of every card.
    panel && panel.setStatus("Scanning all items…");
    const { byId, virtualized } = await UPS.collectAll(adapter, config, panel);

    if (virtualized) {
      // Global mode: build our own sorted grid from the snapshot (beats recycling).
      const items = [...byId.entries()].map(([testid, node]) => {
        const ex = adapter.extract(node);
        return { testid, node, listed: ex.listed, packagePrice: ex.packagePrice, size: ex.size };
      });
      const { groups, stats } = process(items, direction);
      const liveGrid = UPS.findGrid(adapter.findCards(doc, config)).container;
      stats.moved = UPS.showSorted(groups, doc, liveGrid);
      UPS._lastGlobal = { groups, stats, url: global.location.href };
      panel && panel.setBusy(false);
      panel && panel.setStatus(statusMsg(stats) + " · full sorted view", "ok");
      return { stats, mode: "global" };
    }

    // Not virtualized — reorder the live cards in place (keeps them interactive).
    UPS._lastGlobal = null;
    panel && panel.setStatus("Sorting…");
    const { stats } = inPlace(adapter, config, direction, doc);
    panel && panel.setBusy(false);
    panel && panel.setStatus(statusMsg(stats), "ok");
    return { stats, mode: "inplace" };
  }

  return { process, run };
});
