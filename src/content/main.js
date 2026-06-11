/*
 * main.js — Content-script entry (PRD FR-1/14). Browser-only.
 *
 * Wires the matching adapter to the panel + engine, and keeps BOTH the panel
 * and the *sort result* alive for the lifetime of the tab: once the user sorts,
 * the extension re-applies automatically across Uber Eats' SPA navigation,
 * React re-renders, and window resizes. State lives in sessionStorage, so it
 * survives reloads and category changes but resets when the tab is closed.
 */
(function () {
  const TAG = "[Unit Price Sorter]";
  const UPS = window.UPS;
  if (!UPS) {
    console.warn(TAG, "core namespace missing — content scripts failed to load.");
    return;
  }
  console.info(TAG, "content script loaded on", location.href);

  // Optional per-site config override (FR-3 cardSelector, NFR-5).
  function getConfig() {
    return Object.assign({}, window.__UPS_CONFIG__ || {});
  }

  const adapter = UPS.getAdapter(location.href);
  if (!adapter) {
    console.warn(TAG, "no adapter matched this URL — panel not injected.");
    return; // not a supported platform
  }
  console.info(TAG, "adapter:", adapter.id, "— injecting panel.");

  // ---- Tab-scoped sticky state -------------------------------------------
  // sessionStorage is per-tab + per-origin and cleared when the tab closes —
  // exactly the requested lifetime ("only reset when I exit the whole tab").
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

  // Run a sort. `noScroll` re-applies to already-loaded items (resize/re-render)
  // without the full auto-scroll; full runs (click, navigation) load the page.
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

  // Panel button → explicit, full sort (also arms stickiness).
  function onSort() {
    return runSort({ noScroll: false });
  }

  function ensurePanel() {
    if (!UPS.panelPresent()) UPS.createPanel(onSort, { direction: state.direction });
  }
  ensurePanel();

  // ---- Sticky re-sorting --------------------------------------------------
  // The grid is "sorted" iff our invisible marker is in the DOM. A resize, React
  // re-render, or SPA category change wipes it; when that happens and sorting is
  // armed, re-apply (debounced so the page can settle first).
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

  let debounce = null;
  let pendingScroll = false; // if any pending trigger wants a full page load
  function scheduleResort({ scroll = false } = {}) {
    if (!state.active || running) return;
    pendingScroll = pendingScroll || scroll;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!state.active || running) return;
      if (isSorted()) {
        pendingScroll = false;
        return; // still sorted — nothing to do
      }
      if (!hasCards()) return; // content not ready yet; a later trigger retries
      const noScroll = !pendingScroll;
      pendingScroll = false;
      runSort({ noScroll });
    }, 400);
  }

  // FR-14: re-inject the panel and re-assert the sort on any DOM change. Also
  // catch store/category navigation here, since a content script can't reliably
  // intercept the page's own pushState — location.href is the reliable signal.
  const mo = new MutationObserver(() => {
    if (running) return; // ignore our own mutations
    checkUrl(); // store/category change → clear stale view + re-scan
    ensurePanel();
    scheduleResort({ scroll: false }); // re-render/resize: items already loaded
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Resizing (full-screen ⇆ windowed) re-lays-out the grid and drops our order.
  window.addEventListener("resize", () => scheduleResort({ scroll: false }));

  // SPA route changes (store/category x → y) — drop the stale sorted view and
  // re-scan the new page from scratch so it never shows the previous category.
  let lastHref = location.href;
  const checkUrl = () => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (UPS.clearSorted) UPS.clearSorted(document); // invalidate old snapshot + un-hide new cards
      if (UPS.getAdapter(location.href)) {
        ensurePanel();
        scheduleResort({ scroll: true });
      }
    }
  };
  for (const m of ["pushState", "replaceState"]) {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      checkUrl();
      return r;
    };
  }
  window.addEventListener("popstate", checkUrl);

  // On (re)load, if sorting was armed in this tab, resume it automatically.
  if (state.active) scheduleResort({ scroll: true });
})();
