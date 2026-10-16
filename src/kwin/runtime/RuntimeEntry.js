"use strict";

// Runtime composition. Generated into package/contents/code/main.js by tools/build.js.
const TAG = "[cc-niri-maximize]";
const FULL_MAXIMIZE_MODE = 3;
const NORMAL_MODE = "normal";
const MAXIMIZE_MODE = "maximize";
const PRESENTATION_NORMAL = "normal";
const PRESENTATION_WIDE = "wide";
const PRESENTATION_MAXIMIZED = "maximized";
const WIDE_RATIO = 0.72;
const COLUMN_WIDTH_HALF = "half";
const PARKING_MARGIN = 4096;
const FLOATING_FOCUS_GUARD_MS = 1200;
/* Park only after target geometry ACK and a conservative paint-motion grace.
 * The Effect owns the visual fade; this timer only releases real geometry. */
const CONTEXTUAL_WIDE_PARK_GRACE_MS = 500;
const WIDE_GEOMETRY_RETRY_MS = 50;
const WIDE_GEOMETRY_MAX_ATTEMPTS = 20;
const DOCK_SCROLL_STEP_MS = 140;
const ADOPTION_UNTRACKED = "untracked";
const ADOPTION_WAITING_ACTIVATION = "waiting-activation";
const ADOPTION_WAITING_PRIMARY = "waiting-primary";
const ADOPTION_WAITING_WORKSPACE = "waiting-workspace";
const ADOPTION_WAITING_ELIGIBLE = "waiting-eligible";
const ADOPTION_WAITING_NORMAL = "waiting-normal";
const ADOPTION_ADOPTING = "adopting";
const ADOPTION_SETTLING = "settling";
const ADOPTION_MANAGED = "managed";
const ADOPTION_FLOATING = "floating";
const ADOPTION_POLICY_FLOATING = "policy-floating";
const ADOPTION_IGNORED = "ignored";
const RUNTIME_BRIDGE_SERVICE = "org.cc.CCNiriBridge";
const RUNTIME_BRIDGE_PATH = "/CCNiriBridge";
const RUNTIME_BRIDGE_INTERFACE = "org.cc.CCNiriBridge1";

const mainScreenState = {
    activeWorkspaceId: null,
    workspaceSwitching: false,
    targetOutput: null,
    safeRect: null,
    columns: [],
    focusedColumnIndex: -1,
    scrollOffsetX: 0,
    innerGap: 8,
    enabled: true,
    nextColumnId: 1,
    presentation: {
        windowUuid: null,
        mode: PRESENTATION_NORMAL,
    },
};
const contextualViewport = new ContextualViewport(mainScreenState);
let focusRingController;
let continuousLayout;
const runtimeConfig = loadRuntimeConfig(readConfig);
const columnStore = new ColumnStore(mainScreenState, () => {
    if (focusRingController) focusRingController.membershipChanged();
}, { scrollLayoutV2Enabled: runtimeConfig.scrollLayoutV2Enabled });
const states = new WindowStateStore(createWindowState);
const windowPolicy = new WindowPolicy();
const virtualDesktopTopology = new VirtualDesktopTopology({
    getDesktops: () => workspace.desktops,
    getCurrentDesktop: output => output &&
        typeof workspace.currentDesktopForScreen === "function"
        ? workspace.currentDesktopForScreen(output) : workspace.currentDesktop,
});
const workspaceMembership = new WorkspaceMembership({
    getCurrentDesktop: output => virtualDesktopTopology.current(output),
});
const workspaceOccupancy = new WorkspaceOccupancy({ membership: workspaceMembership });
const workspaceSnapshots = new WorkspaceSnapshotStore();
const workspacePersistence = new WorkspacePersistence({
    snapshots: workspaceSnapshots,
    hasDesktop: id => Boolean(virtualDesktopTopology.byId(id)),
});
let workspaceMountController;
const layoutEligibility = new LayoutEligibility({
    windowPolicy,
    membership: workspaceMembership,
    isEnabled: () => mainScreenState.enabled &&
        (!workspaceMountController || !workspaceMountController.stopped),
    getPrimaryOutput: resolveTargetOutput,
    isPrimaryReady: () => Boolean(workspaceMountController &&
        workspaceMountController.canUseActiveWorkspace()),
});
let workspaceSwitchController;
let workspaceTransferController;
let workspaceMoveController;
let dynamicWorkspaceController;
let workspaceRecycleController;
const runtimeLogger = new RuntimeLogger({
    tag: TAG,
    enabled: runtimeConfig.debugLogging,
    infoSink: message => console.info(message),
    warnSink: message => console.warn(message),
});
const outputTopology = new OutputTopology({
    getScreens: () => workspace.screens,
    getWindows: () => workspace.windowList(),
    config: runtimeConfig,
    computeSafeRect,
    getWorkingArea: (output, desktop) => workspace.clientArea(KWin.MaximizeArea,
        output, desktop || virtualDesktopTopology.current(output)),
    warn,
});
const innerGap = runtimeConfig.primary.inner;
let contextualWideCoordinator;
const runtimeBridge = new RuntimeBridge({
    snapshotProtocol: 2,
    invoke: callDBus,
    service: RUNTIME_BRIDGE_SERVICE,
    path: RUNTIME_BRIDGE_PATH,
    interfaceName: RUNTIME_BRIDGE_INTERFACE,
    snapshotProvider: createRuntimeSnapshot,
    handlers: Object.assign({
        "emergency-restore": command => emergencyRestoreAllWindows("bridge-unload", command.commandId),
        "finalize-contextual-wide": command =>
            runWorkspaceAction(() => contextualWideCoordinator.finalizePark(command)),
        "finalize-contextual-wide-exit": command =>
            runWorkspaceAction(() => contextualWideCoordinator.finalizeExit(command)),
    }, runtimeConfig.dockIntegration ? {
        // Persistence, animation completion and recovery stay available without
        // a Dock. Only UI-originated commands are part of the optional integration.
        "advance-dock-scroll": command => runWorkspaceAction(() => advancePendingDockScroll(command)),
        "set-presentation-mode": command => runWorkspaceAction(() => handleDockPresentationCommand(command)),
        "focus-column-right": command => runWorkspaceAction(() => handleDockFocusCommand(command)),
        "set-column-order": command => runWorkspaceAction(() => handleDockReorderCommand(command)),
    } : {}),
    generationAgnosticTypes: [
        "finalize-contextual-wide",
        "finalize-contextual-wide-exit",
    ],
    debug,
    warn,
    now: () => Date.now(),
    random: () => Math.random(),
});
const startupLayout = new StartupLayout({
    normalizeUuid: normalizeWindowUuid,
    targetOutput: () => mainScreenState.targetOutput
        ? mainScreenState.targetOutput.name : "",
});
contextualWideCoordinator = new ContextualWideCoordinator({
    appState: mainScreenState,
    gateway: runtimeBridge,
    projectedRectForColumn,
    isFullyVisible: isFullyVisibleInSafeRect,
    sameRectNear,
    presentationRect,
    normalizeUuid: normalizeWindowUuid,
    relayout,
    commitParking: item => geometryCommitter.commit({
        reason: "workspace-wide-settle", windows: [item], commitOrder: [item],
    }),
    commitHeld: plan => commitLayoutPlan(plan, plan.wideExitColumn, null,
        { nativeScroll: true, legacyMotion: true }),
    departureState: pending => {
        if (!mainScreenState.enabled) return "retired";
        const windows = workspace.windowList();
        for (const column of [pending.target, pending.neighbor]) {
            const window = column.window;
            if (!windows.includes(window)) return "retired";
            const state = states.get(window);
            if (!state || state.floating || window.fullScreen || isTileMode(state.layoutMode) ||
                    !windowPolicy.canJoinColumn(window) ||
                    !workspaceMembership.belongsTo(window, pending.workspaceId) ||
                    !window.output || window.output.name !== pending.outputName) return "retired";
        }
        if (mainScreenState.workspaceSwitching) return "waiting";
        return mainScreenState.activeWorkspaceId === pending.workspaceId ? "retired" : "sleeping";
    },
    setActiveWindow: window => { workspace.activeWindow = window; },
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    debug,
    warn,
    parkGraceMs: CONTEXTUAL_WIDE_PARK_GRACE_MS,
    retryMs: WIDE_GEOMETRY_RETRY_MS,
    maxAttempts: WIDE_GEOMETRY_MAX_ATTEMPTS,
});
let connectedManagedOutputs = new Set();
let scrollLayoutInitialized = false;
const parkingManager = new ParkingManager({
    trackUserMinimized: runtimeConfig.scrollLayoutV2Enabled,
    preserveClientGeometry: runtimeConfig.scrollLayoutV2Enabled,
    stateFor,
    getState: window => states.get(window),
    refreshSafeArea: refreshMainScreenState,
    getSafeRect: () => {
        const geometry = runtimeConfig.scrollLayoutV2Enabled ? v2Geometry() : null;
        return geometry ? geometry.workingArea : mainScreenState.safeRect;
    },
    debug,
});
const geometryCommitter = new GeometryCommitter({
    stateFor,
    sameRect,
    sameRectNear,
    rectCopy,
    rectText,
    isTileMode,
    isRectInsideAnyOutput,
    setWindowVisibility: (window, visible) =>
        parkingManager.setVisibility(window, visible),
    isWindowHidden: window => parkingManager.isHidden(window),
    rememberVisibleGeometry: (window, rect) =>
        parkingManager.rememberVisibleGeometry(window, rect),
    debug,
    warn,
});
const invariantChecker = new InvariantChecker({
    appState: mainScreenState,
    alwaysCenterSingleColumn: runtimeConfig.alwaysCenterSingleColumn,
    getV2Geometry: () => runtimeConfig.scrollLayoutV2Enabled ? v2Geometry() : null,
    workspaceMembership,
    windowStates: states,
    workspaceSnapshots,
    normalizeUuid: normalizeWindowUuid,
    stripWidth,
    managedPhases: [ADOPTION_MANAGED, ADOPTION_SETTLING],
    normalPresentationMode: PRESENTATION_NORMAL,
    debug,
    warn,
});
let stabilitySupervisor;
const layoutTransaction = new LayoutTransaction({
    audit: (reason, epoch) => stabilitySupervisor.audit(reason, epoch),
    debug,
});
const motionPlanCommitGate = new MotionPlanCommitGate({
    publish: (envelope, callback) =>
        runtimeBridge.publishMotionPlan(envelope, callback),
    currentEpoch: () => layoutTransaction.currentEpoch(),
    commit: (plan, context, activationWindow) => {
        // Native now has the legacy viewport marker (or fallback will park
        // partial surfaces). Transfer its clip before installing new geometry.
        scrollPlanCommitGate.cancel();
        if (!context.motionFallback) {
            const envelope = createWidthViewportClipPlan(plan, {
                workspaceId: mainScreenState.activeWorkspaceId,
                targetOutput: mainScreenState.targetOutput.name,
                issuedAt: Date.now(), normalizeUuid: normalizeWindowUuid,
            });
            if (envelope) {
                // Arm paint/input clipping before exposing a Full neighbor.
                // Its translation still shares the existing width timeline.
                scrollPlanCommitGate.whenIdle(() => {
                    if (layoutTransaction.currentEpoch() !== plan.epoch) return;
                    scrollPlanCommitGate.schedule(plan, envelope,
                        { wideExitColumn: context.wideExitColumn, legacyMotion: true });
                    if (activationWindow) activateColumnWhenReady(activationWindow);
                });
                return;
            }
        }
        commitLayoutPlan(plan, context.wideExitColumn, activationWindow);
    },
    warn,
    timeoutMs: 150,
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
});

const scrollPlanCommitGate = new ScrollPlanCommitGate({
    prepare: (context, callback) => {
        if (!context.membershipReason) { callback(true); return; }
        if (!commitRuntimeState(context.membershipReason, callback)) callback(false);
    },
    publish: (envelope, callback) => runtimeBridge.publishMotionPlan(envelope, callback),
    arm: (envelope, callback) => runtimeBridge.armScrollPlan(envelope, callback),
    disarm: (epoch, callback) => runtimeBridge.disarmScrollPlan(epoch, callback),
    cancelDeferred: () => deferredScrollParking.cancel(),
    releaseDeferred: () => deferredScrollParking.release(),
    currentEpoch: () => layoutTransaction.currentEpoch(),
    commit: (plan, context, activationWindow) =>
        commitLayoutPlan(plan, context.wideExitColumn, activationWindow,
            { nativeScroll: context.nativeScroll, legacyMotion: context.legacyMotion }),
    timeoutMs: 150,
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    warn,
});

