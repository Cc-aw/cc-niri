"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");

function fixture() {
    const columns = Array.from({ length: 5 }, (_, index) => ({ uuid: `a${index}`,
        widthMode: index === 1 ? "full" : "half", persistentWide: index === 1 }));
    return { protocol: 2, sessionId: "saved", generation: 9, targetOutput: "eDP-1", workspaceId: "A",
        columns: columns.map(c => ({ uuid: c.uuid, widthMode: c.widthMode })),
        workspaces: [{ id: "A", columns, focusedUuid: "a0" },
            { id: "B", columns: [{ uuid: "b0", widthMode: "half" }, { uuid: "b1", widthMode: "half" }] }] };
}
function checkFull(r) {
    const full = r.state.columns.find(c => c.window === r.a[1]);
    assert.equal(full.widthMode, "full");
    assert.equal(full.pixelWidth, r.state.safeRect.width);
    assert.equal(full.persistentWide, true, "Wide preference is retained while Full takes precedence");
    assert.equal(r.state.viewport.mode, "pair");
    assert.equal(r.state.presentation.mode, "normal");
    assert.equal(r.a[1].fullScreen, false);
    assert.equal(r.evaluate("invariantChecker.errors().length"), 0, r.logs.join("\n"));
}
{
    const r = createRuntime({ PreviousState: fixture() });
    checkFull(r);
    for (const direction of [1, 1, -1, -1, 1, 1, -1]) {
        r.evaluate(`focusRelativeColumn(${direction})`);
        checkFull(r);
        if (r.workspace.activeWindow === r.a[1]) {
            assert.deepEqual({ ...r.a[1].frameGeometry }, { ...r.state.safeRect });
            assert.equal(r.a[1].minimized, false);
        }
    }
    r.evaluate("toggleFocusWide(workspace.activeWindow)");
    checkFull(r);
    assert.deepEqual({ ...r.a[1].frameGeometry }, { ...r.state.safeRect });
    r.nativeSwitch(1, r.b[0]);
    r.nativeSwitch(0, r.a[1]);
    checkFull(r);
    assert.deepEqual({ ...r.a[1].frameGeometry }, { ...r.state.safeRect });
    const saved = r.published.at(-1);
    assert.equal(saved.columns.find(c => c.uuid === "a1").widthMode, "full");
    const reloaded = createRuntime({ PreviousState: saved });
    checkFull(reloaded);
    reloaded.evaluate("focusRelativeColumn(1)");
    assert.deepEqual({ ...reloaded.a[1].frameGeometry }, { ...reloaded.state.safeRect });
    const added = reloaded.add("new", 0);
    reloaded.workspace.activeWindow = added;
    assert.equal(reloaded.state.columns.find(c => c.window === added).widthMode, "half");
}
{
    const r = createRuntime({ PreviousState: fixture() });
    r.move(r.a[1], ["B"]);
    const moved = r.published.at(-1).workspaces.find(w => w.id === "B").columns.at(-1);
    assert.deepEqual(moved, { uuid: "a1", widthMode: "full", previousNonFullWidthMode: "half", persistentWide: true });
    r.nativeSwitch(1, r.a[1]);
    checkFull(r);
    assert.deepEqual({ ...r.a[1].frameGeometry }, { ...r.state.safeRect });
    r.move(r.a[1], ["A"]);
    r.nativeSwitch(0, r.a[1]);
    checkFull(r);
    assert.deepEqual({ ...r.a[1].frameGeometry }, { ...r.state.safeRect });
}
console.log("PASS Full survives generated-runtime H/L, J/K, reload, native transfer and Wide commands");
