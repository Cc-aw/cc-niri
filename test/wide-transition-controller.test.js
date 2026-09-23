const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    ContextualViewport, ViewportMode, FocusSource,
} = require("../src/kwin/presentation/ContextualViewport");

const wide = { id: 1, persistentWide: true };
const normal = { id: 2, persistentWide: false };
const appState = { columns: [wide, normal] };
const viewport = new ContextualViewport(appState);
assert.equal(viewport.select(wide, {
    source: FocusSource.DIRECTIONAL, changedFocus: true,
}), true);
assert.equal(appState.viewport.mode, ViewportMode.WIDE_FOCUS);
assert.equal(viewport.select(normal, {
    source: FocusSource.DIRECTIONAL, changedFocus: true,
}), true);
assert.equal(appState.viewport.mode, ViewportMode.PAIR);
assert.equal(viewport.select(wide, {
    source: FocusSource.POINTER, changedFocus: true,
}), false);
assert.equal(appState.viewport.mode, ViewportMode.PAIR);

const source = fs.readFileSync(path.join(__dirname,
    "../package/contents/code/main.js"), "utf8");
const runtime = source.slice(source.indexOf("/* END GENERATED KWIN MODULES */"));
const navigation = runtime.slice(runtime.indexOf("function focusRelativeColumn"),
    runtime.indexOf("function toggleFocusWide"));
assert.ok(navigation.includes("relayoutFocusedColumnTransition("));
assert.ok(navigation.includes("        delta\n"));
assert.equal(navigation.includes("beginStepIfPending"), false);
assert.equal(runtime.includes("new WideTransition("), false);
assert.equal(runtime.includes("wideTransition.onGeometryChanged"), false);

console.log("PASS directional Wide navigation uses one contextual viewport step");
