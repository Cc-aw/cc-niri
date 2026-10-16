// Appended only to the full generated entry in the guarded private compositor.
(function () {
    const record = value => callDBus("org.cc.CCNiriP0Fixture", "/P0", "org.cc.CCNiriP0Fixture1", "Record", JSON.stringify(value), () => {});
    let label = "initial", staticAction = !continuousLayout, remaining = 1400, handle = null;
    const copy = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    function checkpoint() {
        if (!label) return;
        const snapshot = createRuntimeSnapshot();
        record({ kind: "p5-checkpoint", label, v2: Boolean(continuousLayout), enabled: mainScreenState.enabled,
            epoch: layoutTransaction.currentEpoch(), workspaceId: mainScreenState.activeWorkspaceId,
            currentWorkspaceId: virtualDesktopTopology.id(virtualDesktopTopology.current(mainScreenState.targetOutput)),
            camera: mainScreenState.scrollOffsetX, focusedUuid: snapshot.focusedUuid,
            activeUuid: workspace.activeWindow ? normalizeWindowUuid(workspace.activeWindow.internalId) : null,
            snapshot, errors: invariantChecker.errors(),
            columns: mainScreenState.columns.map(c => ({ uuid: normalizeWindowUuid(c.window.internalId),
                caption: c.window.caption, widthMode: c.widthMode, previous: c.previousNonFullWidthMode,
                persistentWide: c.persistentWide, fullScreen: c.window.fullScreen, opacity: c.window.opacity,
                minimized: c.window.minimized, frame: copy(c.window.frameGeometry) })),
            stopped: continuousLayout ? continuousLayout.stopped : !mainScreenState.enabled,
            stopConfirmed: continuousLayout ? continuousLayout.stopConfirmed === true : true,
            pending: continuousLayout ? Boolean(continuousLayout.coordinator.gate.pending || continuousLayout.coordinator.bootstrap) : false });
        label = null;
    }
    if (continuousLayout) {
        const submit = continuousLayout.coordinator.submit.bind(continuousLayout.coordinator);
        continuousLayout.coordinator.submit = intent => { record({kind: "p5-target", intent}); return submit(intent); };
        const recover = continuousLayout.coordinator.cancelThenRecover.bind(continuousLayout.coordinator);
        continuousLayout.coordinator.cancelThenRecover = (intent, reason) => {record({kind: "p5-recovery", reason}); return recover(intent, reason);};
        const prior = continuousLayout.onSettled;
        continuousLayout.onSettled = () => { prior(); if (!staticAction) checkpoint(); };
    }
    runtimeBridge.handlers["focus-column-right"] = command => {
        label = command.p5Action; staticAction = false;
        const column = columnStore.focusedColumn(), window = column && column.window;
        switch (label) {
        case "cycle": columnWidthController.cycle(); break;
        case "full": columnWidthController.toggleFull(); break;
        case "focus-next": focusRelativeColumn(1); break;
        case "focus-prev": focusRelativeColumn(-1); break;
        case "move-right": moveFocusedColumn(1); break;
        case "center": toggleFocusWide(window); break;
        case "fullscreen-enter": staticAction = true; window.fullScreen = true; break;
        case "fullscreen-exit": window.fullScreen = false; break;
        case "workspace-next":
            if (workspace.desktops.length < 2) workspace.createDesktop(workspace.desktops.length, "P5 private");
            workspaceSwitchController.next(); break;
        case "workspace-prev": workspaceSwitchController.previous(); break;
        case "move-workspace-next": workspaceMoveController.moveNext(); break;
        case "maximize": staticAction = true; setPresentationMode(normalizeWindowUuid(window.internalId), "maximized", "p5-private-maximize"); break;
        case "normal": setPresentationMode(normalizeWindowUuid(window.internalId), "normal", "p5-private-normal"); break;
        case "inspect": staticAction = true; break;
        case "recovery-probe": {
            staticAction = true;
            const sleeping = workspace.windowList().find(w => w.normalWindow && columnStore.indexOfWindow(w) < 0);
            if (!sleeping) throw new Error("missing bounded recovery fixture");
            parkingManager.rememberVisibleGeometry(sleeping, copy(sleeping.frameGeometry));
            parkingManager.setVisibility(sleeping, false);
            sleeping.frameGeometry = { x: -6000, y: 50, width: 800, height: 600 };
            break;
        }
        case "stop": staticAction = true; app.stop(); break;
        default: record({ kind: "p5-fault", action: label });
        }
        return true;
    };
    runtimeBridge.generationAgnosticTypes.add("focus-column-right");
    function pump() {
        if (--remaining <= 0) { record({ kind: "p5-fault", reason: "bounded-fixture-deadline" }); return; }
        runtimeBridge.takePendingCommand();
        if (label && staticAction && scrollLayoutInitialized && (!continuousLayout || !continuousLayout.blocked) &&
                (label !== "fullscreen-enter" || !continuousLayout.coordinator.intent) &&
                (label !== "maximize" || sameRect(columnStore.focusedColumn().window.frameGeometry, mainScreenState.safeRect))) checkpoint();
        if (label === "stop" && continuousLayout && continuousLayout.stopConfirmed && recovery.status.state === "restored") checkpoint();
        if (label === "stop" && !continuousLayout && !mainScreenState.enabled) checkpoint();
        if (continuousLayout && continuousLayout.stopped && continuousLayout.stopConfirmed) return;
        handle = setRuntimeTimer(pump, 20);
    }
    handle = setRuntimeTimer(pump, 100);
})();