const deferredScrollParking = new DeferredScrollParking({
    stateFor,
    getState: window => states.get(window),
    isCurrent: column => mainScreenState.enabled && mainScreenState.columns.includes(column),
    context: () => ({ sessionId: runtimeBridge.sessionId(), workspaceId: mainScreenState.activeWorkspaceId,
        targetOutput: mainScreenState.targetOutput ? mainScreenState.targetOutput.name : "" }),
    status: callback => runtimeBridge.scrollMotionStatus(callback),
    disarm: (epoch, callback) => runtimeBridge.disarmScrollPlan(epoch, callback),
    finalize: item => {
        geometryCommitter.commitGeometry(item.column, item.rect, "scroll-finalize");
        parkingManager.setVisibility(item.column.window, false);
    },
    setTimer: setRuntimeTimer, clearTimer: clearRuntimeTimer, warn,
});

function setRuntimeTimer(callback, delayMs) {
    const timer = new QTimer();
    timer.singleShot = true;
    timer.timeout.connect(callback);
    timer.start(delayMs);
    return { timer, callback };
}

function clearRuntimeTimer(handle) {
    handle.timer.stop();
    handle.timer.timeout.disconnect(handle.callback);
}
const recoveryCompletion = new RecoveryCompletionGate({
    getWindows: () => workspace.windowList(), sameRect,
    getWindowId: window => normalizeWindowUuid(window.internalId), warn,
    setTimer: setRuntimeTimer, clearTimer: clearRuntimeTimer,
});
const recovery = new Recovery({
    appState: mainScreenState,
    windowStates: states,
    parking: parkingManager,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    getWindows: () => workspace.windowList(),
    getWindowId: window => normalizeWindowUuid(window.internalId),
    waitForRestored: runtimeConfig.scrollLayoutV2Enabled ? (rows, done) => recoveryCompletion.wait(rows, done) : null,
    onStatus: runtimeConfig.scrollLayoutV2Enabled ? status => runtimeBridge.reportRecoveryStatus(status) : null,
    retire: runtimeConfig.scrollLayoutV2Enabled ? done => {
        mainScreenState.enabled = false;
        continuousLayout.stop(done);
    } : null,
    beforeRestore: reason => {
        if (workspaceMoveController) workspaceMoveController.stop();
        if (workspaceSwitchController) workspaceSwitchController.stop();
        if (workspaceTransferController) workspaceTransferController.stop();
        if (dynamicWorkspaceController) dynamicWorkspaceController.stop();
        if (workspaceRecycleController) workspaceRecycleController.stop();
        if (workspaceMountController) workspaceMountController.stop();
        mainScreenState.enabled = false;
        connectedManagedOutputs.clear();
        motionPlanCommitGate.cancel();
        scrollPlanCommitGate.cancel();
        contextualWideCoordinator.cancel();
        cancelPendingDockScroll(reason);
    },
    debug,
    warn,
});
stabilitySupervisor = new StabilitySupervisor({
    checker: invariantChecker,
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    relayout,
    recovery,
    disableLayout: () => { mainScreenState.enabled = false; },
    isEnabled: () => mainScreenState.enabled,
    warn,
    debug,
});
const adoptionController = new AdoptionController({
    phases: {
        untracked: ADOPTION_UNTRACKED,
        waitingActivation: ADOPTION_WAITING_ACTIVATION,
        waitingPrimary: ADOPTION_WAITING_PRIMARY,
        waitingWorkspace: ADOPTION_WAITING_WORKSPACE,
        waitingEligible: ADOPTION_WAITING_ELIGIBLE,
        waitingNormal: ADOPTION_WAITING_NORMAL,
        adopting: ADOPTION_ADOPTING,
        settling: ADOPTION_SETTLING,
        managed: ADOPTION_MANAGED,
        floating: ADOPTION_FLOATING,
        policyFloating: ADOPTION_POLICY_FLOATING,
        ignored: ADOPTION_IGNORED,
    },
    stateFor,
    hasState: window => states.has(window),
    indexOfWindow: window => columnStore.indexOfWindow(window),
    getAppState: () => mainScreenState,
    refreshAppState: refreshMainScreenState,
    windowPolicy,
    workspaceMembership,
    workspaceReady: () => workspaceMountController && workspaceMountController.canUseActiveWorkspace() &&
        (!workspaceTransferController || !workspaceTransferController.isProcessing()),
    dispositions: WindowDisposition,
    removeManagedWindow: removeColumn,
    isLayoutMode,
    isTileMode,
    detectQuickTileMode,
    fullMaximizeMode: FULL_MAXIMIZE_MODE,
    adoptWindow: adoptNewWindowAsColumn,
    settleLayout: settleAdoptionGeometry,
    rectText,
    debug,
});
const floatingController = new FloatingController({
    workspaceMembership,
    stateFor,
    hasState: window => states.has(window),
    indexOfWindow: window => columnStore.indexOfWindow(window),
    getAppState: () => mainScreenState,
    refreshAppState: refreshMainScreenState,
    windowPolicy,
    dispositions: WindowDisposition,
    prepareWindow: prepareInitialColumn,
    adoptWindow: adoptNewWindowAsColumn,
    removeColumn,
    transitionAdoption: (window, windowState, phase, reason) =>
        adoptionController.transition(window, windowState, phase, reason),
    floatingPhase: ADOPTION_FLOATING,
    settlingPhase: ADOPTION_SETTLING,
    managedPhase: ADOPTION_MANAGED,
    getActiveWindow: () => workspace.activeWindow,
    setActiveWindow: window => {
        activateColumnWhenReady(window);
    },
    rectText,
    debug,
    warn,
    now: () => Date.now(),
    focusGuardMs: FLOATING_FOCUS_GUARD_MS,
});
const outputController = new OutputController({
    stateFor,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    resolvePrimaryOutput: resolveTargetOutput,
    clearPresentationForWindow: window => {
        if (mainScreenState.presentation.windowUuid ===
                normalizeWindowUuid(window.internalId)) {
            clearPresentationState();
        }
    },
    removeColumn,
    transitionAdoption: (window, windowState, phase, reason) =>
        adoptionController.transition(window, windowState, phase, reason),
    phases: {
        untracked: ADOPTION_UNTRACKED,
        waitingPrimary: ADOPTION_WAITING_PRIMARY,
        floating: ADOPTION_FLOATING,
        policyFloating: ADOPTION_POLICY_FLOATING,
        ignored: ADOPTION_IGNORED,
    },
    profileForOutput,
    translateRestoreGeometry,
    fullMaximizeMode: FULL_MAXIMIZE_MODE,
    maximizeMode: MAXIMIZE_MODE,
    applyLayoutGeometry,
    detectQuickTileMode,
    isTileMode,
    applyDetectedTile,
    beginAdoption: beginWindowAdoption,
    advanceAdoption: advanceWindowAdoption,
    setLayoutMode,
    rectText,
    debug,
});
const fullscreenController = new FullscreenController({
    viewport: contextualViewport,
    stateFor,
    getAppState: () => mainScreenState,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    relayout,
    onManagedOutput,
    isLayoutMode,
    applyLayoutGeometry,
    advanceAdoption: (window, reason) =>
        adoptionController.onFullscreenChanged(window, reason),
    normalMode: NORMAL_MODE,
    debug,
});
const presentationController = new PresentationController({
    getAppState: () => mainScreenState,
    viewport: contextualViewport,
    normalizeUuid: normalizeWindowUuid,
    stateFor,
    setLayoutMode,
    modes: {
        normal: PRESENTATION_NORMAL,
        wide: PRESENTATION_WIDE,
        maximized: PRESENTATION_MAXIMIZED,
    },
    normalLayoutMode: NORMAL_MODE,
    maximizeLayoutMode: MAXIMIZE_MODE,
    wideRatio: WIDE_RATIO,
    rectCopy,
    cancelPendingDockScroll,
    focusColumn: column => columnStore.focusColumn(column),
    recomputeLogicalLayout,
    ensureColumnVisible,
    relayout,
    getActiveWindow: () => workspace.activeWindow,
    setActiveWindow: activateColumnWhenReady,
    commitRuntimeState,
    debug,
});
const dockScrollController = runtimeConfig.dockIntegration ? new DockScrollController({
    getAppState: () => mainScreenState,
    normalizeUuid: normalizeWindowUuid,
    recomputeLogicalLayout,
    clampScrollOffset,
    stripWidth,
    isFullyVisible: isFullyVisibleInSafeRect,
    projectedRectForColumn,
    requestDeferred: (command, delayMs, callback) =>
        runtimeBridge.requestDeferred(command, delayMs, callback),
    getSessionId: () => runtimeBridge.sessionId(),
    stepMs: DOCK_SCROLL_STEP_MS,
    clearPresentation: clearPresentationState,
    normalPresentationMode: PRESENTATION_NORMAL,
    commitRuntimeState,
    publishRuntimeState,
    focusIndex: index => columnStore.focusIndex(index),
    transitionFocused: relayoutFocusedColumnTransition,
    isActivationDeferred: () => contextualWideCoordinator.isActivationDeferred(),
    setActiveWindow: window => {
        activateColumnWhenReady(window);
    },
    relayout,
    debug,
}) : null;
const columnWidthController = new ColumnWidthController({
    scrollLayoutV2Enabled: runtimeConfig.scrollLayoutV2Enabled,
    applyV2Width: (column, mode, reason) => continuousLayout.ready() &&
        continuousLayout.controller.setWidth(column, mode, reason),
    getAppState: () => mainScreenState,
    getActiveWindow: () => workspace.activeWindow,
    captureLayout: column => captureColumnWidthTransition(column,
        mainScreenState.columns, mainScreenState.safeRect, mainScreenState.innerGap),
    cancelPending: reason => {
        motionPlanCommitGate.cancel();
        scrollPlanCommitGate.retainForLegacy();
        contextualWideCoordinator.cancel();
        cancelPendingDockScroll(reason);
    },
    clearPresentation: () => {
        clearPresentationState();
        mainScreenState.prePresentationViewport = null;
        contextualWideCoordinator.adoptRestoredViewport();
    },
    focusColumn: column => columnStore.focusColumn(column),
    recomputeLogicalLayout,
    ensureColumnVisible,
    relayout,
    commitState: commitRuntimeState,
});
const reorderController = new ReorderController({
    getAppState: () => mainScreenState,
    normalizeUuid: normalizeWindowUuid,
    rejectRuntimeCommand,
    cancelDockScroll: cancelPendingDockScroll,
    getFocusedColumn: () => columnStore.focusedColumn(),
    reorderColumns: columns => columnStore.reorder(columns),
    recomputeLogicalLayout,
    ensureColumnVisible,
    relayout,
    getGeneration: () => runtimeBridge.generation(),
    commitRuntimeState,
    getActiveWindow: () => workspace.activeWindow,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    focusIndex: index => columnStore.focusIndex(index),
    focusedIndex: () => columnStore.focusedIndex(),
    moveFocusedColumn: delta => columnStore.moveFocused(delta),
    debug,
});
workspaceMountController = new WorkspaceMountController({
    scrollLayoutV2Enabled: runtimeConfig.scrollLayoutV2Enabled,
    captureV2View: runtimeConfig.scrollLayoutV2Enabled ? () => continuousLayout.captureView() : null,
    restoreV2View: (anchor, preserve) => continuousLayout.restoreView(anchor, preserve),
    onMounted: runtimeConfig.scrollLayoutV2Enabled ? reason => continuousLayout.sync(reason) : null,
    appState: mainScreenState,
    columnStore,
    snapshots: workspaceSnapshots,
    persistence: workspacePersistence,
    topology: virtualDesktopTopology,
    membership: workspaceMembership,
    windowPolicy,
    stateFor,
    getWindows: () => workspace.windowList(),
    getActiveWindow: () => workspace.activeWindow,
    normalizeUuid: normalizeWindowUuid,
    refreshState: refreshMainScreenState,
    prepareWindow: prepareInitialColumn,
    transitionAdoption: (window, state, phase, reason) =>
        adoptionController.transition(window, state, phase, reason),
    phases: { managed: ADOPTION_MANAGED, waitingWorkspace: ADOPTION_WAITING_WORKSPACE },
    cancelPending: reason => {
        if (continuousLayout && reason !== "workspace-stop" && reason !== "workspace-column-move") continuousLayout.releaseForWorkspace();
        motionPlanCommitGate.cancel();
        if (reason !== "workspace-stop" && reason !== "workspace-column-move" &&
                deferredScrollParking.pending && deferredScrollParking.pending.partialItems.length)
            scrollPlanCommitGate.releaseForWorkspace();
        else scrollPlanCommitGate.cancel();
        cancelPendingDockScroll(reason);
        contextualViewport.cancelReveal();
        contextualWideCoordinator.cancelForWorkspace();
    },
    resetPresentation: clearPresentationState,
    restoreViewport: snapshot => {
        contextualViewport.restore(snapshot);
        contextualWideCoordinator.adoptRestoredViewport();
    },
    recomputeLayout: recomputeLogicalLayout,
    boundOffset: offset => boundScrollOffset(offset, stripWidth(),
        mainScreenState.safeRect ? mainScreenState.safeRect.width : 0),
    ensureVisible: ensureColumnVisible,
    activateColumn: activateColumnWhenReady,
    relayout,
    commitState: commitRuntimeState,
    releaseWindow: (window, reason) => releaseParkingOwnership(window, reason, true),
    onFailure: error => {
        warn(`[cc-workspace] mount failed: ${error}`);
        emergencyRestoreAllWindows("workspace-mount-failure");
    },
    debug,
});
workspaceSwitchController = new WorkspaceSwitchController({
    appState: mainScreenState,
    mount: workspaceMountController,
    topology: virtualDesktopTopology,
    requestDesktop: (desktop, output) => {
        if (typeof workspace.setCurrentDesktopForScreen === "function") {
            workspace.setCurrentDesktopForScreen(desktop, output);
        } else {
            workspace.currentDesktop = desktop;
        }
    },
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    onFailure: error => {
        warn(`[cc-workspace] switch failed: ${error}`);
        emergencyRestoreAllWindows("workspace-switch-failure");
    },
    debug,
});
workspaceTransferController = new WorkspaceTransferController({
    scrollLayoutV2Enabled: runtimeConfig.scrollLayoutV2Enabled,
    appState: mainScreenState,
    snapshots: workspaceSnapshots,
    topology: virtualDesktopTopology,
    membership: workspaceMembership,
    windowPolicy,
    stateFor,
    normalizeUuid: normalizeWindowUuid,
    getColumn: window => mainScreenState.columns[columnStore.indexOfWindow(window)] || null,
    cancelPending: (window, reason) => {
        motionPlanCommitGate.cancel();
        scrollPlanCommitGate.cancel();
        contextualWideCoordinator.cancelForWindow(window);
        contextualViewport.cancelReveal();
        cancelPendingDockScroll(reason);
    },
    releaseWindow: (window, reason) => releaseParkingOwnership(window, reason, true),
    removeWindow: (window, reason) => removeColumn(window, reason, false),
    adoption: adoptionController,
    flushLayout: reason => {
        recomputeLogicalLayout();
        clampScrollOffset();
        relayout(reason);
    },
    canCommit: () => scrollLayoutInitialized && workspaceMountController.canUseActiveWorkspace(),
    commitState: commitRuntimeState,
    onFailure: error => {
        warn(`[cc-workspace] transfer failed: ${error}`);
        emergencyRestoreAllWindows("workspace-transfer-failure");
    },
});
workspaceMoveController = new WorkspaceMoveController({
    appState: mainScreenState,
    mount: workspaceMountController,
    switcher: workspaceSwitchController,
    transfer: workspaceTransferController,
    topology: virtualDesktopTopology,
    membership: workspaceMembership,
    snapshots: workspaceSnapshots,
    columnStore,
    windowPolicy,
    stateFor,
    normalizeUuid: normalizeWindowUuid,
    getActiveWindow: () => workspace.activeWindow,
    getWindows: () => workspace.windowList(),
    settleMotion: callback => continuousLayout
        ? continuousLayout.exclusive("workspace-column-move", callback)
        : scrollPlanCommitGate.whenIdle(callback),
    clearPresentation: () => {
        contextualWideCoordinator.cancel();
        clearPresentationState();
        mainScreenState.prePresentationViewport = null;
    },
    changeMembership: (window, desktop) => { window.desktops = [desktop]; },
    settleSourceLayout: () => {
        recomputeLogicalLayout();
        clampScrollOffset();
        const focused = columnStore.focusedColumn();
        if (focused) ensureColumnVisible(focused);
    },
    onSettled: () => {
        dynamicWorkspaceController.request();
        workspaceRecycleController.request();
    },
    onFailure: error => {
        warn(`[cc-workspace] move failed: ${error}`);
        emergencyRestoreAllWindows("workspace-move-failure");
    },
    debug,
});
dynamicWorkspaceController = new DynamicWorkspaceController({
    enabled: runtimeConfig.dynamicTrailingWorkspace,
    isReady: () => scrollLayoutInitialized && mainScreenState.enabled &&
        !mainScreenState.workspaceSwitching && !workspaceTransferController.isProcessing() &&
        (!workspaceRecycleController || workspaceRecycleController.pendingId === null),
    getTargetOutput: () => resolveTargetOutput(),
    getDesktops: () => workspace.desktops,
    getWindows: () => workspace.windowList(),
    membership: workspaceMembership,
    occupancy: workspaceOccupancy,
    createDesktop: typeof workspace.createDesktop === "function"
        ? (position, name) => workspace.createDesktop(position, name) : null,
    ensureVerticalLayout: count => runtimeBridge.ensureVerticalDesktopLayout(
        count, accepted => {
            if (!accepted) warn("[cc-workspace] vertical desktop layout not confirmed");
        }),
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    onSettled: () => { if (workspaceRecycleController) workspaceRecycleController.request(); },
    warn,
});
workspaceRecycleController = new WorkspaceRecycleController({
    enabled: runtimeConfig.dynamicTrailingWorkspace && runtimeConfig.autoRecycleWorkspaces,
    transitionStatus: callback => runtimeBridge.workspaceTransitionStatus(callback),
    isReady: () => scrollLayoutInitialized && workspaceMountController.canUseActiveWorkspace() &&
        !workspaceTransferController.isProcessing() && dynamicWorkspaceController.pendingTopology === null,
    getDesktopIds: () => virtualDesktopTopology.ordered().map(desktop => virtualDesktopTopology.id(desktop)),
    getProtectedIds: () => [mainScreenState.activeWorkspaceId].concat(
        Array.from(workspace.screens, output => virtualDesktopTopology.id(virtualDesktopTopology.current(output)))),
    getWindows: () => workspace.windowList(),
    occupancy: workspaceOccupancy,
    removeDesktop: typeof workspace.removeDesktop === "function" ? id => {
        const desktop = virtualDesktopTopology.byId(id);
        if (desktop) workspace.removeDesktop(desktop);
    } : null,
    onRemoved: id => {
        workspaceSnapshots.remove(id);
        commitRuntimeState("workspace-recycle");
        dynamicWorkspaceController.request();
    },
    ensureVerticalLayout: count => dynamicWorkspaceController.ensureVerticalLayout(count),
    onFailure: error => {
        warn(`[cc-workspace] recycle cleanup failed: ${error}`);
        emergencyRestoreAllWindows("workspace-recycle-failure");
    },
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    warn,
});
focusRingController = new FocusRingController({
    workspace,
    invoke: callDBus,
    getState: () => mainScreenState,
    getWindowState: window => states.get(window),
    getCurrentDesktop: output => virtualDesktopTopology.current(output),
    membership: workspaceMembership,
    windowPolicy,
    now: () => Date.now(),
    random: () => Math.random(),
});
if (runtimeConfig.scrollLayoutV2Enabled) {
    continuousLayout = new ContinuousLayoutRuntime({
        state: mainScreenState, columnStore, transaction: layoutTransaction, bridge: runtimeBridge,
        dockEnabled: runtimeConfig.dockIntegration,
        getPrimaryOutput: resolveTargetOutput,
        getCurrentWorkspaceId: () => virtualDesktopTopology.id(virtualDesktopTopology.current(mainScreenState.targetOutput)),
        getUuid: window => normalizeWindowUuid(window.internalId),
        getGeometry: v2Geometry,
        canJoin: (window, scope) => windowPolicy.canJoinColumn(window) &&
            workspaceMembership.belongsTo(window, scope.workspaceId) && window.output === scope.output && !stateFor(window).floating,
        commitState: (reason, done) => { if (!commitRuntimeState(reason, done)) done(false); },
        committer: geometryCommitter,
        prepareClient: window => parkingManager.prepareGeometry(window),
        setVisibility: (window, visible) => parkingManager.setVisibility(window, visible),
        activate: window => { stateFor(window).scrollUserMinimized = false; workspace.activeWindow = window; },
        fail: (reason, cancelled) => {
            warn(`[cc-v2] disabled reason=${reason} cancelled=${cancelled}`);
            mainScreenState.enabled = false;
            if (cancelled === true) emergencyRestoreAllWindows("v2-geometry-failure");
        },
        onSettled: () => focusRingController.publish(),
        setTimer: setRuntimeTimer, clearTimer: clearRuntimeTimer, now: () => Date.now(), warn,
    });
}

