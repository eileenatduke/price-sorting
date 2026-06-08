/*
 * render.js — Apply the sort to the page: reorder cards, add group headers and
 * per-item verification badges (PRD FR-7/8/10/13). Browser-only.
 *
 * Non-destructive (NFR-4): we only move existing nodes and append clearly-marked
 * decorations (class-prefixed `ups-`). A page reload restores everything.
 */
(function (global, factory) {
  const UPS = (global.UPS = global.UPS || {});
  Object.assign(UPS, factory(UPS));
  if (typeof module !== "undefined" && module.exports) module.exports = factory(UPS);
})(typeof self !== "undefined" ? self : globalThis, function (UPS) {
  const DECORATION_CLASS = "ups-decoration"; // headers we inject
  const BADGE_CLASS = "ups-badge"; // per-item badges we inject

  /** Remove all extension-injected decorations so a re-run starts clean (FR-13). */
  function clearDecorations(doc = global.document) {
    doc.querySelectorAll(`.${DECORATION_CLASS}, .${BADGE_CLASS}`).forEach((n) => n.remove());
  }

  function makeBadge(valuation) {
    const badge = global.document.createElement("div");
    badge.className = BADGE_CLASS;
    if (!valuation || valuation.canonicalPrice == null) {
      badge.classList.add("ups-badge--none");
      badge.textContent = "no unit price";
      return badge;
    }
    // Visually distinguish listed vs computed values (FR-10).
    badge.classList.add(valuation.source === "listed" ? "ups-badge--listed" : "ups-badge--computed");
    const price = valuation.displayPrice.toFixed(2);
    const tag = valuation.source === "listed" ? "listed" : "computed";
    badge.textContent = `$${price}/${valuation.canonicalUnit} · ${tag}`;
    badge.title = `${tag} from ${valuation.detail}`;
    return badge;
  }

  function makeHeader(label, count) {
    const h = global.document.createElement("div");
    h.className = DECORATION_CLASS;
    h.setAttribute("data-ups-header", "1");
    h.textContent = `${label}  (${count})`;
    return h;
  }

  /** Pick the container holding the most cards — the grid we reorder within. */
  function dominantParent(groups) {
    const counts = new Map();
    for (const g of groups) {
      for (const item of g.items) {
        const p = item.node && item.node.isConnected ? item.node.parentElement : null;
        if (p) counts.set(p, (counts.get(p) || 0) + 1);
      }
    }
    let best = null;
    let bestN = 0;
    for (const [p, n] of counts) {
      if (n > bestN) {
        best = p;
        bestN = n;
      }
    }
    return best;
  }

  /**
   * Render grouped+sorted items in-place.
   * `groups` = [{ key, label, items: [{ node, valuation }] }] already sorted.
   *
   * We build the final ordered sequence (group header, then its cards, repeat)
   * and append each node to the grid container in that order. Because
   * appendChild *moves* existing nodes, this reorders the grid in one stable
   * pass without an intermediate half-sorted state. Returns count of cards moved.
   */
  function apply(groups, doc = global.document) {
    clearDecorations(doc);
    const container = dominantParent(groups);
    if (!container) return 0;

    let moved = 0;
    const frag = doc.createDocumentFragment();
    for (const group of groups) {
      const connected = group.items.filter((it) => it.node && it.node.isConnected);
      if (!connected.length) continue;
      frag.appendChild(makeHeader(group.label, connected.length));
      for (const item of connected) {
        // Badge the card (decorations already cleared above, so no dup check needed).
        item.node.appendChild(makeBadge(item.valuation));
        frag.appendChild(item.node); // moves the card into final position
        moved++;
      }
    }
    container.appendChild(frag);
    return moved;
  }

  return { apply, clearDecorations, DECORATION_CLASS, BADGE_CLASS };
});
