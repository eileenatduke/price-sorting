/*
 * main.js — Content-script entry (PRD FR-1/14). Browser-only.
 *
 * Wires the matching adapter to the panel + engine, keeps the sort sticky for
 * the tab (sessionStorage), and — crucially — only activates on grocery-type
 * stores where items have weights/sizes. Restaurants, florists, and anything
 * else that can't be sorted by unit price are left untouched.
 */
(function () {
  const TAG = "[Unit Price Sorter]";
  const UPS = window.UPS;
  if (!UPS) {
    console.warn(TAG, "core namespace missing — content scripts failed to load.");
    return;
  }
  console.info(TAG, "content script loaded on", location.href);

  function getConfig() {
    return Object.assign({}, window.__UPS_CONFIG__ || {});
  }

  const adapter = UPS.getAdapter(location.href);
  if (!adapter) {
    console.warn(TAG, "no adapter matched this URL.");
    return;
  }

  // ---- Tab-scoped sticky state (cleared only when the tab closes) ----------
  const STORAGE_KEY = "ups:sortState";
  function loadState() {
    try {
      return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)) || {};
    } catch (_) {
      return {};
    }
  }
  function saveState(s) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (_) {
      /* private mode / disabled storage — degrade to in-memory only */
    }
  }
  let state = loadState(); // { active: bool, direction: "asc" | "desc" }

  let running = false;

  async function runSort({ noScroll = false } = {}) {
    if (running) return;
    running = true;
    const panel = UPS.createPanel(onSort, { direction: state.direction });
    try {
      await UPS.run({ adapter, config: getConfig(), panel, noScroll });
      state = { active: true, direction: panel.getDirection() };
      saveState(state);
    } catch (err) {
      console.error(TAG, err);
      panel.setBusy(false);
      panel.setStatus("Something went wrong — see console.", "warn");
    } finally {
      running = false;
    }
  }

  function onSort() {
    return runSort({ noScroll: false });
  }

  function ensurePanel() {
    if (!UPS.panelPresent()) UPS.createPanel(onSort, { direction: state.direction });
  }
  function removePanel() {
    const el = document.getElementById(UPS.PANEL_ID);
    if (el) el.remove();
  }

  // ---- Grocery gate -------------------------------------------------------
  // Per-unit sorting only makes sense where items have weights/sizes (grocery,
  // produce, meat, packaged foods). Restaurants, florists, etc. sell unitless
  // items, so we don't activate there at all. Heuristic: a meaningful fraction
  // of detected items carry a parseable size or a listed "$/unit" price. A
  // positive result is cached per URL (negative is re-checked cheaply as the
  // page loads, so a still-loading grocery store isn't locked out).
  let groceryCache = { url: null, value: false, count: 0 };
  function looksGrocery() {
    const url = location.href;
    let cards;
    try {
      cards = adapter.findCards(document, getConfig());
    } catch (_) {
      return false;
    }
    const n = cards.length;
    // Reuse the verdict for this URL unless a lot more items have since loaded
    // (which could change the answer) — keeps a settled restaurant from being
    // re-scanned every tick, while a still-loading grocery store gets re-judged.
    if (groceryCache.url === url && n <= groceryCache.count * 1.5 + 5) {
      return groceryCache.value;
    }
    if (n < 8) return false; // too few / still loading — don't cache yet

    const sample = cards.slice(0, 40);
    let sized = 0;
    for (const c of sample) {
      try {
        const ex = adapter.extract(c);
        if (ex.listed || ex.size) sized++;
      } catch (_) {
        /* ignore a bad card */
      }
    }
    const value = sized / sample.length >= 0.4;
    groceryCache = { url, value, count: n };
    if (!value) console.info(TAG, "not a grocery-type store — sorter disabled here.");
    return value;
  }

  function isSorted() {
    // In-place mode drops an invisible marker; global mode shows our sorted grid.
    return !!document.querySelector("." + UPS.MARKER_CLASS + ", ." + UPS.SORTED_GRID_CLASS);
  }
  function hasCards() {
    try {
      return adapter.findCards(document, getConfig()).length > 0;
    } catch (_) {
      return false;
    }
  }

  // ---- Single debounced evaluator: gate, then (re)sort if armed ------------
  let evalTimer = null;
  let pendingScroll = false;
  function scheduleEvaluate({ scroll = false } = {}) {
    pendingScroll = pendingScroll || scroll;
    clearTimeout(evalTimer);
    evalTimer = setTimeout(runEvaluate, 400);
  }
  function runEvaluate() {
    if (running) return;

    if (!looksGrocery()) {
      // Not unit-priceable — make sure nothing of ours is on the page.
      if (UPS.panelPresent() || isSorted()) {
        removePanel();
        if (UPS.clearSorted) UPS.clearSorted(document);
      }
      pendingScroll = false;
      return;
    }

    // Grocery store: show the panel; keep it sorted if the user armed sorting.
    ensurePanel();
    if (state.active && !isSorted() && hasCards()) {
      const noScroll = !pendingScroll;
      pendingScroll = false;
      runSort({ noScroll });
    } else {
      pendingScroll = false;
    }
  }

  // ---- Navigation: re-judge the new store/category from scratch ------------
  let lastHref = location.href;
  function checkUrl() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      groceryCache = { url: null, value: false }; // re-evaluate store type
      if (UPS.clearSorted) UPS.clearSorted(document); // drop stale snapshot
      removePanel(); // hide until the new page is judged grocery-or-not
      scheduleEvaluate({ scroll: true });
    }
  }

  // ---- Triggers -----------------------------------------------------------
  // A content script can't reliably intercept the page's pushState, so we watch
  // location.href inside the MutationObserver (fires during navigation) too.
  const mo = new MutationObserver(() => {
    if (running) return; // ignore our own mutations
    checkUrl();
    scheduleEvaluate({ scroll: false });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("resize", () => scheduleEvaluate({ scroll: false }));

  for (const m of ["pushState", "replaceState"]) {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      checkUrl();
      return r;
    };
  }
  window.addEventListener("popstate", checkUrl);

  // Initial evaluation (full sort if sorting was already armed in this tab).
  scheduleEvaluate({ scroll: !!state.active });
})();