function v2Geometry() {
    return outputTopology.v2Geometry(mainScreenState.targetOutput,
        virtualDesktopTopology.current(mainScreenState.targetOutput));
}

function v2Departure(window, reason, action) {
    if (!window || !continuousLayout || continuousLayout.inExclusive) return action();
    return continuousLayout.exclusive(`${reason}:${normalizeWindowUuid(window.internalId)}`, () => {
        if (workspace.windowList().includes(window)) action();
    });
}

const controllerComposition = new ControllerComposition(Object.assign({
    focusRing: focusRingController,
    workspaceRecycle: workspaceRecycleController,
    dynamicWorkspace: dynamicWorkspaceController,
    workspaceTransfer: workspaceTransferController,
    workspaceMove: workspaceMoveController,
    workspaceSwitch: workspaceSwitchController,
    workspaceMount: workspaceMountController,
    parking: parkingManager,
    geometry: geometryCommitter,
    invariants: invariantChecker,
    transactions: layoutTransaction,
    recovery,
    adoption: adoptionController,
    floating: floatingController,
    output: outputController,
    fullscreen: fullscreenController,
    presentation: presentationController,
    columnWidth: columnWidthController,
    runtimeBridge,
    reorder: reorderController,
}, dockScrollController ? { dockScroll: dockScrollController } : {}), [
    "focusRing", "parking", "geometry", "invariants", "transactions", "recovery",
    "adoption", "floating", "output", "fullscreen", "presentation", "columnWidth",
    "runtimeBridge", "reorder", "workspaceMount", "workspaceSwitch", "workspaceTransfer", "workspaceMove", "dynamicWorkspace", "workspaceRecycle",
]);

function debug(message) {
    runtimeLogger.debug(message);
}

function warn(message) {
    runtimeLogger.warn(message);
}

function normalizeWindowUuid(value) {
    return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
}

