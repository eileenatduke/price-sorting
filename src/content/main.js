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
  // Grocery-ness is a property of the STORE, not the page: "/store/<slug>/…"
  // identifies the store, and its category/search pages keep that prefix (search
  // just adds ?storeSearchQuery=…). So once a store is confirmed grocery we
  // remember it by that key and keep the panel on all its pages — including
  // search results, where item sizes often aren't shown. A restaurant/florist
  // has a different slug, so it never inherits this.
  function storeKey() {
    const parts = location.pathname.split("/").filter(Boolean); // ["store","<slug>",…]
    if (parts[0] === "store" && parts[1]) return "/store/" + parts[1];
    return location.pathname; // non-store pages (collection-page, etc.)
  }
  const GROCERY_KEY = "ups:groceryStore";
  let groceryStore = (function () {
    try {
      return window.sessionStorage.getItem(GROCERY_KEY);
    } catch (_) {
      return null;
    }
  })();
  function rememberGrocery(key) {
    groceryStore = key;
    try {
      window.sessionStorage.setItem(GROCERY_KEY, key);
    } catch (_) {
      /* ignore */
    }
  }

  function looksGrocery() {
    const key = storeKey();
    if (groceryStore === key) return true; // already confirmed grocery for this store

    let cards;
    try {
      cards = adapter.findCards(document, getConfig());
    } catch (_) {
      return false;
    }
    if (cards.length < 8) return false; // too few / still loading — judge later

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
    if (value) rememberGrocery(key);
    else console.info(TAG, "not a grocery-type store — sorter disabled here.");
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
  let lastKey = storeKey();
  function checkUrl() {
    if (location.href === lastHref) return;
    lastHref = location.href;

    // An item quick-view we opened over the sorted grid (global.js) is an OVERLAY,
    // not a list change — keep the sort. Drop the flag once we're back on the list.
    if (UPS._itemViewing) {
      if (UPS._listHref && location.href === UPS._listHref) UPS._itemViewing = false;
      return;
    }

    const keyChanged = storeKey() !== lastKey;
    lastKey = storeKey();
    if (UPS.clearSorted) UPS.clearSorted(document); // new page = new items, drop stale sort
    // Only tear the panel down when the STORE changes (could be non-grocery);
    // a same-store search/category keeps it and just re-sorts the new items.
    if (keyChanged) removePanel();
    scheduleEvaluate({ scroll: true });
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
