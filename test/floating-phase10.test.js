const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"),
    "utf8"
);
const installSource = fs.readFileSync(
    path.join(__dirname, "../install.sh"),
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
assert.ok(interactiveSource.includes("rememberFloatingWindow(window, false)"),
    "a mouse-drag detach remains available to the reattach shortcut");

const toggleSource = mainSource.slice(
    mainSource.indexOf("function toggleFloating"),
    mainSource.indexOf("function rectForLayout")
);
assert.ok(toggleSource.includes("lastShortcutFloatingWindow"),
    "a symmetric shortcut toggle remembers the window it detached");
assert.ok(toggleSource.includes(
    "if (rememberedFloating && target !== lastShortcutFloatingWindow)"
), "reattachment always wins over an unrelated active window");
assert.equal(toggleSource.includes("FLOATING_REATTACH_GRACE_MS"), false,
    "mouse-detached windows do not expire before the user can return them");
const activationSource = mainSource.slice(
    mainSource.indexOf("function onWindowActivatedForScrollLayout"),
    mainSource.indexOf("function focusRelativeColumn")
);
assert.ok(activationSource.includes("floatingFocusGuardUntil"));
assert.ok(activationSource.includes("workspace.activeWindow = lastShortcutFloatingWindow"),
    "KWin focus churn is redirected to the just-detached floating window");

assert.ok(mainSource.includes('"CCScrollToggleFloating"'));
assert.ok(mainSource.includes('"Meta+Shift+Return"'),
    "the main keyboard Return key is registered");
assert.ok(mainSource.includes('"CCScrollToggleFloatingKeypad"'));
assert.ok(mainSource.includes('"Meta+Shift+Enter"'));
assert.ok(installSource.includes('"[318767108]" 4'),
    "installation repairs the live main Return key code");
assert.ok(installSource.includes('"[318767109]" 4'),
    "installation preserves keypad Enter as a separate action");

console.log("PASS Phase 10 managed/floating toggle and interactive detach");
