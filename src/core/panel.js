/*
 * panel.js — The floating control panel (PRD FR-1/11/12, §6). Browser-only.
 *
 * Compact, collapsible, one primary action + a direction toggle + a status line.
 * Clearly the extension's own UI (prefixed `ups-`), not Uber Eats'.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  Object.assign(UPS, factory(global, UPS));
  if (typeof module !== "undefined" && module.exports) module.exports = factory(global, UPS);
})(typeof self !== "undefined" ? self : globalThis, function (global, UPS) {
  const PANEL_ID = "ups-panel";

  function el(tag, cls, text) {
    const node = global.document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * Create (or return existing) panel. `onSort(direction)` runs on click.
   * Returns an API: { root, setStatus, setBusy, getDirection, isPresent }.
   */
  function createPanel(onSort, opts = {}) {
    let root = global.document.getElementById(PANEL_ID);
    if (root) return root.__upsApi;

    const ASC0 = UPS.DIRECTION ? UPS.DIRECTION.ASC : "asc";
    let direction = opts.direction || ASC0;
    let collapsed = false;

    root = el("div", "ups-panel");
    root.id = PANEL_ID;

    const header = el("div", "ups-panel__header");
    const title = el("span", "ups-panel__title", "Unit Price Sorter");
    const collapseBtn = el("button", "ups-panel__collapse", "–");
    collapseBtn.title = "Collapse";
    header.appendChild(title);
    header.appendChild(collapseBtn);

    const body = el("div", "ups-panel__body");

    const sortBtn = el("button", "ups-btn ups-btn--primary", "Sort by unit price");

    const dirRow = el("div", "ups-row");
    const dirLabel = el("span", "ups-row__label", "Order:");
    const dirBtn = el("button", "ups-btn ups-btn--toggle", "Cheapest first");
    dirRow.appendChild(dirLabel);
    dirRow.appendChild(dirBtn);

    const status = el("div", "ups-status", "Ready.");

    body.appendChild(sortBtn);
    body.appendChild(dirRow);
    body.appendChild(status);

    root.appendChild(header);
    root.appendChild(body);

    // Collapse toggles the body; the header becomes a small launcher button.
    function setCollapsed(v) {
      collapsed = v;
      root.classList.toggle("ups-panel--collapsed", collapsed);
      collapseBtn.textContent = collapsed ? "+" : "–";
      collapseBtn.title = collapsed ? "Expand" : "Collapse";
    }
    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setCollapsed(!collapsed);
    });
    header.addEventListener("click", () => {
      if (collapsed) setCollapsed(false);
    });

    function setDirection(d) {
      direction = d;
      const asc = direction === (UPS.DIRECTION ? UPS.DIRECTION.ASC : "asc");
      dirBtn.textContent = asc ? "Cheapest first" : "Priciest first";
    }
    dirBtn.addEventListener("click", () => {
      const ASC = UPS.DIRECTION ? UPS.DIRECTION.ASC : "asc";
      const DESC = UPS.DIRECTION ? UPS.DIRECTION.DESC : "desc";
      setDirection(direction === ASC ? DESC : ASC);
    });
    // Reflect any restored direction on the toggle label.
    setDirection(direction);

    sortBtn.addEventListener("click", () => onSort(direction));

    const api = {
      root,
      setStatus(msg, kind) {
        status.textContent = msg;
        status.className = "ups-status" + (kind ? ` ups-status--${kind}` : "");
      },
      setBusy(busy) {
        sortBtn.disabled = busy;
        sortBtn.textContent = busy ? "Working…" : "Sort by unit price";
      },
      getDirection: () => direction,
      setDirection,
      isPresent: () => global.document.getElementById(PANEL_ID) === root,
    };
    root.__upsApi = api;
    global.document.body.appendChild(root);
    return api;
  }

  function panelPresent() {
    return !!global.document.getElementById(PANEL_ID);
  }

  return { createPanel, panelPresent, PANEL_ID };
});
