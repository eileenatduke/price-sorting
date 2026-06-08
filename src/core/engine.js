/*
 * engine.js — Orchestrates a sort run (PRD FR-2..FR-13).
 *
 * `process()` is the pure pipeline (raw items -> grouped, sorted, with stats)
 * and is unit-tested in Node. `run()` is the browser entry that loads the page,
 * asks the adapter to extract, runs the pipeline, and renders.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  Object.assign(UPS, factory(UPS));
  if (typeof module !== "undefined" && module.exports) module.exports = factory(UPS);
})(typeof self !== "undefined" ? self : globalThis, function (UPS) {
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

  /**
   * Browser run: load the whole page, extract via adapter, process, render.
   * `ctx` = { adapter, config, panel }. Returns the final stats.
   */
  async function run(ctx) {
    const { adapter, config = {}, panel } = ctx;
    const doc = global.document;

    panel && panel.setBusy(true);
    panel && panel.setStatus("Loading full page…");

    const countCards = () => adapter.findCards(doc, config).length;
    const load = await UPS.autoLoad(countCards, config.scroll);

    panel && panel.setStatus("Reading items…");
    const cards = adapter.findCards(doc, config);
    const rawItems = cards.map((c) => adapter.extract(c));

    const direction = panel ? panel.getDirection() : UPS.DIRECTION.ASC;
    const { groups, stats } = process(rawItems, direction);

    panel && panel.setStatus("Sorting…");
    const moved = UPS.apply(groups, doc);
    stats.moved = moved;

    panel && panel.setBusy(false);

    // Status feedback (FR-12) with a virtualization warning (R-1).
    let msg =
      `${stats.total} items · ${stats.sorted} sorted ` +
      `(${stats.listed} listed, ${stats.computed} computed) · ` +
      `${stats.unresolved} no price`;
    let kind = "ok";
    if (load.virtualized) {
      msg += ` ⚠ page recycles cards while scrolling — some items may be missing.`;
      kind = "warn";
    }
    panel && panel.setStatus(msg, kind);
    return { stats, load };
  }

  return { process, run };
});
