/*
 * main.js — Content-script entry (PRD FR-1/14). Browser-only.
 *
 * Wires the matching adapter to the panel + engine, and keeps the panel alive
 * across Uber Eats' in-app (SPA) navigation by re-injecting if React removes it.
 */
(function () {
  const TAG = "[Unit Price Sorter]";
  const UPS = window.UPS;
  if (!UPS) {
    console.warn(TAG, "core namespace missing — content scripts failed to load.");
    return;
  }
  console.info(TAG, "content script loaded on", location.href);

  // Optional per-site config override (FR-3 cardSelector, NFR-5). A power user
  // can set `window.__UPS_CONFIG__ = { cardSelector: '...' }` before/after load.
  function getConfig() {
    return Object.assign({}, window.__UPS_CONFIG__ || {});
  }

  const adapter = UPS.getAdapter(location.href);
  if (!adapter) {
    console.warn(TAG, "no adapter matched this URL — panel not injected.");
    return; // not a supported platform
  }
  console.info(TAG, "adapter:", adapter.id, "— injecting panel.");

  let running = false;

  async function onSort(/* direction read from panel */) {
    if (running) return;
    running = true;
    const panel = UPS.createPanel(onSort);
    try {
      await UPS.run({ adapter, config: getConfig(), panel });
    } catch (err) {
      console.error("[Unit Price Sorter]", err);
      panel.setBusy(false);
      panel.setStatus("Something went wrong — see console.", "warn");
    } finally {
      running = false;
    }
  }

  function ensurePanel() {
    if (!UPS.panelPresent()) UPS.createPanel(onSort);
  }

  // Initial injection.
  ensurePanel();

  // FR-14: re-inject the panel if SPA navigation/React re-render removes it.
  const mo = new MutationObserver(() => {
    if (!UPS.panelPresent()) ensurePanel();
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Some SPA route changes don't touch <body>; watch URL via history hooks too.
  let lastHref = location.href;
  const checkUrl = () => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      // Re-evaluate adapter match and ensure the panel persists.
      if (UPS.getAdapter(location.href)) ensurePanel();
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
})();
