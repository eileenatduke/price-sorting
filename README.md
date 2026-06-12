# Unit Price Sorter

A Chrome (Manifest V3) browser extension that re-sorts grocery listings on
**Uber Eats** by their **true unit price** — price per pound, per fluid ounce,
or per each — instead of the sticker price the site sorts by today.

One click loads the entire product list, computes a normalized unit price for
every item, groups items by unit family, and sorts within each group. Uber Eats
is the first supported platform; the architecture is built so other
grocery-delivery apps can be added later by writing a new adapter.

> Status: **Phase 1 MVP** (see [PRD](#) roadmap). Unlisted — shared with friends.

---

## What it does

- **One-click sort.** A floating panel injects on Uber Eats grocery pages. Sorting
  runs only when you click — never automatically.
- **Loads the whole page first.** Auto-scrolls to force every item to render,
  then returns to the top, so you don't scroll manually.
- **Real unit prices.** Uses the unit price Uber Eats already shows when present;
  otherwise computes one from the package price ÷ a size found in the listing text
  (e.g. "Bananas, 3 lb").
- **Never compares apples to gallons.** Items are grouped into weight / volume /
  count families and sorted only *within* a family.
- **Transparent.** Every item gets a badge showing the unit price used, and
  whether it was **listed** by Uber Eats (green) or **computed** by the extension
  (amber, dashed — sanity-check it).
- **Non-destructive.** Only reorders nodes and adds clearly-marked decorations.
  Reload the page to undo everything.

## Install

### Option A — Load unpacked (developer mode)

1. Clone or download this folder.
2. Open `chrome://extensions` in Chrome (or Edge/Brave).
3. Toggle **Developer mode** (top-right).
4. Click **Load unpacked** and select this folder (the one with `manifest.json`).
5. Open an Uber Eats grocery store page — the panel appears bottom-right.

Free and immediate; manual to update.

### Option B — Unlisted Chrome Web Store listing

Recommended for non-technical friends: one-click install + auto-updates. Requires
a one-time developer account, a store review, and a privacy disclosure (the
extension collects nothing). The listing is hidden from search — only people with
the link can find it. *(Distribution choice is an open question in the PRD.)*

## Usage

1. Open a grocery store page on Uber Eats.
2. Click **"Sort by unit price"** in the floating panel.
3. Watch the page auto-scroll, then re-group and rank by unit price.
4. Use **Order** to flip cheapest-first / priciest-first, and click again.

The status line reports counts: total items, sorted, computed, unresolved — plus
a warning if the page appears to recycle cards while scrolling.

## How it works (architecture)

Platform-agnostic **core** + per-platform **adapter** (PRD §8). Adding Instacart
or Amazon Fresh later means writing a new adapter, not touching the core.

```
manifest.json            MV3 manifest (minimal permissions)
src/
  core/
    units.js             Appendix A normalization table + unit resolver
    parse.js             text-pattern parsing (listed price, package price, size)
    normalize.js         raw fields -> canonical unit price (listed | computed)
    group.js             cluster into weight / volume / count families
    sort.js              sort within a group; nulls pinned last
    scroll.js            single-pass full-page auto-load + virtualization probe
    render.js            reorder cards, inject group headers + badges
    panel.js             floating control panel UI
    engine.js            orchestration (pure process() + browser run())
  adapters/
    registry.js          adapter registry / URL matching
    ubereats.js          Uber Eats adapter (heuristic, text-based discovery)
  content/
    main.js              content-script entry + SPA re-injection
styles/panel.css         extension UI + injected headers/badges
popup/                   toolbar popup with usage instructions
tools/discovery.js       console helper to re-derive selectors after a redesign
test/run.js              Node tests for the pure core (no browser needed)
icons/                   action icons
```

The content script loads these files in order into a shared `window.UPS`
namespace (the same modules `require()` cleanly in Node for tests, via a small
UMD wrapper).

## Unit normalization

Canonical units: **weight → lb**, **volume → fl oz**, **count → each**. See
`src/core/units.js` for the full factor table (PRD Appendix A). Examples:

- `$0.25/oz` → `0.25 × 16 = $4.00/lb`
- a 3 lb package at `$6.00` → `6.00 ÷ 3 = $2.00/lb`

Display values round to cents; sorting uses full precision.

## Re-tuning after a site redesign

Uber Eats auto-generates and changes CSS class names often, so card discovery is
**text-pattern based** (it looks for `$…` price text), not class-based. If a
redesign breaks detection:

1. Open an Uber Eats store page, open DevTools → Console.
2. Paste the contents of `tools/discovery.js` and run it.
3. It reports how many priced cards it finds and suggests a `cardSelector`.
4. Pin it for the session with:
   ```js
   window.__UPS_CONFIG__ = { cardSelector: 'li[data-testid="store-item"]' };
   ```
   (You can also tune scroll pacing: `window.__UPS_CONFIG__ = { scroll: { step: 800, delay: 150 } }`.)

## Tests

Pure core logic (units, parsing, normalization, grouping, sorting, the engine
pipeline) is covered by a dependency-free Node harness:

```sh
node test/run.js
```

## Privacy

All processing happens locally in your browser. No page data leaves the device;
no analytics or telemetry. The extension requests **no** broad permissions — only
host access to `ubereats.com`.

## Known limitations (v1)

- **Virtualized grids (R-1).** If Uber Eats destroys off-screen cards while
  scrolling, in-place reordering only covers cards still in the DOM; the panel
  warns you when it detects this. A sorted-overlay fallback is planned for Phase 2.
- **Text-only sizes.** v1 reads sizes from listing text, not product images.
  Image OCR is a committed later phase.
- **React re-renders** can strip injected headers/badges; just click sort again
  (the run is idempotent).
