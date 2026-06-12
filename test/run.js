/*
 * test/run.js — Node test harness for the platform-agnostic core.
 *
 * Loads the pure modules in dependency order against a shared global namespace
 * (mirroring how the content script loads them) and asserts the PRD's
 * normalization examples, parsing, grouping, sorting and the engine pipeline.
 *
 * Run with:  node test/run.js
 */
const path = require("path");

// Shared namespace, exactly like the browser's `window.UPS`.
globalThis.UPS = {};

const load = (rel) => require(path.join(__dirname, "..", rel));
[
  "src/core/units.js",
  "src/core/parse.js",
  "src/core/normalize.js",
  "src/core/group.js",
  "src/core/sort.js",
  "src/adapters/registry.js",
  "src/adapters/ubereats.js",
  "src/core/engine.js",
].forEach(load);

const UPS = globalThis.UPS;

let passed = 0;
let failed = 0;
function ok(name, cond, extra) {
  if (cond) {
    passed++;
    // console.log("  ✓", name);
  } else {
    failed++;
    console.error("  ✗", name, extra != null ? `→ got ${JSON.stringify(extra)}` : "");
  }
}
function approx(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
}
function section(t) {
  console.log("\n" + t);
}

/* ---------------- units / resolveUnit ---------------- */
section("units");
ok("resolve lb", UPS.resolveUnit("lb") === "lb");
ok("resolve LBS", UPS.resolveUnit("LBS") === "lb");
ok("resolve 'fl oz'", UPS.resolveUnit("fl oz") === "floz");
ok("resolve 'Fluid Ounce'", UPS.resolveUnit("Fluid Ounce") === "floz");
ok("resolve 'fl. oz'", UPS.resolveUnit("fl. oz") === "floz");
ok("resolve ct -> each", UPS.resolveUnit("ct") === "each");
ok("resolve garbage -> null", UPS.resolveUnit("widgets") === null);

/* ---------------- normalization (Appendix A) ---------------- */
section("normalization (Appendix A)");
// Listed: $0.25/oz -> $4.00/lb
{
  const v = UPS.valuate({ listed: { price: 0.25, unitKey: "oz", unitRaw: "oz" } });
  ok("$0.25/oz -> $4.00/lb", approx(v.canonicalPrice, 4.0) && v.source === "listed", v);
  ok("family weight", v.family === "weight");
  ok("canonical lb", v.canonicalUnit === "lb");
}
// Computed: 3 lb @ $6.00 -> $2.00/lb
{
  const v = UPS.valuate({ packagePrice: 6.0, size: { qty: 3, unitKey: "lb", unitRaw: "lb" } });
  ok("$6.00 / 3 lb -> $2.00/lb", approx(v.canonicalPrice, 2.0) && v.source === "computed", v);
}
// Computed: 16 oz @ $4.00 -> $4.00/lb (oz size normalizes to 1 lb)
{
  const v = UPS.valuate({ packagePrice: 4.0, size: { qty: 16, unitKey: "oz", unitRaw: "oz" } });
  ok("$4.00 / 16 oz -> $4.00/lb", approx(v.canonicalPrice, 4.0), v.canonicalPrice);
}
// Volume listed: $0.50/fl oz -> $0.50/fl oz
{
  const v = UPS.valuate({ listed: { price: 0.5, unitKey: "floz", unitRaw: "fl oz" } });
  ok("$0.50/fl oz -> $0.50/fl oz", approx(v.canonicalPrice, 0.5) && v.family === "volume", v);
}
// Volume computed: 500 ml @ $5.00 -> ~$0.2957/fl oz
{
  const v = UPS.valuate({ packagePrice: 5.0, size: { qty: 500, unitKey: "ml", unitRaw: "ml" } });
  ok("$5.00 / 500 ml -> ~$0.2957/fl oz", approx(v.canonicalPrice, 5.0 / (500 / 29.5735), 1e-6), v.canonicalPrice);
}
// Count: $0.99/each
{
  const v = UPS.valuate({ listed: { price: 0.99, unitKey: "each", unitRaw: "each" } });
  ok("$0.99/each -> count family", approx(v.canonicalPrice, 0.99) && v.family === "count", v);
}
// Listed beats computed (FR-4 precedence)
{
  const v = UPS.valuate({
    listed: { price: 1.0, unitKey: "lb", unitRaw: "lb" },
    packagePrice: 99,
    size: { qty: 1, unitKey: "lb", unitRaw: "lb" },
  });
  ok("listed beats computed", v.source === "listed" && approx(v.canonicalPrice, 1.0), v);
}
// Unresolved (FR-9)
{
  const v = UPS.valuate({ packagePrice: 5 });
  ok("no size -> unresolved", v.source === null && v.canonicalPrice === null, v);
}

