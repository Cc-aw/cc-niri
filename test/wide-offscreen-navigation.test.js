const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ContextualViewport, FocusSource, ViewportMode } =
    require("../src/kwin/presentation/ContextualViewport");
const { ColumnStore } = require("../src/kwin/model/ColumnStore");
const { deriveColumnLayout, computeStripWidth, scrollOffsetToRevealColumn } =
    require("../src/kwin/layout/ColumnLayout");
const { computeLayoutPlan } = require("../src/kwin/layout/LayoutEngine");

const source = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8");
function runtimeFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf("\nfunction ", start + 1);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

function setup(wideIndex, offset, focusedIndex) {
    const output = { name: "DP-1" };
    const state = {
        enabled: true,
        targetOutput: output,
        safeRect: { x: 24, y: 50, width: 2512, height: 1320 },
        innerGap: 8,
        columns: Array.from({ length: 5 }, (_, index) => ({
            id: index + 1, widthMode: "half", persistentWide: index === wideIndex,
            window: { id: index + 1, output, fullScreen: false },
        })),
        scrollOffsetX: offset,
        focusedColumnIndex: focusedIndex,
        presentation: { mode: "normal", windowUuid: null },
    };
    const viewport = new ContextualViewport(state);
    const store = new ColumnStore(state);
    const frames = [];
    const recompute = () => deriveColumnLayout(state.columns,
        state.safeRect.width, state.innerGap).forEach((item, index) =>
        Object.assign(state.columns[index], item));
    recompute();
    const context = vm.createContext({
        mainScreenState: state, contextualViewport: viewport, columnStore: store,
        contextualWideExit: null,
        PRESENTATION_NORMAL: "normal", FocusSource,
        workspace: { activeWindow: state.columns[focusedIndex].window },
        dockScrollController: { cancel: () => false },
        columnIndexForWindow: window => store.indexOfWindow(window),
        recomputeLogicalLayout: recompute,
        ensureColumnVisible: column => {
            state.scrollOffsetX = scrollOffsetToRevealColumn(state.scrollOffsetX,
                column, computeStripWidth(state.columns), state.safeRect.width);
        },
        relayout: (reason, scrollOffsets) => {
            const presentedColumn = viewport.column();
            const plan = computeLayoutPlan({
                reason, epoch: frames.length + 1, columns: state.columns,
                safeRect: state.safeRect, innerGap: state.innerGap,
                parkingBaseX: -10000, scrollOffsetX: state.scrollOffsetX,
                scrollOffsets, presentedColumn,
                presentedRect: { x: 375, y: 50, width: 1809, height: 1320 },
            });
            frames.push({ mode: state.viewport.mode,
                focused: state.focusedColumnIndex, plan });
        },
        activateColumnWhenReady: window => { context.workspace.activeWindow = window; },
        publishDockState: () => {}, commitDockState: () => {}, debug: () => {},
    });
    vm.runInContext([
        runtimeFunction("cancelPendingDockScroll"),
        runtimeFunction("relayoutFocusedColumnTransition"),
        runtimeFunction("focusRelativeColumn"),
    ].join("\n"), context);
    return { state, viewport, frames,
        press: delta => context.focusRelativeColumn(delta), context };
}