function createRuntimeSnapshot() {
    const focusedColumn = mainScreenState.columns[mainScreenState.focusedColumnIndex] || null;
    const wideColumn = contextualViewport.column();
    const anchorColumn = mainScreenState.columns.reduce((anchor, column) =>
        column.logicalX <= mainScreenState.scrollOffsetX ? column : anchor, null);
    if (workspaceMountController && workspaceMountController.canUseActiveWorkspace()) workspaceMountController.capture();
    const saved = mainScreenState.activeWorkspaceId && workspaceSnapshots.get(mainScreenState.activeWorkspaceId);
    const active = {
        workspaceId: mainScreenState.activeWorkspaceId,
        workspaceIndex: virtualDesktopTopology.indexOf(
            virtualDesktopTopology.byId(mainScreenState.activeWorkspaceId)),
        targetOutput: mainScreenState.targetOutput ? mainScreenState.targetOutput.name : "",
        focusedUuid: focusedColumn
            ? normalizeWindowUuid(focusedColumn.window.internalId)
            : "",
        presentation: {
            windowUuid: wideColumn
                ? normalizeWindowUuid(wideColumn.window.internalId)
                : mainScreenState.presentation.windowUuid || null,
            mode: wideColumn
                ? PRESENTATION_WIDE : mainScreenState.presentation.mode,
        },
        columns: mainScreenState.columns.map(column => {
            const entry = workspaceColumnPreference(column, normalizeWindowUuid(column.window.internalId),
                runtimeConfig.scrollLayoutV2Enabled);
            if (!continuousLayout) { delete entry.previousNonFullWidthMode; delete entry.persistentWide; }
            return entry;
        }),
        viewportAnchor: anchorColumn ? {
            uuid: normalizeWindowUuid(anchorColumn.window.internalId),
            delta: mainScreenState.scrollOffsetX - anchorColumn.logicalX,
        } : null,
    };
    if (saved && saved.viewportAnchorV2 !== undefined) active.viewportAnchorV2 = saved.viewportAnchorV2;
    return workspacePersistence.snapshot(active);
}

function publishRuntimeState(reason) {
    focusRingController.publish();
    if (workspaceTransferController && workspaceTransferController.isProcessing()) return null;
    return runtimeBridge.publish(createRuntimeSnapshot(), reason);
}

function commitRuntimeState(reason, callback = () => {}) {
    focusRingController.publish();
    if (workspaceTransferController && workspaceTransferController.isProcessing()) return null;
    return runtimeBridge.commit(createRuntimeSnapshot(), reason, callback);
}

function rejectRuntimeCommand(reason) {
    return runtimeBridge.reject(null, reason);
}

function handleDockPresentationCommand(command) {
    const windowUuid = normalizeWindowUuid(command.windowUuid);
    const mode = String(command.mode || "");
    const column = mainScreenState.columns.find(item =>
        normalizeWindowUuid(item.window.internalId) === windowUuid);
    if (!column || column.window.output !== mainScreenState.targetOutput ||
            !isPresentationMode(mode)) {
        rejectRuntimeCommand("invalid-presentation-target");
        return false;
    }
    return setPresentationMode(windowUuid, mode, "dock-presentation");
}

function handleDockFocusCommand(command) {
    const windowUuid = normalizeWindowUuid(command.windowUuid);
    const index = mainScreenState.columns.findIndex(item =>
        normalizeWindowUuid(item.window.internalId) === windowUuid);
    const column = index >= 0 ? mainScreenState.columns[index] : null;
    if (!column || column.window.output !== mainScreenState.targetOutput) {
        rejectRuntimeCommand("invalid-focus-target");
        return false;
    }
    return beginDockScroll(column, "dock-focus-right");
}

function handleDockReorderCommand(command) {
    if (continuousLayout) {
        const order = Array.isArray(command.order) ? command.order : command.windowUuids;
        return continuousLayout.ready() && continuousLayout.controller.reorder(order);
    }
    return reorderController.applyRuntimeCommand(command);
}

function runWorkspaceAction(action) {
    if (!workspaceMountController || !workspaceMountController.canUseActiveWorkspace()) return false;
    return action();
}

function applyPendingRuntimeCommand() {
    return runtimeBridge.takePendingCommand();
}

function rectCopy(rect) {
    return copyRect(rect);
}

function rectText(rect) {
    return formatRect(rect);
}

function sameRect(a, b) {
    return rectsEqual(a, b);
}

function sameRectNear(a, b) {
    return rectsNearlyEqual(a, b);
}

function sameSizeNear(a, b) {
    return sizesNearlyEqual(a, b);
}

function resolveTargetOutput() {
    return outputTopology.primary();
}

function resolveSecondaryOutput() {
    return outputTopology.secondary();
}

function profileForOutput(output) {
    return outputTopology.profile(output);
}

function managedOutputs() {
    return outputTopology.managed();
}

function safeRectFor(output) {
    return outputTopology.safeRect(output);
}

function scrollEligible(window) {
    return windowPolicy.canJoinColumn(window) &&
        workspaceMembership.belongsToActive(window, mainScreenState.targetOutput);
}

function refreshMainScreenState() {
    mainScreenState.targetOutput = resolveTargetOutput();
    mainScreenState.safeRect = mainScreenState.targetOutput
        ? safeRectFor(mainScreenState.targetOutput)
        : null;
    mainScreenState.innerGap = innerGap;
}

function recomputeLogicalLayout() {
    if (continuousLayout) {
        const geometry = v2Geometry();
        if (!geometry) return;
        const layout = deriveV2Layout(mainScreenState.columns, geometry);
        mainScreenState.columns.forEach((column, index) => Object.assign(column, layout.columns[index]));
        return;
    }
    if (!mainScreenState.safeRect) return;
    const layout = deriveColumnLayout(
        mainScreenState.columns,
        mainScreenState.safeRect.width,
        mainScreenState.innerGap,
        { alwaysCenterSingleColumn: runtimeConfig.alwaysCenterSingleColumn }
    );
    mainScreenState.columns.forEach((column, index) => {
        column.pixelWidth = layout[index].pixelWidth;
        column.logicalX = layout[index].logicalX;
    });
}

function stripWidth() {
    if (continuousLayout && v2Geometry()) return deriveV2Layout(mainScreenState.columns, v2Geometry()).stripEnd;
    return computeStripWidth(mainScreenState.columns);
}

function clampScrollOffset() {
    if (continuousLayout && v2Geometry()) {
        mainScreenState.scrollOffsetX = clampV2Camera(mainScreenState.scrollOffsetX,
            deriveV2Layout(mainScreenState.columns, v2Geometry()).maxCamera);
        return;
    }
    const viewportWidth = mainScreenState.safeRect ? mainScreenState.safeRect.width : 0;
    mainScreenState.scrollOffsetX = boundScrollOffset(
        mainScreenState.scrollOffsetX,
        stripWidth(),
        viewportWidth
    );
}

function ensureColumnVisible(column) {
    if (continuousLayout && v2Geometry()) {
        const layout = deriveV2Layout(mainScreenState.columns, v2Geometry());
        mainScreenState.scrollOffsetX = focusV2Camera(layout, columnStore.indexOf(column), mainScreenState.scrollOffsetX);
        return;
    }
    if (!column || !mainScreenState.safeRect) return;
    const oldOffset = mainScreenState.scrollOffsetX;
    mainScreenState.scrollOffsetX = scrollOffsetToRevealColumn(
        runtimeConfig.alwaysCenterSingleColumn && mainScreenState.columns.length > 1
            ? Math.max(oldOffset, virtualLeadingInset(mainScreenState.safeRect.width,
                mainScreenState.innerGap, true)) : oldOffset,
        column,
        stripWidth(),
        mainScreenState.safeRect.width
    );
    if (oldOffset !== mainScreenState.scrollOffsetX) {
        debug(`[cc-scroll] SCROLL old=${oldOffset} new=${mainScreenState.scrollOffsetX}`);
    }
}

function projectedRectForColumnAtOffset(column, scrollOffsetX) {
    if (continuousLayout && v2Geometry()) return projectV2Column(column, v2Geometry(), scrollOffsetX).visualRect;
    return projectColumnRect(column, mainScreenState.safeRect, scrollOffsetX);
}

function projectedRectForColumn(column) {
    return projectedRectForColumnAtOffset(column, mainScreenState.scrollOffsetX);
}

function isPresentationMode(mode) {
    return presentationController.isMode(mode);
}

function presentationColumn() {
    return presentationController.column();
}

function wideRect() {
    return presentationController.wideRect();
}

function presentationRect() {
    return presentationController.rect();
}

function isFullyVisibleInSafeRect(rect) {
    return isRectFullyVisible(rect, mainScreenState.safeRect);
}

function rectIntersects(a, b) {
    return rectanglesIntersect(a, b);
}

function isRectInsideAnyOutput(rect) {
    return workspace.screens.some(output => rectIntersects(rect, output.geometry));
}

function virtualScreenLeft() {
    const geometry = workspace.virtualScreenGeometry;
    if (geometry && Number.isFinite(Number(geometry.x))) return Number(geometry.x);
    return workspace.screens.reduce(
        (left, output) => Math.min(left, output.geometry.x),
        0
    );
}

function looksLikeInheritedParking(window) {
    const rect = window.frameGeometry;
    return Number(window.opacity) <= 0 && window.minimized && rect &&
        Number(rect.x) < virtualScreenLeft();
}

function parkingBaseX() {
    return computeParkingBaseX(
        mainScreenState.columns,
        virtualScreenLeft(),
        PARKING_MARGIN
    );
}

function releaseParkingOwnership(window, reason, ensureAccessible = false,
        fallbackIndex = 0) {
    return parkingManager.release(
        window,
        reason,
        ensureAccessible,
        fallbackIndex
    );
}

function emergencyRestoreAllWindows(reason, requestId = null) {
    focusRingController.stop();
    stabilitySupervisor.stop();
    return recovery.restoreAll(reason, requestId);
}

function beginLayoutTransaction(reason) {
    return layoutTransaction.begin(reason);
}

function endLayoutTransaction(reason, epoch) {
    layoutTransaction.end(reason, epoch);
}

