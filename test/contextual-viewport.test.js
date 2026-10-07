const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    ContextualViewport, ViewportMode, FocusSource, shouldEnterWide,
} = require("../src/kwin/presentation/ContextualViewport");

const wide = { id: 1, persistentWide: true };
const normal = { id: 2, persistentWide: false };
const appState = { columns: [wide, normal] };
const viewport = new ContextualViewport(appState);
assert.deepEqual(appState.viewport,
    { mode: ViewportMode.PAIR, wideColumnId: null });
for (const source of [FocusSource.POINTER, FocusSource.DOCK,
    FocusSource.ALT_TAB, FocusSource.PROGRAMMATIC]) {
    assert.equal(shouldEnterWide(wide, { source, changedFocus: true }), false);
    viewport.select(wide, { source, changedFocus: true });
    assert.equal(appState.viewport.mode, ViewportMode.PAIR);
}
assert.equal(shouldEnterWide(wide,
    { source: FocusSource.DIRECTIONAL, changedFocus: false }), false);
assert.equal(shouldEnterWide(normal,
    { source: FocusSource.DIRECTIONAL, changedFocus: true }), false);
viewport.select(wide,
    { source: FocusSource.DIRECTIONAL, changedFocus: true });
assert.deepEqual(appState.viewport,
    { mode: ViewportMode.WIDE_FOCUS, wideColumnId: 1 });
assert.equal(viewport.column(), wide);
viewport.select(normal,
    { source: FocusSource.DIRECTIONAL, changedFocus: true });
assert.deepEqual(appState.viewport,
    { mode: ViewportMode.PAIR, wideColumnId: null });
viewport.wide(wide);
wide.persistentWide = false;
assert.equal(viewport.column(), null);
assert.equal(appState.viewport.mode, ViewportMode.PAIR);
wide.persistentWide = true;
viewport.restore({ mode: ViewportMode.WIDE_FOCUS, wideColumnId: wide.id });
assert.equal(appState.viewport.mode, ViewportMode.WIDE_FOCUS);
viewport.restore({ mode: ViewportMode.PAIR, wideColumnId: wide.id });
assert.equal(appState.viewport.mode, ViewportMode.PAIR);
viewport.restore({ mode: ViewportMode.WIDE_FOCUS, wideColumnId: 999 });
assert.equal(appState.viewport.mode, ViewportMode.PAIR);
const full = { id: 3, widthMode: "full", persistentWide: true };
appState.columns.push(full);
for (const source of Object.values(FocusSource)) {
    assert.equal(shouldEnterWide(full, { source, changedFocus: true }), false);
    viewport.select(full, { source, changedFocus: true, direction: 1, viewportMoved: true });
    assert.equal(viewport.pendingReveal, null);
    assert.equal(viewport.pendingFocusedWide, null);
    assert.equal(viewport.enterFocusedWide(full, 1), false);
    assert.equal(appState.viewport.mode, ViewportMode.PAIR);
}
viewport.wide(wide);
viewport.wide(full);
assert.equal(appState.viewport.mode, ViewportMode.PAIR);
viewport.restore({ mode: ViewportMode.WIDE_FOCUS, wideColumnId: full.id });
assert.equal(appState.viewport.mode, ViewportMode.PAIR);
appState.viewport = { mode: ViewportMode.WIDE_FOCUS, wideColumnId: full.id };
assert.equal(viewport.column(), null, "stale Wide state cannot shrink Full");
assert.equal(appState.viewport.mode, ViewportMode.PAIR);
full.widthMode = "half";
viewport.select(full, { source: FocusSource.DIRECTIONAL, changedFocus: true,
    direction: 1, viewportMoved: true });
full.widthMode = "full";
assert.equal(viewport.confirmReveal(full, 1), false, "pending Wide cannot override a changed width");
full.widthMode = "half";
viewport.wide(full);
assert.equal(appState.viewport.mode, ViewportMode.WIDE_FOCUS, "non-Full can reuse the retained Wide preference");
const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);
const toggleSource = mainSource.slice(
    mainSource.indexOf("function toggleFocusWide("),
    mainSource.indexOf("function moveFocusedColumn(")
);
assert.ok(toggleSource.includes("mainScreenState.viewport.mode === ViewportMode.WIDE_FOCUS"),
    "Meta+Z re-enters Wide for a preferred column currently shown in Pair");
console.log("PASS focus intent and persistent Wide preference remain separate");
