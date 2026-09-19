const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);

const detachSource = mainSource.slice(
    mainSource.indexOf("function detachColumnToFloating"),
    mainSource.indexOf("function attachFloatingToColumns")
);
assert.ok(detachSource.includes("windowState.floating = true"));
assert.ok(detachSource.includes("removeColumn(window, reason, false)"),
    "detaching does not activate a successor over the floating window");
assert.ok(detachSource.includes("workspace.activeWindow = window"),
    "the detached window keeps focus so a second toggle targets the same window");
assert.ok(!detachSource.includes("frameGeometry ="),
    "detaching never rewrites the floating window geometry");

const attachSource = mainSource.slice(
    mainSource.indexOf("function attachFloatingToColumns"),
    mainSource.indexOf("function toggleFloating")
);
assert.ok(attachSource.includes("window.output !== mainScreenState.targetOutput"),
    "secondary-output windows remain native");
assert.ok(attachSource.includes("prepareInitialColumn(window)"),
    "native maximize or Quick Tile is detached before Column adoption");
assert.ok(attachSource.includes("adoptNewWindowAsColumn(window, reason, true)"),
    "a returning floating window uses the normal focused-right insertion path");
assert.ok(attachSource.includes("windowState.floating = true"),
    "failed adoption rolls back to Floating");

const interactiveSource = mainSource.slice(
    mainSource.indexOf("function onInteractiveMoveResizeStarted"),
    mainSource.indexOf("function setupWindow")
);
assert.ok(interactiveSource.includes(
    'detachColumnToFloating(window, "interactive-move-resize")'
), "interactive move/resize detaches a managed Column");

const toggleSource = mainSource.slice(
    mainSource.indexOf("function toggleFloating"),
    mainSource.indexOf("function rectForLayout")
);
assert.ok(toggleSource.includes("lastShortcutFloatingWindow"),
    "a symmetric shortcut toggle remembers the window it detached");
assert.ok(toggleSource.includes("FLOATING_REATTACH_GRACE_MS"),
    "a transient focus steal cannot redirect the second toggle");
const activationSource = mainSource.slice(
    mainSource.indexOf("function onWindowActivatedForScrollLayout"),
    mainSource.indexOf("function focusRelativeColumn")
);
assert.ok(activationSource.includes("floatingFocusGuardUntil"));
assert.ok(activationSource.includes("workspace.activeWindow = lastShortcutFloatingWindow"),
    "KWin focus churn is redirected to the just-detached floating window");

assert.ok(mainSource.includes('"CCScrollToggleFloating"'));
assert.ok(mainSource.includes('"Meta+Shift+Enter"'));

console.log("PASS Phase 10 managed/floating toggle and interactive detach");