function relayoutImpl(reason, scrollOffsets, widthTransition, previousSingleLayout) {
    if (!mainScreenState.enabled) {
        warn(`[cc-scroll] relayout skipped: disabled reason=${reason}`);
        return;
    }
    if (!mainScreenState.columns.length) return;
    refreshMainScreenState();
    if (!mainScreenState.safeRect) return;
    recomputeLogicalLayout();
    clampScrollOffset();
    const singleTransition = classifySingleColumnTransition(previousSingleLayout, mainScreenState);
    // A reindexed survivor has a different logical origin. Never combine its
    // new logical X with the old camera to invent a Scroll v2 source pose.
    const reindexed = singleTransition === "reindex" || singleTransition === "rebase" ||
        Boolean(scrollPlanCommitGate.pending && scrollPlanCommitGate.pending.staticFallback);
    if (reindexed) scrollOffsets = undefined;
    const presentedColumn = presentationColumn();
    contextualWideCoordinator.prepareLayoutTransition(presentedColumn, widthTransition);
    const wideExitColumn = widthTransition && widthTransition.column.widthMode !== "full"
        ? widthTransition.column : contextualWideCoordinator.wideExitColumn();
    if (scrollOffsets) scrollOffsets = Object.assign({}, scrollOffsets, {
        oldScrollOffsetX: scrollPlanCommitGate.baseOffset(scrollOffsets.oldScrollOffsetX),
    });
    let plan = computeLayoutPlan({
        reason,
        epoch: layoutTransaction.currentEpoch(),
        columns: mainScreenState.columns,
        safeRect: mainScreenState.safeRect,
        innerGap: mainScreenState.innerGap,
        parkingBaseX: parkingBaseX(),
        scrollOffsetX: mainScreenState.scrollOffsetX,
        scrollOffsets,
        presentedColumn,
        presentedRect: presentedColumn ? presentationRect() : null,
        retainedColumn: contextualWideCoordinator.retainedNeighbor(),
        wideExitColumn,
        wideRect: presentationController.wideRect(),
        widthTransition,
        clipPartial: true,
    });
    const directionalFocus = reason === "focus-next" || reason === "focus-previous";
    const singleScroll = singleTransition === "scroll";
    if (!reindexed && (directionalFocus || singleScroll) && !plan.viewportMotion && !plan.scrollTransaction &&
            (scrollPlanCommitGate.pending || (singleScroll && deferredScrollParking.pending))) {
        // Equal committed offsets do not imply equal painted positions. Reverse
        // the pending Spring through the same native ACK gate instead of snap.
        plan = prepareViewportReturnPlan(plan, mainScreenState.scrollOffsetX, mainScreenState.safeRect);
    }
    if (directionalFocus && !plan.viewportMotion && !plan.scrollTransaction &&
            !scrollPlanCommitGate.pending && deferredScrollParking.pending) {
        // Focus can move inside the already committed pair without stopping
        // its in-flight visual offset or retiring any outgoing window.
        return;
    }
    if (plan.viewportMotion) {
        const motion = plan.viewportMotion;
        const partialExitToken = contextualWideCoordinator.preparePartialExit(plan);
        const envelope = {
            epoch: plan.epoch,
            issuedAt: Date.now(),
            type: motion.type,
            side: motion.side,
            viewport: motion.viewport,
            oldViewportMode: motion.oldViewportMode,
            newViewportMode: motion.newViewportMode,
            parkAfterComplete: motion.parkAfterComplete,
            transitionToken: motion.type === "PAIR_TO_WIDE"
                ? contextualWideCoordinator.parkToken() : partialExitToken,
            targetWindowUuid: normalizeWindowUuid(
                plan.windows.find(item => item.columnId ===
                    motion.targetColumnId).column.window.internalId),
            entries: motion.entries.map((entry, index) => Object.assign({}, entry, {
                windowId: normalizeWindowUuid(entry.windowId),
                oldRealRect: plan.layoutSnapshots.from.entries[index].realRect,
                newRealRect: plan.layoutSnapshots.to.entries[index].realRect,
            })),
        };
        scrollPlanCommitGate.retainForLegacy();
        motionPlanCommitGate.schedule(plan, envelope, { wideExitColumn });
        return;
    }
    if (singleTransition === "reindex") {
        const reindexPlan = prepareSingleColumnReindexPlan(plan, previousSingleLayout, mainScreenState.scrollOffsetX);
        if (reindexPlan) {
            const envelope = createViewportReindexPlan(reindexPlan.scrollTransaction, {
                workspaceId: mainScreenState.activeWorkspaceId,
                targetOutput: mainScreenState.targetOutput.name,
                issuedAt: Date.now(), normalizeUuid: normalizeWindowUuid,
            });
            if (envelope) {
                motionPlanCommitGate.cancel(); deferredScrollParking.pause();
                scrollPlanCommitGate.schedule(reindexPlan, envelope, { wideExitColumn, membershipReason: reason });
                return true;
            }
        }
    }
    if (!reindexed && plan.scrollTransaction && (directionalFocus || singleScroll || plan.scrollTransaction.clipPartial)) {
        const envelope = createViewportScrollPlan(plan.scrollTransaction, {
            workspaceId: mainScreenState.activeWorkspaceId,
            targetOutput: mainScreenState.targetOutput.name,
            issuedAt: Date.now(),
            normalizeUuid: normalizeWindowUuid,
        });
        if (envelope) {
            motionPlanCommitGate.cancel();
            deferredScrollParking.pause();
            // Hydration installs new UUID membership before Bridge validates the plan.
            if (reason === "workspace-mount") commitRuntimeState(reason);
            scrollPlanCommitGate.schedule(plan, envelope, { wideExitColumn,
                membershipReason: singleScroll ? reason : null });
            return singleScroll;
        }
    }
    motionPlanCommitGate.cancel();
    scrollPlanCommitGate.cancel();
    if (reindexed) {
        scrollPlanCommitGate.commitWhenDisarmed(plan, { wideExitColumn }, mainScreenState.scrollOffsetX);
        return;
    }
    commitLayoutPlan(plan, wideExitColumn, null);
}

function commitLayoutPlan(plan, wideExitColumn, activationWindow, options) {
    return layoutTransaction.resume(plan.reason, plan.epoch, () => {
        const activeBeforeCommit = workspace.activeWindow;
        if (!options || !options.nativeScroll) deferredScrollParking.cancel();
        const commitResult = geometryCommitter.commit(plan, options);
        if (options && options.nativeScroll) deferredScrollParking.start(plan.epoch, commitResult.pendingPark, plan.windows.filter(item => item.partial));
        // A restored client can activate during unminimize. Preserve actual
        // focus through this batch; explicit deferred activation is applied by
        // the existing coordinator after its geometry readiness checks.
        if (activeBeforeCommit && workspace.activeWindow !== activeBeforeCommit &&
                !activeBeforeCommit.minimized && workspace.windowList().includes(activeBeforeCommit)) {
            workspace.activeWindow = activeBeforeCommit;
        }
        contextualWideCoordinator.onPlanCommitted(plan, wideExitColumn,
            commitResult, activationWindow, options);
    });
}

function activateColumnWhenReady(window) {
    if (continuousLayout && columnStore.indexOfWindow(window) >= 0) {
        if (continuousLayout.ready()) continuousLayout.controller.focusWindow(window);
        return; // P4 activates only after the matching client/paint proof.
    }
    if (scrollPlanCommitGate.deferActivation(window)) return;
    if (motionPlanCommitGate.deferActivation(window)) return;
    if (!contextualWideCoordinator.deferActivation(window)) {
        workspace.activeWindow = window;
    }
}

function relayout(reason, scrollOffsets, widthTransition, previousSingleLayout) {
    if (reason !== "workspace-mount" && workspaceTransferController &&
            workspaceTransferController.deferLayout()) return;
    if (reason !== "workspace-mount" && !workspaceMountController.canUseActiveWorkspace()) return;
    if (continuousLayout) { refreshMainScreenState(); return continuousLayout.sync(reason); }
    const epoch = beginLayoutTransaction(reason);
    try {
        return relayoutImpl(reason, scrollOffsets, widthTransition, previousSingleLayout);
    } finally {
        endLayoutTransaction(reason, epoch);
    }
}

function columnIndexForWindow(window) {
    return columnStore.indexOfWindow(window);
}

function clearPresentationState() {
    contextualViewport.cancelReveal();
    return presentationController.clear();
}

function cancelPendingDockScroll(reason, preserveWideReveal = false) {
    if (!preserveWideReveal) contextualViewport.cancelReveal();
    return dockScrollController ? dockScrollController.cancel(reason) : false;
}

function advancePendingDockScroll(command) {
    return dockScrollController ? dockScrollController.advance(command) : false;
}

function beginDockScroll(column, reason) {
    if (continuousLayout) return continuousLayout.ready() && continuousLayout.controller.focusWindow(column.window, "dock");
    if (!dockScrollController) return false;
    contextualViewport.cancelReveal();
    return dockScrollController.begin(column, reason);
}

function relayoutFocusedColumnTransition(column, reason, oldScrollOffsetX,
        newScrollOffsetX, wideStepDirection = 0, focusChanged = false) {
    const previousMode = mainScreenState.viewport.mode;
    const previousId = mainScreenState.viewport.wideColumnId;
    if (mainScreenState.presentation.mode !== PRESENTATION_NORMAL) {
        presentationController.clear();
    }
    contextualViewport.select(column, {
        source: wideStepDirection ? FocusSource.DIRECTIONAL :
            FocusSource.PROGRAMMATIC,
        changedFocus: Boolean(wideStepDirection) || focusChanged,
        direction: wideStepDirection,
        viewportMoved: oldScrollOffsetX !== newScrollOffsetX,
    });
    relayout(reason, { oldScrollOffsetX, newScrollOffsetX });
    return previousMode !== mainScreenState.viewport.mode ||
        previousId !== mainScreenState.viewport.wideColumnId;
}

function setPresentationMode(windowUuid, mode, reason) {
    if (continuousLayout) {
        const column = mainScreenState.columns.find(c => normalizeWindowUuid(c.window.internalId) === windowUuid);
        if (!column || column.window.fullScreen) return false;
        if (mode === PRESENTATION_WIDE) return continuousLayout.ready() && continuousLayout.controller.center(column.window);
        return continuousLayout.exclusive("v2-presentation", () => {
            const state = stateFor(column.window);
            state.internalChange = true;
            try { column.window.setMaximize(false, false); } finally { state.internalChange = false; }
            columnStore.focusColumn(column);
            mainScreenState.presentation = { mode, windowUuid: mode === PRESENTATION_MAXIMIZED ? windowUuid : null };
            setLayoutMode(state, mode === PRESENTATION_MAXIMIZED ? MAXIMIZE_MODE : NORMAL_MODE);
            if (mode === PRESENTATION_MAXIMIZED) {
                mainScreenState.columns.forEach(c => parkingManager.setVisibility(c.window, c === column));
                applyLayoutGeometry(column.window, state, MAXIMIZE_MODE, reason);
            }
            commitRuntimeState(reason);
        });
    }
    contextualWideCoordinator.cancelExit();
    return presentationController.setMode(windowUuid, mode, reason);
}

function addColumnAt(window, insertionIndex, reason) {
    if (!workspaceMountController.canUseActiveWorkspace() ||
            !scrollEligible(window) || columnIndexForWindow(window) >= 0) return null;
    const windowState = stateFor(window);
    const column = columnStore.insertWindow(
        window,
        insertionIndex,
        COLUMN_WIDTH_HALF
    );
    if (!column) return null;
    const preference = windowState.workspaceColumnPreference;
    if (preference) {
        column.widthMode = continuousLayout && preference.widthV2 ? preference.widthV2.widthMode : normalizeColumnWidthMode(preference.widthMode);
        if (preference.widthV2) column.widthV2 = preference.widthV2;
        column.previousNonFullWidthMode = normalizePreviousNonFullWidthMode(
            continuousLayout && preference.widthV2 ? preference.widthV2.previousNonFullWidthMode : preference.previousNonFullWidthMode,
            column.widthMode, Boolean(continuousLayout));
        column.persistentWide = preference.persistentWide;
        windowState.workspaceColumnPreference = null;
    }
    windowState.managedByScrollLayout = true;
    windowState.workspaceOwnerId = workspaceMembership.ownerId(window);
    windowState.columnId = column.id;
    const index = columnStore.indexOf(column);
    debug(`[cc-scroll] ADD_WINDOW caption=${window.caption}` +
        ` column=${column.id} index=${index} width=${column.widthMode}` +
        ` reason=${reason}`);
    return column;
}

function prepareInitialColumn(window) {
    const windowState = stateFor(window);
    const tileMode = detectQuickTileMode(window);
    const hadLayoutOverride = isLayoutMode(windowState.layoutMode) ||
        Number(window.maximizeMode) === FULL_MAXIMIZE_MODE || isTileMode(tileMode);
    if (!hadLayoutOverride) return true;

    windowState.internalChange = true;
    try {
        if (isTileMode(tileMode)) {
            /*
             * KWin exposes no writable tile property. A maximize -> restore
             * round trip is the verified public operation that detaches the
             * native Quick Tile object before scroll-layout adoption.
             */
            window.setMaximize(true, true);
            window.setMaximize(false, false);
        } else {
            window.setMaximize(false, false);
        }
        clearLayoutState(windowState);
        windowState.layoutModeBeforeFullscreen = NORMAL_MODE;
        windowState.temporarilyMaximized = false;
        windowState.temporarilyQuickTiled = false;
    } finally {
        windowState.internalChange = false;
    }

    const detached = detectQuickTileMode(window) === NORMAL_MODE &&
        Number(window.maximizeMode) !== FULL_MAXIMIZE_MODE;
    if (!detached) {
        warn(`[cc-scroll] failed to detach startup layout caption=${window.caption}` +
            ` tile=${detectQuickTileMode(window)} maximize=${window.maximizeMode}`);
    } else {
        debug(`[cc-scroll] ADOPT_STARTUP_OVERRIDE caption=${window.caption}` +
            ` previous=${tileMode}`);
    }
    return detached;
}

