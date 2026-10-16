"use strict";

const { ColumnStore } = require("../../src/kwin/model/ColumnStore");
const { ColumnWidthController } = require("../../src/kwin/layout/ColumnWidthController");
const { ContinuousViewportController } = require("../../src/kwin/layout/ContinuousViewportController");
const { createScrollLayoutGeometry } = require("../../src/kwin/layout/ContinuousColumnLayout");
const { LayoutTransaction } = require("../../src/kwin/stability/LayoutTransaction");
const { WindowPolicy } = require("../../src/kwin/policy/WindowPolicy");
const { WorkspaceMembership } = require("../../src/kwin/workspace/WorkspaceMembership");
let fixtureId = 0;

function createV2Runtime(options = {}) {
    let primary = { name: "Virtual-primary" };
    let current = "A";
    let observed = null;
    let serial = 0;
    const plans = [];
    const state = { enabled: true, workspaceSwitching: false, columns: [], focusedColumnIndex: -1,
        nextColumnId: 1, scrollOffsetX: 0, activeWorkspaceId: null, targetOutput: null, geometryGeneration: 0 };
    let membershipChanged = () => {};
    let emitted = () => {};
    const store = new ColumnStore(state, () => membershipChanged(), { scrollLayoutV2Enabled: true });
    const transaction = new LayoutTransaction({ audit: () => {}, debug: () => {} });
    const policy = new WindowPolicy();
    const membership = new WorkspaceMembership();
    const controller = new ContinuousViewportController({ state, columnStore: store, transaction,
        enabled: options.enabled !== false, dockEnabled: options.dockEnabled === true, sessionId: `p2-fixture-${++fixtureId}`,
        getPrimaryOutput: () => primary, getCurrentWorkspaceId: () => current,
        getUuid: w => w && String(w.internalId || "").trim().toLowerCase(),
        canJoin: (w, scope) => Boolean(policy.canJoinColumn(w) && !w.fullScreen && !w.floating &&
            w.output === scope.output && membership.belongsTo(w, scope.workspaceId)),
        getPainted: () => observed,
        onTarget: plan => { plans.push(plan); emitted(plan); } });
    const width = new ColumnWidthController({ scrollLayoutV2Enabled: true, getAppState: () => state,
        getActiveWindow: () => (store.focusedColumn() || {}).window,
        applyV2Width: (column, mode, reason) => controller.setWidth(column, mode, reason) });
    const geometry = (width = 2560, gap = 16, top = 0, scale = 1) => createScrollLayoutGeometry({
        outputRect: { x: 0, y: 0, width, height: 1440 },
        workingArea: { x: 0, y: top, width, height: 1440 - top }, gap, physicalScale: scale });
    const window = (id, workspaceId = current, extra = {}) => Object.assign({ internalId: id, output: primary,
        desktops: [{ id: workspaceId }], onAllDesktops: false, managed: true, normalWindow: true,
        moveable: true, resizeable: true, maximizable: true, fullScreen: false }, extra);
    function mount(entries, view = {}, g = geometry()) {
        return controller.mount({ workspaceId: current, output: primary, geometry: g }, entries, view);
    }
    function paint(camera = state.scrollOffsetX) {
        const plan = controller.lastTarget;
        observed = { sessionId: controller.sessionId, workspaceId: state.activeWorkspaceId, targetOutput: primary.name,
            scopeRevision: controller.scopeRevision, epoch: state.geometryGeneration, sampleSerial: ++serial,
            cameraX: camera, entries: plan.entries.map(e => ({ uuid: e.uuid,
                visualRect: Object.assign({}, e.visualRect, { x: e.visualRect.x + state.scrollOffsetX - camera }) })) };
        return observed;
    }
    return { state, store, transaction, controller, width, plans, geometry, window, mount, paint,
        setCurrent: id => { current = id; }, getPrimary: () => primary,
        replacePrimary: () => { primary = { name: primary.name }; },
        setObserved: sample => { observed = sample; },
        onMembership: handler => { membershipChanged = handler; },
        onTarget: handler => { emitted = handler; } };
}

module.exports = { createV2Runtime };