/* ---------------- parsing ---------------- */
section("parsing");
ok("listed $3.49/lb", (() => {
  const r = UPS.parseListedUnitPrice("Apples $3.49/lb fresh");
  return r && approx(r.price, 3.49) && r.unitKey === "lb";
})());
ok("listed '$0.50 per fl oz'", (() => {
  const r = UPS.parseListedUnitPrice("Olive Oil $0.50 per fl oz");
  return r && approx(r.price, 0.5) && r.unitKey === "floz";
})(), UPS.parseListedUnitPrice("Olive Oil $0.50 per fl oz"));
ok("package price ignores listed", (() => {
  // "$6.00 ... $3.49/lb": package should be 6.00, not 3.49
  const p = UPS.parsePackagePrice("Apples 3 lb bag $6.00 ($3.49/lb)");
  return approx(p, 6.0);
})(), UPS.parsePackagePrice("Apples 3 lb bag $6.00 ($3.49/lb)"));
ok("package price picks lowest (sale)", approx(UPS.parsePackagePrice("$6.00 $8.00"), 6.0));
ok("package price ignores coupon ('Claim $0.25 off')", (() => {
  const p = UPS.parsePackagePrice("Hostess Coffee Cakes (20.3 oz) $6.59 Claim $0.25 off");
  return approx(p, 6.59);
})(), UPS.parsePackagePrice("Hostess Coffee Cakes (20.3 oz) $6.59 Claim $0.25 off"));
ok("package price ignores '$1 off'", approx(UPS.parsePackagePrice("Donuts $3.39 $1 off"), 3.39));
ok("size '3 lb'", (() => {
  const s = UPS.parseSize("Bananas, 3 lb");
  return s && approx(s.qty, 3) && s.unitKey === "lb";
})());
ok("size '500 ml'", (() => {
  const s = UPS.parseSize("Juice 500 ml bottle");
  return s && approx(s.qty, 500) && s.unitKey === "ml";
})());
ok("size '2 x 12 oz' -> 24 oz", (() => {
  const s = UPS.parseSize("Soda 2 x 12 oz cans");
  return s && approx(s.qty, 24) && s.unitKey === "oz";
})(), UPS.parseSize("Soda 2 x 12 oz cans"));
ok("size '12 ct'", (() => {
  const s = UPS.parseSize("Eggs 12 ct");
  return s && approx(s.qty, 12) && s.unitKey === "each";
})());
ok("conflicting sizes: ignores inflated 'lbs' typo, uses real oz", (() => {
  // "(20.5 lbs)" is a name typo; "20.5 oz" is the real size — pick the smaller.
  const s = UPS.parseSize("Bread (20.5 lbs) 20.5 oz");
  return s && approx(s.qty, 20.5) && s.unitKey === "oz";
})(), UPS.parseSize("Bread (20.5 lbs) 20.5 oz"));
ok("conflicting sizes: ignores bogus inflated size field", (() => {
  // Name "25 oz" is real; standalone "750 oz" is bad data — pick the smaller.
  const s = UPS.parseSize("Tortillas (25 oz, 30 ct) 750 oz");
  return s && approx(s.qty, 25) && s.unitKey === "oz";
})(), UPS.parseSize("Tortillas (25 oz, 30 ct) 750 oz"));
ok("count + weight: weight is the TOTAL, count ignored ('10 ct • 1.05 oz')", (() => {
  // A listed weight on a multi-pack is the net total, not per-item — never multiply.
  const s = UPS.parseSize("Roasted Seaweed Snack 10 ct • 1.05 oz");
  return s && s.unitKey === "oz" && approx(s.qty, 1.05);
})(), UPS.parseSize("Roasted Seaweed Snack 10 ct • 1.05 oz"));
ok("count + weight: '6 ct • 2.6 oz' -> 2.6 oz total", (() => {
  const s = UPS.parseSize("Crunchy Rollers 6 ct • 2.6 oz");
  return s && approx(s.qty, 2.6);
})(), UPS.parseSize("Crunchy Rollers 6 ct • 2.6 oz"));
ok("'(25 oz, 30 ct)' is NOT multiplied (total, not per-item)", (() => {
  const s = UPS.parseSize("Tortillas (25 oz, 30 ct) 750 oz");
  return s && approx(s.qty, 25); // not 25*30
})());
ok("'12 ct, 14 oz' is NOT multiplied (14 oz is the package total)", (() => {
  const s = UPS.parseSize("Granola Bars 12 ct, 14 oz");
  return s && s.unitKey === "oz" && approx(s.qty, 14); // not 12*14
})(), UPS.parseSize("Granola Bars 12 ct, 14 oz"));
ok("'10 ct • 8 oz' is NOT multiplied (8 oz is the total)", (() => {
  const s = UPS.parseSize("Snack Cups 10 ct • 8 oz");
  return s && approx(s.qty, 8); // not 10*8
})(), UPS.parseSize("Snack Cups 10 ct • 8 oz"));
ok("liquid: prefers fl oz over a (wrong) weight in the name", (() => {
  // Milk lists a bogus weight "(133.5 oz)" plus the real "133.5 fl oz" volume.
  const s = UPS.parseSize("Whole Milk (133.5 oz) 133.5 fl oz");
  return s && s.unitKey === "floz" && approx(s.qty, 133.5);
})(), UPS.parseSize("Whole Milk (133.5 oz) 133.5 fl oz"));
ok("ignores tiny nutrition value '6g', uses package size '15.5 oz'", (() => {
  const s = UPS.parseSize("Blueberry Wheatfuls Cereal 6g 15.5 oz");
  return s && s.unitKey === "oz" && approx(s.qty, 15.5);
})(), UPS.parseSize("Blueberry Wheatfuls Cereal 6g 15.5 oz"));
ok("ignores tiny per-pack '0.55 oz', uses package size '6.7 oz'", (() => {
  const s = UPS.parseSize("Fruit Snacks 0.55 oz 6.7 oz");
  return s && s.unitKey === "oz" && approx(s.qty, 6.7);
})(), UPS.parseSize("Fruit Snacks 0.55 oz 6.7 oz"));
ok("keeps a genuinely tiny size when it's the ONLY size (0.35 oz)", (() => {
  const s = UPS.parseSize("Roasted Seaweed Snack 0.35 oz");
  return s && s.unitKey === "oz" && approx(s.qty, 0.35);
})(), UPS.parseSize("Roasted Seaweed Snack 0.35 oz"));
ok("keeps tiny-only '0.7 oz' jel dessert", (() => {
  const s = UPS.parseSize("Strawberry Jel Dessert 0.7 oz");
  return s && approx(s.qty, 0.7);
})(), UPS.parseSize("Strawberry Jel Dessert 0.7 oz"));

