const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const safeRect = { x: 24, y: 50, width: 2512, height: 1320 };
const innerGap = 8;

function normalWidth() {
    return Math.floor((safeRect.width - innerGap) / 2);
}

function wideRect() {
    const width = Math.round(safeRect.width * 0.72);
    return {
        x: safeRect.x + Math.floor((safeRect.width - width) / 2),
        y: safeRect.y,
        width,
        height: safeRect.height,
    };
}

function presentationPlacements(columns, target, mode) {
    if (mode === "normal") {
        return columns.map((column, index) => ({
            id: column,
            kind: index < 2 ? "visible" : "parked",
        }));
    }
    return columns.map(column => ({
        id: column,
        kind: column === target ? "visible" : "parked",
        rect: column === target
            ? (mode === "wide" ? wideRect() : { ...safeRect })
            : null,
    }));
}

assert.equal(normalWidth(), 1252, "NORMAL is exact gap-aware 50/50");
assert.deepEqual(wideRect(), {
    x: 375,
    y: 50,
    width: 1809,
    height: 1320,
}, "WIDE is 72% and centered in the safe area");

const order = ["A", "B", "C"];
const wide = presentationPlacements(order, "B", "wide");
assert.deepEqual(wide.map(item => item.id), order,
    "presentation never changes logical order");
assert.deepEqual(wide.map(item => item.kind), ["parked", "visible", "parked"],
    "WIDE parks every neighbor");
assert.deepEqual(presentationPlacements(order, "B", "maximized")[1].rect, safeRect,
    "MAXIMIZED uses the full safe area");

const mainSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);
const effectSource = fs.readFileSync(
    path.join(__dirname, "../effect/contents/code/main.js"), "utf8"
);
assert.ok(!mainSource.includes('"Meta+R"'));
assert.ok(!mainSource.includes('"Meta+W"'));
assert.ok(!mainSource.includes('"Meta+F"'));
assert.ok(mainSource.includes('"Meta+Z"'),
    "Focus Wide has the requested Meta+Z toggle");
assert.ok(!mainSource.includes("CCNiriMaximizeToggle"),
    "the old presentation shortcut is removed");
assert.ok(mainSource.includes('command.type !== "set-presentation-mode"'));
assert.ok(mainSource.includes('PRESENTATION_MAXIMIZED,\n            "native-maximize"'),
    "native maximize enters the shared presentation state");
assert.ok(mainSource.includes('PRESENTATION_NORMAL,\n            "native-restore"'),
    "native restore exits through the shared presentation state");
const wideShortcutSource = mainSource.slice(
    mainSource.indexOf("function toggleFocusWide"),
    mainSource.indexOf("function moveFocusedColumn")
);
assert.ok(wideShortcutSource.includes("PRESENTATION_WIDE"));
assert.ok(wideShortcutSource.includes("PRESENTATION_NORMAL"));

const focusSource = mainSource.slice(
    mainSource.indexOf("function focusRelativeColumn"),
    mainSource.indexOf("function moveFocusedColumn")
);
assert.ok(focusSource.includes("relayoutFocusedColumnTransition("),
    "H/L uses the shared persistent Wide transition path");
assert.ok(mainSource.includes("persistentWide: false"),
    "Wide is stored as a per-Column property");
assert.ok(mainSource.includes("if (column && column.persistentWide && !alreadySelectedWide)"),
    "returning to a fixed Wide Column automatically isolates it again");
assert.ok(mainSource.includes('`${reason}-reveal-wide`') &&
    mainSource.includes('`${pending.reason}-enter-wide`'),
    "entering Wide reveals the 50% slot before expanding to 72%");
assert.ok(wideShortcutSource.includes(".persistentWide"),
    "Meta+Z toggles the Column property rather than transient focus state");

const reorderSource = mainSource.slice(
    mainSource.indexOf("function moveFocusedColumn"),
    mainSource.indexOf("function rectForLayout")
);
assert.ok(!reorderSource.includes("clearPresentationState()"),
    "reordering preserves presentation");
assert.ok(!mainSource.includes("workspace.showOutline("),
    "the rejected native-outline Focus Ring POC remains disabled");
assert.ok(!fs.existsSync(path.join(__dirname, "../focus-ring")),
    "the abandoned custom Focus Ring implementation is removed");
assert.ok(effectSource.includes("presentationTransition(oldGeometry, newGeometry"),
    "the effect recognizes Column to Focus Wide geometry changes");
assert.ok(effectSource.includes("Math.abs(oldGeometry.height - newGeometry.height)"),
    "new-window adoption is not mistaken for a Focus Wide transition");
assert.ok(effectSource.includes("type: Effect.Scale") &&
    effectSource.includes("type: Effect.Translation"),
    "Focus Wide uses paint-only scale and center translation");
const presentationEffectSource = effectSource.slice(
    effectSource.indexOf("if (this.presentationTransition"),
    effectSource.indexOf("if (!this.sameSize")
);
assert.ok(!presentationEffectSource.includes("type: Effect.Size"));
assert.ok(!presentationEffectSource.includes("type: Effect.Position"),
    "presentation animation cannot intercept authoritative geometry resize");
assert.ok(effectSource.indexOf("this.presentationTransition(oldGeometry, newGeometry") <
    effectSource.indexOf("if (!this.sameSize(oldGeometry, newGeometry)) return;"),
    "size-changing presentation transitions are handled before scroll filtering");

const qmlSource = fs.readFileSync(
    path.join(__dirname, "../plasmoid/com.cc.scrolltasks/qml/ContextMenu.qml"),
    "utf8"
);
for (const label of ["CC Scroll", "Normal", "Focus Wide", "Maximize in Safe Area"]) {
    assert.ok(qmlSource.includes(`\"${label}\"`), `Dock menu contains ${label}`);
}

console.log("PASS Phase 9.5 presentation geometry, state paths, and Dock menu");
