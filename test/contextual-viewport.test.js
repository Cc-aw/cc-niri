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
