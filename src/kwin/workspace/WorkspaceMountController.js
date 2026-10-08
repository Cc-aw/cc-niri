"use strict";

/* cjs:start */
const { WorkspacePersistence } = require("./WorkspacePersistence");
/* cjs:end */

class WorkspaceMountController {
    constructor(options) {
        Object.assign(this, options);
        this.stopped = false;
        this.persistence = options.persistence || new WorkspacePersistence({
            snapshots: this.snapshots, hasDesktop: id => Boolean(this.topology.byId(id)),
        });
    }

    currentId() {
        return this.topology.id(this.topology.current(this.appState.targetOutput));
    }

    canUseActiveWorkspace() {
        return Boolean(!this.stopped && this.appState.enabled &&
            !this.appState.workspaceSwitching && this.appState.activeWorkspaceId &&
            this.currentId() === this.appState.activeWorkspaceId);
    }

    eligible(window, workspaceId) {
        return Boolean(window && this.normalizeUuid(window.internalId) &&
            this.windowPolicy.canJoinColumn(window) &&
            this.membership.belongsTo(window, workspaceId) &&
            window.output === this.appState.targetOutput && !this.stateFor(window).floating);
    }

    pruneSnapshots() {
        const windows = new Map(this.getWindows().map(window => [this.normalizeUuid(window.internalId), window]));
        this.snapshots.all().forEach(snapshot => {
            if (!this.topology.byId(snapshot.workspaceId)) {
                this.snapshots.remove(snapshot.workspaceId);
                return;
            }
            snapshot.columns = snapshot.columns.filter(column =>
                this.eligible(windows.get(column.uuid), snapshot.workspaceId));
            this.snapshots.set(snapshot.workspaceId, snapshot);
        });
    }

    capture() {
        const state = this.appState;
        if (!state.activeWorkspaceId) return null;
        const columns = state.columns.filter(column => this.eligible(column.window, state.activeWorkspaceId));
        const focused = this.columnStore.focusedColumn();
        const anchor = columns.reduce((previous, column) =>
            column.logicalX <= state.scrollOffsetX ? column : previous, null);
        const wide = columns.find(column => column.id === state.viewport.wideColumnId);
        return this.snapshots.set(state.activeWorkspaceId, {
            columns: columns.map(column => ({ uuid: this.normalizeUuid(column.window.internalId),
                widthMode: column.widthMode, previousNonFullWidthMode: column.previousNonFullWidthMode,
                persistentWide: column.persistentWide })),
            focusedUuid: focused ? this.normalizeUuid(focused.window.internalId) : null,
            viewportAnchor: anchor ? { uuid: this.normalizeUuid(anchor.window.internalId),
                delta: state.scrollOffsetX - anchor.logicalX } : null,
            viewport: { mode: state.viewport.mode, wideUuid: wide ? this.normalizeUuid(wide.window.internalId) : null },
            presentation: state.presentation,
        });
    }

    unmount(capture = true) {
        if (capture) this.capture();
        this.resetPresentation();
        this.appState.columns.forEach(column => {
            const state = this.stateFor(column.window);
            state.managedByScrollLayout = false;
            state.columnId = null;
            // Parking remains script-owned. A sleeping workspace is not detached.
            state.viewportBeforeFullscreen = null;
            this.transitionAdoption(column.window, state, this.phases.waitingWorkspace, "workspace-unmount");
        });
        this.columnStore.clear();
        this.appState.scrollOffsetX = 0;
        this.appState.activeWorkspaceId = null;
        this.appState.prePresentationViewport = null;
    }

    reconcile(workspaceId, snapshot) {
        const saved = new Map((snapshot ? snapshot.columns : []).map(column => [column.uuid, column]));
        const windows = new Map();
        // prepareWindow can synchronously emit signals. A second enumeration also
        // includes windows added during native maximize/tile preparation.
        for (let pass = 0; pass < 2; pass += 1) {
            this.getWindows().forEach(window => {
                const uuid = this.normalizeUuid(window.internalId);
                if (windows.has(uuid) || !this.eligible(window, workspaceId) ||
                        (window.fullScreen && !saved.has(uuid))) return;
                if (window.fullScreen || this.prepareWindow(window)) windows.set(uuid, window);
            });
        }
        windows.forEach((window, uuid) => {
            if (!this.eligible(window, workspaceId) ||
                    (window.fullScreen && !saved.has(uuid))) windows.delete(uuid);
        });
        const order = [];
        saved.forEach((entry, uuid) => {
            if (windows.has(uuid)) { order.push({ window: windows.get(uuid), entry }); windows.delete(uuid); }
        });
        windows.forEach((window, uuid) => order.push({ window, entry: { uuid, widthMode: "half", persistentWide: false } }));
        return order;
    }