function removeColumn(window, reason, activateSuccessor = true) {
    if (continuousLayout) {
        const remove = () => {
            workspaceSnapshots.removeWindow(normalizeWindowUuid(window.internalId));
            const column = mainScreenState.columns[columnStore.indexOfWindow(window)];
            if (!column) return;
            if (reason !== "window-closed") stateFor(window).workspaceColumnPreference = workspaceColumnPreference(
                column, normalizeWindowUuid(window.internalId), true);
            if (reason !== "window-closed") releaseParkingOwnership(window, reason,
                window.output === mainScreenState.targetOutput && !window.fullScreen);
            columnStore.removeWindow(window);
            const state = states.get(window);
            if (state) { state.managedByScrollLayout = false; state.columnId = null; }
            if (mainScreenState.presentation.windowUuid === normalizeWindowUuid(window.internalId)) clearPresentationState();
            recomputeLogicalLayout(); clampScrollOffset();
            if (workspaceTransferController && workspaceTransferController.deferLayout()) return;
            if (!continuousLayout.inExclusive) continuousLayout.sync(reason);
            if (workspaceMountController.canUseActiveWorkspace()) commitRuntimeState(reason);
        };
        if (reason === "window-closed" || continuousLayout.inExclusive) remove();
        else continuousLayout.exclusive(`remove:${normalizeWindowUuid(window.internalId)}`, remove);
        return;
    }
    const previousSingleLayout = captureSingleColumnLayout(mainScreenState, runtimeConfig.alwaysCenterSingleColumn);
    workspaceSnapshots.removeWindow(normalizeWindowUuid(window.internalId));
    contextualWideCoordinator.cancelForWindow(window);
    const index = columnIndexForWindow(window);
    if (index < 0) return;
    cancelPendingDockScroll(reason);
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    const focusedColumn = columnStore.focusedColumn();
    const removedColumn = mainScreenState.columns[index];
    if (reason !== "window-closed") {
        const needsAccessibleGeometry = reason === "shortcut-toggle-floating" ||
            reason === "interactive-move-resize" || reason === "window-desktops-changed";
        releaseParkingOwnership(
            removedColumn.window,
            reason,
            needsAccessibleGeometry,
            index
        );
    }
    const removedGeometry = removedColumn.window.frameGeometry;
    const removedWasVisibleLeft = mainScreenState.safeRect &&
        isFullyVisibleInSafeRect(removedGeometry) &&
        removedGeometry.x + removedGeometry.width / 2 <
            mainScreenState.safeRect.x + mainScreenState.safeRect.width / 2;
    if (mainScreenState.presentation.windowUuid ===
            normalizeWindowUuid(removedColumn.window.internalId) ||
            mainScreenState.viewport.wideColumnId === removedColumn.id) {
        clearPresentationState();
    }
    const removedFocusedColumn = focusedColumn === removedColumn;
    columnStore.removeWindow(window);
    const windowState = states.get(window);
    if (windowState) {
        windowState.managedByScrollLayout = false;
        windowState.columnId = null;
        adoptionController.transition(
            window,
            windowState,
            windowState.floating ? ADOPTION_FLOATING : ADOPTION_UNTRACKED,
            `${reason}-removed`
        );
    }
    // Removal still clears ownership during a switch; activation and publication
    // wait for the final mount so a closing old window cannot switch KDE back.
    focusRingController.publish();
    if (!workspaceMountController.canUseActiveWorkspace()) return;
    if (!mainScreenState.columns.length) {
        mainScreenState.scrollOffsetX = 0;
        if (previousSingleLayout) {
            motionPlanCommitGate.cancel();
            scrollPlanCommitGate.cancel();
        }
        commitRuntimeState(reason);
        return;
    }

    recomputeLogicalLayout();
    const nextFocusedColumn = columnStore.focusedColumn();
    if (removedWasVisibleLeft && index > 0) {
        /* Keep the existing right-hand window fixed in its right slot. The
         * predecessor becomes the new left-hand window instead of shifting
         * the entire visible pair left after the left window closes. */
        mainScreenState.scrollOffsetX = oldScrollOffsetX -
            removedColumn.pixelWidth - mainScreenState.innerGap;
        clampScrollOffset();
    } else {
        ensureColumnVisible(nextFocusedColumn);
    }
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const publishedBeforeArm = relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX,
    }, undefined, previousSingleLayout);

    if (activateSuccessor && removedFocusedColumn && nextFocusedColumn &&
            workspace.activeWindow !== nextFocusedColumn.window) {
        if (runtimeConfig.alwaysCenterSingleColumn) activateColumnWhenReady(nextFocusedColumn.window);
        else workspace.activeWindow = nextFocusedColumn.window;
    }
    debug(`[cc-scroll] REMOVE_WINDOW column=${removedColumn.id}` +
        ` index=${index} focused=${removedFocusedColumn}` +
        ` next=${nextFocusedColumn ? nextFocusedColumn.id : "<none>"}` +
        ` reason=${reason}`);
    if (!publishedBeforeArm) commitRuntimeState(reason);
}

function initializeScrollLayout(previousState) {
    refreshMainScreenState();
    startupLayout.load(previousState);
    const mounted = workspaceMountController.initialize(previousState);
    if (mounted) workspace.windowList().forEach(window => {
        if (workspaceMembership.ownerId(window) !== mainScreenState.activeWorkspaceId) {
            workspaceTransferController.onWindowAdded(window);
        }
    });
    return mounted;
}

function adoptNewWindowAsColumn(window, reason, focusNew = true) {
    if (!scrollLayoutInitialized || !window) return false;
    refreshMainScreenState();
    if (!mainScreenState.enabled || !mainScreenState.targetOutput ||
            window.output !== mainScreenState.targetOutput ||
            !scrollEligible(window) || window.fullScreen ||
            columnIndexForWindow(window) >= 0) {
        return false;
    }

    const previousSingleLayout = captureSingleColumnLayout(mainScreenState, runtimeConfig.alwaysCenterSingleColumn);
    cancelPendingDockScroll(reason);
    const windowState = stateFor(window);
    if (windowState.floating || isLayoutMode(windowState.layoutMode) ||
            Number(window.maximizeMode) === FULL_MAXIMIZE_MODE ||
            isTileMode(detectQuickTileMode(window))) {
        return false;
    }

    if (focusNew && (mainScreenState.presentation.mode !== PRESENTATION_NORMAL ||
            mainScreenState.viewport.mode !== ViewportMode.PAIR)) {
        clearPresentationState();
    }

    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    const focusedIndex = mainScreenState.columns.length
        ? Math.max(0, Math.min(
            mainScreenState.focusedColumnIndex,
            mainScreenState.columns.length - 1
        ))
        : -1;
    const focusedColumn = focusedIndex >= 0
        ? mainScreenState.columns[focusedIndex]
        : null;
    const savedIndex = startupLayout.insertionIndex(
        window, mainScreenState.columns);
    const insertionIndex = savedIndex >= 0 ? savedIndex : focusNew
        ? focusedIndex + 1 : mainScreenState.columns.length;
    if (continuousLayout) parkingManager.setVisibility(window, false);
    const column = addColumnAt(window, insertionIndex, reason);
    if (!column) return false;

    if (focusNew || !focusedColumn) columnStore.focusColumn(column);
    else columnStore.focusColumn(focusedColumn);
    recomputeLogicalLayout();
    if (focusNew || !focusedColumn) ensureColumnVisible(column);
    else if (classifySingleColumnTransition(previousSingleLayout, mainScreenState) === "reindex")
        ensureColumnVisible(focusedColumn);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const publishedBeforeArm = relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX,
    }, undefined, previousSingleLayout);
    debug(`[cc-scroll] ADOPT_NEW index=${insertionIndex}` +
        ` focused=${focusNew} caption=${window.caption}`);
    if (!publishedBeforeArm) commitRuntimeState(reason);
    return true;
}

function settleAdoptionGeometry(window, index, reason) {
    if (continuousLayout) {
        const column = mainScreenState.columns[index];
        return { column, expected: projectedRectForColumn(column),
            settled: !continuousLayout.coordinator.gate.pending && !continuousLayout.coordinator.bootstrap &&
                sameRect(window.frameGeometry, projectedRectForColumn(column)) };
    }
    const column = mainScreenState.columns[index];
    if (runtimeConfig.alwaysCenterSingleColumn &&
            ((scrollPlanCommitGate.pending && scrollPlanCommitGate.pending.plan.windows.some(item => item.column === column)) ||
             (deferredScrollParking.pending && scrollPlanCommitGate.activeEpoch === deferredScrollParking.pending.epoch))) {
        // Adoption settling cannot cancel its own pending arm or the shared
        // Spring just because the real target frame is already configured.
        const expected = projectedRectForColumn(column);
        return { column, expected, settled: !scrollPlanCommitGate.pending && sameRect(window.frameGeometry, expected) };
    }
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    columnStore.focusIndex(index);
    recomputeLogicalLayout();
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayoutFocusedColumnTransition(
        column,
        `${reason}-settle`,
        oldScrollOffsetX,
        newScrollOffsetX
    );

    const expected = projectedRectForColumn(column);
    return {
        column,
        expected,
        settled: isFullyVisibleInSafeRect(expected) &&
            sameRect(window.frameGeometry, expected),
    };
}

function advanceWindowAdoption(window, reason) {
    return adoptionController.advance(window, reason);
}

function beginWindowAdoption(window, origin) {
    return adoptionController.begin(window, origin);
}

function onWindowActivatedForScrollLayout(window) {
    if (!window || !workspaceMountController.canUseActiveWorkspace()) return;
    if (layoutTransaction.isActive()) {
        debug(`[cc-stability] SUPPRESS activation epoch=${layoutTransaction.currentEpoch()}` +
            ` caption=${window.caption}`);
        return;
    }
    if (windowPolicy.classify(window).kind ===
            WindowDisposition.POLICY_FLOATING) {
        adoptionController.onActivated(window);
        return;
    }
    if (window !== (columnStore.focusedColumn() || {}).window) {
        contextualViewport.cancelReveal();
    }
    if (floatingController.redirectActivation(window)) return;
    adoptionController.onActivated(window);

    const index = columnIndexForWindow(window);
    if (index < 0) return;
    if (dockScrollController && dockScrollController.hasPending()) {
        cancelPendingDockScroll("window-activated");
    }
    const column = mainScreenState.columns[index];
    if (continuousLayout) {
        if (mainScreenState.presentation.mode === PRESENTATION_MAXIMIZED &&
                mainScreenState.presentation.windowUuid !== normalizeWindowUuid(window.internalId))
            return setPresentationMode(normalizeWindowUuid(window.internalId), PRESENTATION_NORMAL, "activation-exit-maximized");
        return continuousLayout.ready() && continuousLayout.controller.focusWindow(window, "activation");
    }
    const windowUuid = normalizeWindowUuid(window.internalId);
    const presentationMatches = (mainScreenState.presentation.mode ===
            PRESENTATION_MAXIMIZED &&
            mainScreenState.presentation.windowUuid === windowUuid) ||
        (mainScreenState.presentation.mode ===
        PRESENTATION_NORMAL && (mainScreenState.viewport.mode === ViewportMode.PAIR ||
        mainScreenState.viewport.wideColumnId === column.id));
    if (index === mainScreenState.focusedColumnIndex && presentationMatches) return;
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    columnStore.focusIndex(index);
    recomputeLogicalLayout();
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        "window-activated",
        oldScrollOffsetX,
        newScrollOffsetX,
        0,
        true
    );
    debug(`[cc-scroll] FOCUS_ACTIVE index=${index} caption=${window.caption}`);
    if (presentationChanged) commitRuntimeState("focus-selected-presentation");
    else publishRuntimeState("window-activated");
}

function focusRelativeColumn(delta) {
    if (continuousLayout) return continuousLayout.ready() && continuousLayout.controller.focusRelative(delta);
    const columns = mainScreenState.columns;
    if (!mainScreenState.enabled || !columns.length) return;
    cancelPendingDockScroll(delta < 0 ? "focus-previous" : "focus-next", true);
    const activeIndex = columnIndexForWindow(workspace.activeWindow);
    if (activeIndex >= 0 && !contextualWideCoordinator.isActivationDeferred() &&
            !scrollPlanCommitGate.pending) {
        columnStore.focusIndex(activeIndex);
    }
    const oldIndex = columnStore.focusedIndex();
    const focused = columns[oldIndex];
    if (focused && !focused.window.fullScreen &&
            mainScreenState.presentation.mode === PRESENTATION_NORMAL &&
            contextualViewport.enterFocusedWide(focused, delta)) {
        const offset = mainScreenState.scrollOffsetX;
        relayout("directional-focused-to-wide", {
            oldScrollOffsetX: offset,
            newScrollOffsetX: offset,
        });
        activateColumnWhenReady(focused.window);
        commitRuntimeState("directional-focused-to-wide");
        return;
    }
    contextualViewport.cancelReveal();
    const nextIndex = Math.max(0, Math.min(columns.length - 1, oldIndex + delta));
    if (nextIndex === oldIndex) return;

    columnStore.focusIndex(nextIndex);
    const column = columns[nextIndex];
    recomputeLogicalLayout();
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        delta < 0 ? "focus-previous" : "focus-next",
        oldScrollOffsetX,
        newScrollOffsetX,
        delta
    );
    /*
     * Never activate a window while its real geometry is still in the
     * off-screen parking area. KWin may compose one activation frame before
     * the following geometry transaction, which can surface on an adjacent
     * output. Commit the target's primary-screen slot first, then focus it.
     */
    activateColumnWhenReady(column.window);
    debug(`[cc-scroll] FOCUS from=${oldIndex} to=${nextIndex}`);
    if (presentationChanged) {
        commitRuntimeState(delta < 0 ? "focus-previous-presentation" :
            "focus-next-presentation");
    } else {
        publishRuntimeState(delta < 0 ? "focus-previous" : "focus-next");
    }
}