/* ---------------- adapter extraction ---------------- */
section("adapter (ubereats) extraction");
{
  const adapter = UPS.getAdapter("https://www.ubereats.com/store/foo");
  ok("adapter matches ubereats", !!adapter && adapter.id === "ubereats");
  ok("adapter rejects other host", UPS.getAdapter("https://www.instacart.com/x") === null);
  // Fake "card" — only needs the bits extract() touches.
  const fakeCard = {
    textContent: "Organic Bananas, 3 lb $6.00 ($2.00/lb)",
    getAttribute: () => null,
    querySelector: () => null,
  };
  const raw = adapter.extract(fakeCard);
  ok("extract finds listed", raw.listed && raw.listed.unitKey === "lb", raw.listed);
  ok("extract finds package price", approx(raw.packagePrice, 6.0), raw.packagePrice);
  ok("extract finds size", raw.size && approx(raw.size.qty, 3), raw.size);

  // textContent glues adjacent elements ("Oil23 fl ozSponsored") — extract must
  // de-glue so the size/price still parse.
  const gluedCard = {
    textContent: "Quick viewPlus small$21.19Nutiva Organic Virgin Coconut Oil23 fl ozSponsored",
    getAttribute: () => null,
    querySelector: () => null,
  };
  const g = adapter.extract(gluedCard);
  ok("extract de-glues size '23 fl ozSponsored'", g.size && g.size.unitKey === "floz" && approx(g.size.qty, 23), g.size);
  ok("extract de-glues package price '$21.19Nutiva'", approx(g.packagePrice, 21.19), g.packagePrice);
}

/* ---------------- grouping + sorting + engine ---------------- */
section("engine pipeline (group + sort + stats)");
{
  const items = [
    { id: "a", listed: { price: 4.0, unitKey: "lb", unitRaw: "lb" } }, // $4/lb
    { id: "b", packagePrice: 6.0, size: { qty: 3, unitKey: "lb", unitRaw: "lb" } }, // $2/lb computed
    { id: "c", listed: { price: 0.25, unitKey: "oz", unitRaw: "oz" } }, // $4/lb
    { id: "d", listed: { price: 0.5, unitKey: "floz", unitRaw: "fl oz" } }, // volume
    { id: "e", listed: { price: 1.99, unitKey: "each", unitRaw: "each" } }, // count
    { id: "f", packagePrice: 5.0 }, // unresolved
  ];

  const asc = UPS.process(items, UPS.DIRECTION.ASC);
  ok("3 non-empty+unresolved groups present", asc.groups.length === 4, asc.groups.map((g) => g.key));
  const weight = asc.groups.find((g) => g.key === "weight");
  ok("weight group sorted cheapest-first", weight.items.map((i) => i.id).join(",") === "b,a,c" || weight.items.map((i) => i.id).join(",") === "b,c,a", weight.items.map((i) => i.id));
  ok("cheapest is b ($2/lb)", weight.items[0].id === "b");
  ok("unresolved group last", asc.groups[asc.groups.length - 1].key === "__unresolved__");
  ok("stats total", asc.stats.total === 6, asc.stats);
  ok("stats listed=4", asc.stats.listed === 4, asc.stats);
  ok("stats computed=1", asc.stats.computed === 1, asc.stats);
  ok("stats unresolved=1", asc.stats.unresolved === 1, asc.stats);

  const desc = UPS.process(items, UPS.DIRECTION.DESC);
  const w2 = desc.groups.find((g) => g.key === "weight");
  ok("weight group priciest-first", w2.items[0].id !== "b", w2.items.map((i) => i.id));
  ok("desc: unresolved still last", desc.groups[desc.groups.length - 1].key === "__unresolved__");
  // never cross-family
  ok("volume group isolated", desc.groups.find((g) => g.key === "volume").items.length === 1);
}

/* ---------------- summary ---------------- */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
