/*
 * registry.js — Platform adapter registry (PRD §8 adapter architecture).
 *
 * The core engine is platform-agnostic; each adapter supplies card discovery
 * and field extraction. Adding Instacart/Amazon Fresh later = new adapter,
 * no core changes.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  const exported = factory();
  Object.assign(UPS, exported);
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof self !== "undefined" ? self : globalThis, function () {
  const adapters = [];

  function registerAdapter(adapter) {
    adapters.push(adapter);
  }

  /** Pick the first registered adapter whose matches(url) is true. */
  function getAdapter(url) {
    return adapters.find((a) => {
      try {
        return a.matches(url);
      } catch (_) {
        return false;
      }
    }) || null;
  }

  return { registerAdapter, getAdapter, _adapters: adapters };
});