function toggleFocusWide(window) {
    if (continuousLayout) return continuousLayout.ready() && continuousLayout.controller.center(window);
    const index = columnIndexForWindow(window);
    if (!window || index < 0 || window.output !== mainScreenState.targetOutput ||
            window.fullScreen) return;
    const windowUuid = normalizeWindowUuid(window.internalId);
    const alreadyWide = mainScreenState.viewport.mode === ViewportMode.WIDE_FOCUS &&
        mainScreenState.viewport.wideColumnId === mainScreenState.columns[index].id;
    setPresentationMode(
        windowUuid,
        alreadyWide ? PRESENTATION_NORMAL : PRESENTATION_WIDE,
        alreadyWide ? "shortcut-wide-to-normal" : "shortcut-focus-wide"
    );
}

function moveFocusedColumn(delta) {
    if (continuousLayout) return continuousLayout.ready() && continuousLayout.controller.moveFocused(delta);
    return reorderController.moveFocused(delta);
}

function toggleFloating(window) {
    if (continuousLayout) return v2Departure(window, "floating", () => floatingController.toggle(window));
    return floatingController.toggle(window);
}

function rectForLayout(mode, safeRect, requestedInnerGap) {
    return quickTileRect(mode, safeRect, requestedInnerGap, MAXIMIZE_MODE);
}

function detectQuickTileMode(window) {
    const relative = window.tile ? window.tile.relativeGeometry : null;
    if (!relative) return NORMAL_MODE;
    const key = [relative.x, relative.y, relative.width, relative.height]
        .map(value => Number(value).toFixed(2)).join(",");
    return ({
        "0.00,0.00,0.50,1.00": "left",
        "0.50,0.00,0.50,1.00": "right",
        "0.00,0.00,1.00,0.50": "top",
        "0.00,0.50,1.00,0.50": "bottom",
        "0.00,0.00,0.50,0.50": "topLeft",
        "0.50,0.00,0.50,0.50": "topRight",
        "0.00,0.50,0.50,0.50": "bottomLeft",
        "0.50,0.50,0.50,0.50": "bottomRight",
    })[key] || "unsupported";
}

function isTileMode(mode) {
    return mode !== NORMAL_MODE && mode !== MAXIMIZE_MODE && mode !== "unsupported";
}

function isLayoutMode(mode) {
    return mode === MAXIMIZE_MODE || isTileMode(mode);
}

function eligible(window) {
    return layoutEligibility.eligible(window);
}

function onManagedOutput(window) {
    return Boolean(window && profileForOutput(window.output));
}

function createWindowState(window) {
    const currentOpacity = Number(window.opacity);
    const inheritedParkingHidden = looksLikeInheritedParking(window);
    const currentGeometry = rectCopy(window.frameGeometry);
    return {
        pseudoMaximized: false,
        layoutMode: NORMAL_MODE,
        layoutModeBeforeFullscreen: NORMAL_MODE,
        restoreGeometry: null,
        restoreOutput: null,
        pendingAction: null,
        internalChange: false,
        interactiveMoveResize: false,
        managedByScrollLayout: false,
        columnId: null,
        workspaceOwnerId: workspaceMembership.ownerId(window),
        workspaceColumnPreference: null,
        floating: false,
        adoptionPhase: ADOPTION_UNTRACKED,
        adoptionOrigin: "",
        adoptionLastEvent: "",
        adoptionAttempts: 0,
        temporarilyMaximized: false,
        temporarilyQuickTiled: false,
        scrollOriginalOpacity: currentOpacity > 0 ? currentOpacity : 1,
        scrollVisuallyHidden: inheritedParkingHidden,
        scrollParkedByScript: inheritedParkingHidden,
        scrollParkingMinimized: inheritedParkingHidden && window.minimized,
        scrollLastVisibleGeometry: inheritedParkingHidden
            ? null
            : currentGeometry,
        scrollLastRequestedGeometry: null,
    };
}

function stateFor(window) {
    return states.ensure(window);
}

function setLayoutMode(state, mode) {
    state.layoutMode = mode;
    state.pseudoMaximized = mode === MAXIMIZE_MODE;
}

function clearLayoutState(state) {
    setLayoutMode(state, NORMAL_MODE);
    state.restoreGeometry = null;
    state.restoreOutput = null;
    state.pendingAction = null;
}

function rememberRestore(window, state, geometry) {
    if (state.restoreGeometry) return;
    state.restoreGeometry = rectCopy(geometry);
    state.restoreOutput = window.output;
    debug(`CAPTURE ${window.caption} restore=${rectText(state.restoreGeometry)}`);
}

function translateRestoreGeometry(state, newOutput) {
    if (!state.restoreGeometry || !newOutput) return;
    if (!state.restoreOutput) {
        state.restoreOutput = newOutput;
        return;
    }
    if (state.restoreOutput === newOutput) return;
    const oldScreen = state.restoreOutput.geometry;
    const newScreen = newOutput.geometry;
    state.restoreGeometry.x += newScreen.x - oldScreen.x;
    state.restoreGeometry.y += newScreen.y - oldScreen.y;
    state.restoreOutput = newOutput;
    debug(`TRANSLATE restore=${rectText(state.restoreGeometry)} output=${newOutput.name}`);
}

function applyLayoutGeometry(window, state, mode, reason) {
    const profile = profileForOutput(window.output);
    if (!profile || !eligible(window)) return false;
    const target = rectForLayout(mode, safeRectFor(window.output), profile.inner);
    if (!target) return false;
    state.internalChange = true;
    try {
        if (mode === MAXIMIZE_MODE) window.setMaximize(false, false);
        window.frameGeometry = target;
        setLayoutMode(state, mode);
        state.pendingAction = null;
    } finally {
        state.internalChange = false;
    }
    debug(`APPLY ${window.caption} reason=${reason} mode=${mode}` +
        ` geometry=${rectText(window.frameGeometry)} expected=${rectText(target)}` +
        ` restore=${rectText(state.restoreGeometry)}`);
    return sameRect(window.frameGeometry, target);
}

function leavePseudoMaximize(window, state, reason) {
    const restore = rectCopy(state.restoreGeometry);
    state.internalChange = true;
    try {
        window.setMaximize(false, false);
        if (restore) window.frameGeometry = restore;
        clearLayoutState(state);
    } finally {
        state.internalChange = false;
    }
    debug(`RESTORE ${window.caption} reason=${reason} geometry=${rectText(window.frameGeometry)}`);
}

function onPanelGeometryChanged(window) {
    if (window.dock && continuousLayout && scrollLayoutInitialized) relayout("v2-panel-area-changed");
}

function onFrameGeometryChanged(window, oldGeometry) {
    if (window.dock) return onPanelGeometryChanged(window);
    if (continuousLayout && columnStore.indexOfWindow(window) >= 0) return;
    const state = stateFor(window);
    if (!layoutEligibility.isWorkspaceReady(window)) return;
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    if (contextualWideCoordinator.onTargetGeometryChanged(window)) return;
    if (!windowPolicy.canJoinColumn(window)) return;
    if (window.output === mainScreenState.targetOutput && window.active &&
            state.adoptionPhase !== ADOPTION_UNTRACKED &&
            state.adoptionPhase !== ADOPTION_MANAGED &&
            state.adoptionPhase !== ADOPTION_FLOATING &&
            state.adoptionPhase !== ADOPTION_POLICY_FLOATING &&
            state.adoptionPhase !== ADOPTION_IGNORED) {
        adoptionController.onGeometryChanged(window);
        return;
    }
    const detectedMode = detectQuickTileMode(window);
    if (state.layoutMode === NORMAL_MODE) {
        if (isTileMode(detectedMode)) rememberRestore(window, state, oldGeometry);
        return;
    }

    /*
     * Plasma edit mode changes panel struts and KWin silently reapplies native
     * Quick Tile geometry without tileChanged/quickTileModeChanged. Correct
     * only that recognizable native-size reset; this is not a general geometry
     * enforcement path and interactive move/resize is excluded above.
     */
    if (isTileMode(state.layoutMode) && state.layoutMode === detectedMode &&
            onManagedOutput(window) && window.tile &&
            sameSizeNear(window.frameGeometry, window.tile.absoluteGeometryInScreen)) {
        const profile = profileForOutput(window.output);
        const expected = rectForLayout(
            state.layoutMode,
            safeRectFor(window.output),
            profile.inner
        );
        if (!sameRect(window.frameGeometry, expected)) {
            applyLayoutGeometry(window, state, state.layoutMode, "native-tile-geometry-reset");
        }
    }
}

function applyDetectedTile(window, signalName) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize ||
            !eligible(window)) return;
    const mode = detectQuickTileMode(window);
    const profile = profileForOutput(window.output);
    if (!profile) {
        if (isTileMode(mode)) {
            setLayoutMode(state, mode);
            debug(`NATIVE ${window.caption} mode=${mode} output=${window.output.name}`);
        } else if (mode === NORMAL_MODE && isTileMode(state.layoutMode)) {
            clearLayoutState(state);
        }
        return;
    }
    if (isTileMode(mode)) {
        applyLayoutGeometry(window, state, mode, signalName);
        return;
    }
    if (mode === NORMAL_MODE && isTileMode(state.layoutMode)) {
        if (state.pendingAction === "enterMaximize") return;
        const restore = rectCopy(state.restoreGeometry);
        state.internalChange = true;
        try {
            if (restore) window.frameGeometry = restore;
            clearLayoutState(state);
        } finally {
            state.internalChange = false;
        }
        debug(`RESTORE ${window.caption} reason=${signalName}-untile` +
            ` geometry=${rectText(window.frameGeometry)}`);
        advanceWindowAdoption(window, `${signalName}-untile`);
    }
}

function onMaximizedAboutToChange(window, mode) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize ||
            !eligible(window)) return;
    const onTarget = onManagedOutput(window);
    const managedColumn = columnIndexForWindow(window) >= 0 &&
        window.output === mainScreenState.targetOutput;
    if (Number(mode) === FULL_MAXIMIZE_MODE) {
        if (!managedColumn && state.layoutMode === NORMAL_MODE) {
            rememberRestore(window, state, window.frameGeometry);
        }
        if (onTarget && state.layoutMode === MAXIMIZE_MODE) {
            state.pendingAction = "leaveMaximize";
        } else {
            state.pendingAction = onTarget ? "enterMaximize" : "nativeMaximize";
        }
    } else if (!onTarget && state.layoutMode === MAXIMIZE_MODE) {
        state.pendingAction = "nativeRestore";
    }
}

function onMaximizedChanged(window) {
    const state = stateFor(window);
    if (state.internalChange || !state.pendingAction) return;
    if (!eligible(window)) {
        state.pendingAction = null;
        return;
    }
    const action = state.pendingAction;
    state.pendingAction = null;
    const managedColumn = columnIndexForWindow(window) >= 0 &&
        window.output === mainScreenState.targetOutput;
    if (managedColumn && action === "enterMaximize") {
        setPresentationMode(
            normalizeWindowUuid(window.internalId),
            PRESENTATION_MAXIMIZED,
            "native-maximize"
        );
        return;
    }
    if (continuousLayout && managedColumn && action === "leaveMaximize") {
        setPresentationMode(normalizeWindowUuid(window.internalId), PRESENTATION_NORMAL, "native-restore");
        return;
    }
    if (managedColumn && action === "leaveMaximize") {
        presentationController.restoreFromMaximize(
            normalizeWindowUuid(window.internalId),
            "native-restore"
        );
        return;
    }
    if (action === "enterMaximize") {
        applyLayoutGeometry(window, state, MAXIMIZE_MODE, "maximize-request");
    } else if (action === "leaveMaximize") {
        leavePseudoMaximize(window, state, "maximize-toggle");
    } else if (action === "nativeMaximize") {
        setLayoutMode(state, MAXIMIZE_MODE);
        debug(`NATIVE ${window.caption} mode=maximize output=${window.output.name}`);
    } else if (action === "nativeRestore") {
        clearLayoutState(state);
    }
    advanceWindowAdoption(window, `maximize-${action}`);
}

