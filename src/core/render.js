/*
 * render.js — Reorder the page's product grid by unit price (PRD FR-7/8/13).
 * Browser-only.
 *
 * Deliberately invisible: we ONLY move existing grid cells into sorted order —
 * no badges, headers, or injected chrome — so the page looks exactly as it
 * normally does, just reordered. A page reload restores the original order
 * (NFR-4, non-destructive).
 *
 * One `display:none` marker is dropped into the grid so the content script can
 * tell whether our ordering is still applied; a React re-render or resize strips
 * it, which is the signal to re-apply.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  Object.assign(UPS, factory(global, UPS));
  if (typeof module !== "undefined" && module.exports) module.exports = factory(global, UPS);
})(typeof self !== "undefined" ? self : globalThis, function (global, UPS) {
  const MARKER_CLASS = "ups-sorted-marker"; // invisible "we sorted this grid" flag
  const UNIT_CLASS = "ups-unit"; // the small "$X/lb" line shown under each item
  const GRID_CLASS = "ups-grid"; // makes the reordered grid's columns responsive
  // Our marker + unit lines + any visible decorations from older builds; cleared
  // every run so nothing can linger or duplicate after a re-sort/upgrade.
  const STALE_SELECTOR = ".ups-sorted-marker, .ups-unit, .ups-cat-header, .ups-decoration, .ups-badge";

  /** Remove our marker + unit lines (and any legacy decorations) for a clean re-run. */
  function clearDecorations(doc = global.document) {
    doc.querySelectorAll(STALE_SELECTOR).forEach((n) => n.remove());
    // Drop the responsive-grid tag too; apply() re-adds it to the current grid.
    doc.querySelectorAll("." + GRID_CLASS).forEach((n) => n.classList.remove(GRID_CLASS));
  }

  /**
   * Show the normalized unit price as a small, plain text line under the item.
   * Styled (panel.css) to look like the site's own secondary text — no box,
   * no background, and taken out of any flex stretch so it can't become a pill.
   * Placed at the bottom of the card's text column (the tightest non-image
   * element holding the visible price), so it reads as a natural extra line.
   */
  function placeUnitLine(card, valuation) {
    if (!valuation || valuation.canonicalPrice == null) return;
    const line = global.document.createElement("div");
    line.className = UNIT_CLASS;
    line.textContent = `$${valuation.displayPrice.toFixed(2)}/${valuation.canonicalUnit}`;

    let anchor = null;
    let anchorLen = Infinity;
    const img = card.querySelector && card.querySelector("img");
    if (card.querySelectorAll) {
      card.querySelectorAll("*").forEach((el) => {
        if (img && el.contains(img)) return; // skip the image side of the card
        const t = el.textContent || "";
        if (!/\$\s*\d/.test(t)) return; // must hold the visible price
        if (t.length < anchorLen) {
          anchor = el;
          anchorLen = t.length;
        }
      });
    }
    const column = (anchor && anchor.parentElement) || card;
    column.appendChild(line);
  }

  /**
   * Find the real grid container and each card's grid "cell".
   *
   * Uber Eats lays cards out in a CSS grid where every product sits in its own
   * cell element. To keep that row/column layout we reorder the *cells* within
   * the grid — not yank the cards into one parent (which collapses them into a
   * single column). The grid is the ancestor that splits the cards into the most
   * distinct cells; a card's cell is the grid's direct child that contains it.
   */
  function findGrid(nodes) {
    const cellsByAncestor = new Map(); // ancestor -> Set(cell)
    const cellOfByAncestor = new Map(); // ancestor -> Map(cardNode -> cell)
    for (const node of nodes) {
      let cell = node;
      let parent = node.parentElement;
      while (parent) {
        if (!cellsByAncestor.has(parent)) {
          cellsByAncestor.set(parent, new Set());
          cellOfByAncestor.set(parent, new Map());
        }
        cellsByAncestor.get(parent).add(cell);
        cellOfByAncestor.get(parent).set(node, cell);
        cell = parent;
        parent = parent.parentElement;
      }
    }
    let container = null;
    let best = 0;
    for (const [anc, cells] of cellsByAncestor) {
      if (cells.size > best) {
        best = cells.size;
        container = anc;
      }
    }
    return { container, cellOf: container ? cellOfByAncestor.get(container) : new Map() };
  }

  /**
   * Reorder the grid in-place. `groups` = [{ key, label, items: [{ node, valuation }] }]
   * already in family order (weight → volume → count → unresolved), each group
   * internally sorted. We append each card's grid *cell* in that order; because
   * appendChild moves existing nodes, this reorders the grid in one stable pass,
   * keeping same-unit items together. Returns count of cells moved.
   */
  function apply(groups, doc = global.document) {
    clearDecorations(doc);

    const nodes = [];
    for (const group of groups) {
      for (const it of group.items) {
        if (it.node && it.node.isConnected) nodes.push(it.node);
      }
    }
    if (!nodes.length) return 0;

    const { container, cellOf } = findGrid(nodes);
    if (!container) return 0;

    let moved = 0;
    const placed = new Set();
    const frag = doc.createDocumentFragment();
    for (const group of groups) {
      const items = group.items.filter(
        (it) => it.node && it.node.isConnected && cellOf.get(it.node)
      );
      if (!items.length) continue;

      // Full-width category header (e.g. "Price per pound ($/lb)").
      const header = doc.createElement("div");
      header.className = "ups-cat-header";
      header.textContent = group.label + "  (" + items.length + ")";
      frag.appendChild(header);

      for (const item of items) {
        const cell = cellOf.get(item.node);
        if (cell && !placed.has(cell)) {
          frag.appendChild(cell); // moves the whole grid cell into final order
          placed.add(cell);
          moved++;
        }
        placeUnitLine(item.node, item.valuation); // show "$X/lb" under the item
      }
    }
    container.appendChild(frag);

    // Make the grid's column count responsive to width (panel.css), so narrowing
    // the window reflows items instead of forcing a horizontal scroll. Uber ships
    // a fixed pixel-track list here; our !important rule overrides it.
    container.classList.add(GRID_CLASS);

    // Invisible flag so the content script can detect when a re-render reverts us.
    const marker = doc.createElement("div");
    marker.className = MARKER_CLASS;
    marker.style.display = "none";
    container.appendChild(marker);

    return moved;
  }

  return { apply, clearDecorations, findGrid, MARKER_CLASS };
});