// Both edges and a middle column: revealing a preferred Wide column must
// commit an ordinary two-column scroll before any Wide geometry is requested.
for (const [wideIndex, offset, focusedIndex, direction, visibleIds] of [
    [0, 1260, 1, -1, [1, 2]],
    [3, 1260, 2, 1, [3, 4]],
    [1, 2520, 2, -1, [2, 3]],
]) {
    const h = setup(wideIndex, offset, focusedIndex);
    h.press(direction);
    assert.equal(h.frames.length, 1, "the first key only commits the Pair stage");
    assert.equal(h.state.viewport.mode, ViewportMode.PAIR);
    assert.equal(h.state.focusedColumnIndex, wideIndex);
    const visible = h.frames[0].plan.windows.filter(item => item.placement === "visible");
    assert.deepEqual(visible.map(item => item.column.id), visibleIds);
    assert.ok(visible.every(item => item.rect.width === 1252));
    assert.equal(h.frames[0].plan.scrollTransaction.type, "SCROLL");
    assert.equal(h.frames[0].plan.viewportMotion, null);
    const pairOffset = h.state.scrollOffsetX;

    h.press(direction);
    assert.equal(h.frames.length, 2);
    assert.equal(h.state.viewport.mode, ViewportMode.WIDE_FOCUS);
    assert.equal(h.state.viewport.wideColumnId, wideIndex + 1);
    assert.equal(h.state.focusedColumnIndex, wideIndex,
        "the second key expands the revealed column rather than skipping past it");
    assert.equal(h.state.scrollOffsetX, pairOffset);
    assert.equal(h.frames[1].plan.windows[wideIndex].rect.width, 1809);
}

const alreadyVisible = setup(0, 0, 1);
alreadyVisible.press(-1);
assert.equal(alreadyVisible.state.viewport.mode, ViewportMode.WIDE_FOCUS,
    "entering a preferred column already in the pair still expands immediately");

// A neighbor of an exclusive Wide view is not currently visible, even when
// both columns project into the same underlying pair and the offset is fixed.
for (const [fromIndex, targetIndex, offset, direction] of [
    [2, 3, 2520, 1],
    [2, 3, 1260, 1],
    [3, 2, 2520, -1],
    [3, 2, 3780, -1],
]) {
    const h = setup(targetIndex, offset, fromIndex);
    const from = h.state.columns[fromIndex];
    from.persistentWide = true;
    h.viewport.wide(from);
    h.press(direction);
    assert.equal(h.state.viewport.mode, ViewportMode.PAIR,
        "Wide-to-Wide navigation first exits the exclusive viewport");
    assert.equal(h.state.focusedColumnIndex, targetIndex);
    const visible = h.frames[0].plan.windows.filter(item => item.placement === "visible");
    assert.deepEqual(visible.map(item => item.column.id), [3, 4]);
    assert.ok(visible.every(item => item.rect.width === 1252));
    assert.equal(from.persistentWide, true);
    assert.equal(h.state.columns[targetIndex].persistentWide, true);
    h.press(direction);
    assert.equal(h.state.viewport.mode, ViewportMode.WIDE_FOCUS);
    assert.equal(h.state.viewport.wideColumnId, targetIndex + 1);
    assert.equal(h.state.focusedColumnIndex, targetIndex,
        "confirmation expands the neighbor instead of navigating beyond it");
}

const reverse = setup(0, 1260, 1);
reverse.press(-1);
reverse.press(1);
assert.equal(reverse.state.viewport.mode, ViewportMode.PAIR);
assert.equal(reverse.state.focusedColumnIndex, 1);
assert.equal(reverse.viewport.pendingReveal, null,
    "opposite navigation cancels confirmation and follows normal focus order");

const cancelled = setup(1, 2520, 2);
cancelled.press(-1);
cancelled.context.cancelPendingDockScroll("dock-reorder");
cancelled.press(-1);
assert.equal(cancelled.state.focusedColumnIndex, 0);
assert.equal(cancelled.state.viewport.mode, ViewportMode.PAIR,
    "unrelated commands invalidate the revealed column confirmation");

const pointer = setup(1, 2520, 2);
pointer.press(-1);
pointer.viewport.select(pointer.state.columns[1],
    { source: FocusSource.POINTER, changedFocus: false });
pointer.press(-1);
assert.equal(pointer.state.focusedColumnIndex, 0);
assert.equal(pointer.state.viewport.mode, ViewportMode.PAIR);

const stale = setup(1, 2520, 2);
stale.press(-1);
stale.state.scrollOffsetX = 0;
assert.equal(stale.viewport.confirmReveal(stale.state.columns[1], -1), false,
    "a changed viewport cannot consume a stale confirmation");

console.log("PASS off-screen Wide navigation reveals Pair before a second directional press");