function onOutputChanged(window) {
    if (window.dock) return onPanelGeometryChanged(window);
    if (continuousLayout && !continuousLayout.inExclusive) return v2Departure(window, "output", () => onOutputChanged(window));
    if (!windowPolicy.canJoinColumn(window)) {
        adoptionController.onPolicyChanged(window, "output-policy-changed");
        return false;
    }
    contextualWideCoordinator.cancelForWindow(window);
    return outputController.onOutputChanged(window);
}

function onFullScreenChanged(window) {
    if (continuousLayout && columnStore.indexOfWindow(window) >= 0) return v2Departure(window, "fullscreen", () => {
        // KDE owns the fullscreen frame. Never restore a parked frame over it.
        mainScreenState.columns.forEach(c => parkingManager.release(c.window, "v2-fullscreen", !c.window.fullScreen));
        focusRingController.publish();
    });
    if (!windowPolicy.canJoinColumn(window)) return false;
    return fullscreenController.onFullscreenChanged(window);
}

function onInteractiveMoveResizeStarted(window) {
    if (continuousLayout && !continuousLayout.inExclusive) return v2Departure(window, "interactive", () => onInteractiveMoveResizeStarted(window));
    const state = stateFor(window);
    if (floatingController.onInteractiveMoveResize(window)) return;
    if (state.internalChange || !isLayoutMode(state.layoutMode)) return;
    state.interactiveMoveResize = true;
    clearLayoutState(state);
    debug(`CLEAR ${window.caption} reason=interactive-move-resize`);
}

function onWindowPolicyChanged(window, reason) {
    if (continuousLayout && !continuousLayout.inExclusive && columnStore.indexOfWindow(window) >= 0)
        return v2Departure(window, reason, () => onWindowPolicyChanged(window, reason));
    dynamicWorkspaceController.request();
    workspaceRecycleController.request();
    workspaceMountController.onWindowMembershipChanged(window);
    const state = stateFor(window);
    if (!windowPolicy.managedLayoutEligible(window) &&
            isLayoutMode(state.layoutMode)) {
        clearLayoutState(state);
    }
    return adoptionController.onPolicyChanged(window, reason);
}

function setupWindow(window) {
    if (!window || states.has(window)) return;
    const state = stateFor(window);
    const connect = (signal, handler) => app.lifecycle.connect(signal, handler, window);
    connect(window.frameGeometryChanged, oldGeometry =>
        onFrameGeometryChanged(window, oldGeometry));
    connect(window.tileChanged, () => applyDetectedTile(window, "tileChanged"));
    connect(window.quickTileModeChanged, () => applyDetectedTile(window, "quickTileModeChanged"));
    connect(window.maximizedAboutToChange, mode => onMaximizedAboutToChange(window, mode));
    connect(window.maximizedChanged, () => onMaximizedChanged(window));
    connect(window.outputChanged, () => {
        onOutputChanged(window);
        dynamicWorkspaceController.request();
        workspaceRecycleController.request();
    });
    if (window.desktopsChanged) connect(window.desktopsChanged, () => {
        if (window.dock) return onPanelGeometryChanged(window);
        if (continuousLayout) v2Departure(window, "membership", () => workspaceTransferController.onMembershipChanged(window));
        else workspaceTransferController.onMembershipChanged(window);
        dynamicWorkspaceController.request();
        workspaceRecycleController.request();
    });
    if (window.dock) {
        connect(window.hiddenChanged, () => onPanelGeometryChanged(window));
        connect(window.minimizedChanged, () => onPanelGeometryChanged(window));
    }
    connect(window.fullScreenChanged, () => onFullScreenChanged(window));
    if (window.skipTaskbarChanged) connect(window.skipTaskbarChanged, () =>
        onWindowPolicyChanged(window, "skip-taskbar-changed"));
    if (window.transientChanged) connect(window.transientChanged, () =>
        onWindowPolicyChanged(window, "transient-changed"));
    if (window.modalChanged) connect(window.modalChanged, () =>
        onWindowPolicyChanged(window, "modal-changed"));
    connect(window.activeChanged, () => {
        if (window.active && !layoutTransaction.isActive()) {
            adoptionController.onActivated(window, "active-changed");
        }
    });
    connect(window.readyForPaintingChanged, () => {
        adoptionController.onReady(window);
    });
    if (window.windowShown) {
        connect(window.windowShown, () => {
            adoptionController.onReady(window, "window-shown");
        });
    }
    connect(window.interactiveMoveResizeStarted, () => onInteractiveMoveResizeStarted(window));
    connect(window.interactiveMoveResizeFinished, () => {
        stateFor(window).interactiveMoveResize = false;
    });
    connect(window.closed, () => {
        app.lifecycle.disconnectOwner(window);
        recovery.forgetWindow(window);
        const wasMounted = columnIndexForWindow(window) >= 0;
        workspaceTransferController.onWindowClosed(window);
        removeColumn(window, "window-closed");
        floatingController.onWindowClosed(window);
        states.delete(window);
        onPanelGeometryChanged(window);
        if (!wasMounted) workspaceTransferController.commitClosed();
        dynamicWorkspaceController.request();
        workspaceRecycleController.request();
    });

    if (!eligible(window)) return;
    if (Number(window.maximizeMode) === FULL_MAXIMIZE_MODE) {
        setLayoutMode(state, MAXIMIZE_MODE);
        if (onManagedOutput(window)) {
            applyLayoutGeometry(window, state, MAXIMIZE_MODE, "startup-adopt-maximize");
        }
        return;
    }
    const tileMode = detectQuickTileMode(window);
    if (isTileMode(tileMode)) {
        setLayoutMode(state, tileMode);
        if (onManagedOutput(window)) {
            applyLayoutGeometry(window, state, tileMode, "startup-adopt-tile");
        }
    }
}

function reapplyManagedLayouts(reason) {
    states.forEach((state, window) => {
        if (!state.internalChange && !state.interactiveMoveResize && eligible(window) &&
                !state.managedByScrollLayout && onManagedOutput(window)) {
            // An inactive secondary desktop may have been skipped at startup.
            const profile = profileForOutput(window.output);
            if (profile.role === "secondary" && state.layoutMode === NORMAL_MODE &&
                    Number(window.maximizeMode) === FULL_MAXIMIZE_MODE) {
                setLayoutMode(state, MAXIMIZE_MODE);
            }
            if (!isLayoutMode(state.layoutMode)) return;
            applyLayoutGeometry(window, state, state.layoutMode, reason);
        }
    });
}

function connectManagedGeometry() {
    managedOutputs().forEach(output => {
        if (connectedManagedOutputs.has(output)) return;
        connectedManagedOutputs.add(output);
        app.lifecycle.connect(output.geometryChanged, () => {
            if (profileForOutput(output)) {
                reapplyManagedLayouts("managed-output-geometry-changed");
                relayout("managed-output-geometry-changed");
            }
        }, output);
    });
}

function onScreensChanged() {
    if (continuousLayout && !continuousLayout.inExclusive) return continuousLayout.exclusive("screens-changed", onScreensChanged);
    connectedManagedOutputs.forEach(output => app.lifecycle.disconnectOwner(output));
    connectedManagedOutputs = new Set();
    refreshMainScreenState();
    if (continuousLayout) {
        mainScreenState.columns.slice().forEach(column => {
            if (column.window.output !== mainScreenState.targetOutput) removeColumn(column.window, "output-left-primary", false);
        });
        workspaceSwitchController.onDesktopChanged(null, null, mainScreenState.targetOutput);
    }
    connectManagedGeometry();
    reapplyManagedLayouts("screens-changed");
    relayout("screens-changed");
    focusRingController.publish();
    dynamicWorkspaceController.request();
    workspaceRecycleController.request();
}

const shortcuts = createShortcutCatalog({
    workspacePrevious: () => workspaceSwitchController.previous(),
    workspaceNext: () => workspaceSwitchController.next(),
    workspaceFocus: number => workspaceSwitchController.focusNumber(number),
    moveWorkspacePrevious: () => workspaceMoveController.movePrevious(),
    moveWorkspaceNext: () => workspaceMoveController.moveNext(),
    moveWorkspaceNumber: number => workspaceMoveController.moveNumber(number),
    focusPrevious: () => runWorkspaceAction(() => focusRelativeColumn(-1)),
    focusNext: () => runWorkspaceAction(() => focusRelativeColumn(1)),
    cycleWidth: () => runWorkspaceAction(() => columnWidthController.cycle()),
    toggleFull: () => runWorkspaceAction(() => columnWidthController.toggleFull()),
    toggleWide: () => runWorkspaceAction(() => toggleFocusWide(workspace.activeWindow)),
    moveLeft: () => runWorkspaceAction(() => moveFocusedColumn(-1)),
    moveRight: () => runWorkspaceAction(() => moveFocusedColumn(1)),
    toggleFloating: () => runWorkspaceAction(() => toggleFloating(workspace.activeWindow)),
    publishFocusRingState: () => focusRingController.publish(true),
    publishRuntimeState: () => publishRuntimeState("bridge-request"),
    applyRuntimeCommand: applyPendingRuntimeCommand,
    emergencyRestore: () => emergencyRestoreAllWindows("external-unload"),
});

const app = new CCNiri({
    controllers: controllerComposition,
    lifecycle: {
        workspace,
        setupWindow,
        onWindowAdded: window => {
            setupWindow(window);
            adoptionController.onWindowAdded(window);
            workspaceTransferController.onWindowAdded(window);
            onPanelGeometryChanged(window);
            dynamicWorkspaceController.request();
            workspaceRecycleController.request();
        },
        onWindowActivated: onWindowActivatedForScrollLayout,
        onCurrentDesktopChanged: (previous, current, output) => {
            workspaceRecycleController.onDesktopChanged();
            workspaceSwitchController.onDesktopChanged(previous, current, output);
            reapplyManagedLayouts("output-desktop-changed");
            dynamicWorkspaceController.request();
            workspaceRecycleController.request();
        },
        onDesktopsChanged: () => {
            workspaceRecycleController.onDesktopChanged();
            workspaceSwitchController.onTopologyChanged();
            dynamicWorkspaceController.request();
            workspaceRecycleController.request();
        },
        onScreensChanged,
        onVirtualScreenGeometryChanged: () => {
            reapplyManagedLayouts("virtual-screen-geometry-changed");
            relayout("virtual-screen-geometry-changed");
        },
        connectManagedGeometry,
        initializeScrollLayout,
        readPreviousState: callback => runtimeBridge.readPreviousState(callback),
        setTimer: setRuntimeTimer,
        clearTimer: clearRuntimeTimer,
        markInitialized: value => {
            scrollLayoutInitialized = value;
            if (value) {
                dynamicWorkspaceController.request();
                workspaceRecycleController.request();
            }
        },
        registerShortcut,
        shortcuts,
        commitInitialState: () => commitRuntimeState("script-start", accepted => {
            if (accepted && continuousLayout) runtimeBridge.reportRecoveryStatus(recovery.status);
        }),
    },
    onStarted: () => {
        focusRingController.start();
        debug(
            `loaded primary=${resolveTargetOutput() ? resolveTargetOutput().name : "<none>"}` +
            ` secondary=${resolveSecondaryOutput() ? resolveSecondaryOutput().name : "<none>"}` +
            ` primaryOuter=${runtimeConfig.primary.top}/${runtimeConfig.primary.right}/` +
                `${runtimeConfig.primary.bottom}/${runtimeConfig.primary.left}` +
            ` secondaryOuter=${runtimeConfig.secondary.top}/${runtimeConfig.secondary.right}/` +
                `${runtimeConfig.secondary.bottom}/${runtimeConfig.secondary.left}`
        );
    },
    onStopping: () => emergencyRestoreAllWindows("runtime-stop"),
});

app.start();