    hydrate(workspaceId, snapshot, focusedUuid = null) {
        const state = this.appState;
        const entries = this.reconcile(workspaceId, snapshot);
        state.activeWorkspaceId = workspaceId;
        entries.forEach(({ window, entry }) => {
            const column = this.columnStore.insertWindow(window, state.columns.length,
                entry.widthMode, entry.previousNonFullWidthMode);
            column.persistentWide = entry.persistentWide;
            const windowState = this.stateFor(window);
            windowState.workspaceOwnerId = workspaceId;
            windowState.workspaceColumnPreference = null;
            windowState.managedByScrollLayout = true;
            windowState.columnId = column.id;
            this.transitionAdoption(window, windowState, this.phases.managed, "workspace-mount");
        });
        this.recomputeLayout();
        const kdeIndex = this.columnStore.indexOfWindow(this.getActiveWindow());
        const requestedIndex = focusedUuid ? state.columns.findIndex(column =>
            this.normalizeUuid(column.window.internalId) === focusedUuid) : -1;
        const selectedIndex = requestedIndex >= 0 ? requestedIndex : kdeIndex;
        const savedIndex = snapshot ? state.columns.findIndex(column =>
            this.normalizeUuid(column.window.internalId) === snapshot.focusedUuid) : -1;
        this.columnStore.focusIndex(selectedIndex >= 0 ? selectedIndex : savedIndex >= 0 ? savedIndex : 0);
        const anchor = snapshot && snapshot.viewportAnchor;
        const anchorColumn = anchor && state.columns.find(column =>
            this.normalizeUuid(column.window.internalId) === anchor.uuid);
        state.scrollOffsetX = this.boundOffset(anchorColumn ? anchorColumn.logicalX + anchor.delta : 0);
        const focused = this.columnStore.focusedColumn();
        // Keep a valid saved anchor unless KDE selected a different Column.
        if (focused && (!anchorColumn || (selectedIndex >= 0 && selectedIndex !== savedIndex))) this.ensureVisible(focused);
        this.resetPresentation();
        // Snapshots store UUIDs, while newly mounted Columns receive fresh IDs.
        // Restore the saved viewport only when KDE still focuses that Wide owner.
        const savedViewport = snapshot && snapshot.viewport;
        let restoredViewport = { mode: "pair", wideColumnId: null };
        if (focused && focused.persistentWide && !focused.window.fullScreen &&
                savedViewport && ["wide", "wide-focus"].includes(savedViewport.mode) &&
                savedViewport.wideUuid === this.normalizeUuid(focused.window.internalId) &&
                snapshot.presentation.mode !== "maximized") {
            restoredViewport = { mode: "wide-focus", wideColumnId: focused.id };
        }
        this.restoreViewport(restoredViewport);
        this.relayout("workspace-mount");
        // Explicit move-and-follow selects a live mounted Column. Commit its
        // real target before activation; ordinary J/K keeps native focus policy.
        if (requestedIndex >= 0) this.activateColumn(focused.window);
    }

    mountPrepared(desktop, reason, focusedUuid = null) {
        return this.mount(desktop, reason, false, true, focusedUuid);
    }

    mount(desktop, reason = "workspace-switch", commit = true, prepared = false, focusedUuid = null) {
        const state = this.appState;
        const id = this.topology.id(desktop);
        if (this.stopped || (state.workspaceSwitching && !prepared) || !state.enabled || !state.targetOutput || !id) return false;
        state.workspaceSwitching = true;
        try {
            if (!prepared) this.cancelPending(reason);
            this.pruneSnapshots();
            if (!prepared) this.capture();
            const snapshot = this.snapshots.get(id);
            this.unmount(false);
            this.hydrate(id, snapshot, focusedUuid);
            this.capture();
            if (commit) this.commitDock(reason);
            this.debug(`[cc-workspace] MOUNT id=${id} columns=${state.columns.length} reason=${reason}`);
            return true;
        } catch (error) {
            this.stop();
            this.onFailure(error);
            return false;
        } finally {
            if (!prepared) state.workspaceSwitching = false;
            // A native change can be emitted synchronously by preparation. Its
            // handler was gated by the batch; reconcile the final KDE authority.
            if (!prepared && !this.stopped && state.activeWorkspaceId && this.currentId() &&
                    this.currentId() !== state.activeWorkspaceId) {
                this.onDesktopChanged(null, null, state.targetOutput);
            }
        }
    }

    initialize(previousState) {
        this.refreshState();
        const desktop = this.topology.current(this.appState.targetOutput);
        const id = this.topology.id(desktop);
        this.persistence.restore(previousState, id,
            this.appState.targetOutput ? this.appState.targetOutput.name : "");
        return this.mount(desktop, "script-start-workspace", false);
    }

    onDesktopChanged(_previous, _current, output) {
        this.refreshState();
        if (!this.topology.affectsOutput(output, this.appState.targetOutput) ||
                !this.appState.activeWorkspaceId || this.currentId() === this.appState.activeWorkspaceId) return false;
        // Query KDE's actual current desktop; never hydrate a stale signal payload.
        return this.mount(this.topology.current(this.appState.targetOutput));
    }

    onTopologyChanged() {
        if (this.stopped || this.appState.workspaceSwitching) return false;
        this.pruneSnapshots();
        return this.onDesktopChanged(null, null, this.appState.targetOutput);
    }

    onWindowMembershipChanged(window) {
        const owner = this.snapshots.workspaceForWindow(this.normalizeUuid(window.internalId)) ||
            this.stateFor(window).workspaceOwnerId;
        if (owner && !this.eligible(window, owner)) {
            this.snapshots.removeWindow(this.normalizeUuid(window.internalId));
            // Sleeping parked windows becoming Sticky must immediately be accessible.
            this.releaseWindow(window, "workspace-membership-changed");
        }
    }

    onWindowClosed(window) { this.snapshots.removeWindow(this.normalizeUuid(window.internalId)); }
    stop() {
        if (this.stopped) return;
        this.stopped = true;
        this.cancelPending("workspace-stop");
    }
}

/* cjs:start */
module.exports = { WorkspaceMountController };
/* cjs:end */
