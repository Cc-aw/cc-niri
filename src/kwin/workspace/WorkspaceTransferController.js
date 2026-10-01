"use strict";

class WorkspaceTransferController {
    constructor(options) {
        Object.assign(this, options);
        this.processing = new Set();
        this.closed = new WeakSet();
        this.layoutPending = false;
        this.stopped = false;
    }

    isProcessing() { return this.processing.size > 0; }

    deferLayout() {
        if (!this.isProcessing()) return false;
        this.layoutPending = true;
        return true;
    }

    append(owner, entry) {
        const snapshot = this.snapshots.get(owner) || { columns: [] };
        if (!snapshot.columns.some(column => column.uuid === entry.uuid)) {
            snapshot.columns.push(entry);
            this.snapshots.set(owner, snapshot);
        }
    }

    transfer(window, reason) {
        const state = this.stateFor(window);
        const uuid = this.normalizeUuid(window.internalId);
        const column = this.getColumn(window);
        const savedOwner = this.snapshots.workspaceForWindow(uuid);
        const previous = savedOwner || state.workspaceOwnerId;
        const owner = this.membership.ownerId(window);
        const saved = savedOwner && this.snapshots.get(savedOwner);
        const savedEntry = saved && saved.columns.find(item => item.uuid === uuid);
        const eligible = Boolean(uuid && owner && this.topology.byId(owner) &&
            this.windowPolicy.canJoinColumn(window) && !state.floating &&
            (!window.fullScreen || column || savedEntry) &&
            window.output === this.appState.targetOutput);
        const entry = column ? { uuid, widthMode: column.widthMode, persistentWide: column.persistentWide }
            : savedEntry ||
                state.workspaceColumnPreference || { uuid, widthMode: "half", persistentWide: false };
        const changed = owner !== previous || !eligible;
        if (changed) {
            state.workspaceColumnPreference = Object.assign({}, entry);
            this.cancelPending(window, reason);
            // Restore opacity, script-owned minimization and accessible geometry
            // before removing the live column or assigning the new owner.
            this.releaseWindow(window, reason);
            if (this.closed.has(window)) return true;
            if (column) this.removeWindow(window, reason);
            this.snapshots.removeWindow(uuid);
            state.managedByScrollLayout = false;
            state.columnId = null;
            state.viewportBeforeFullscreen = null;
        }
        // A synchronous release signal may have changed desktops again.
        if (this.membership.ownerId(window) !== owner) return false;
        state.workspaceOwnerId = owner;
        state.workspaceColumnPreference = eligible ? Object.assign({}, entry) : null;
        if (eligible && owner !== this.appState.activeWorkspaceId) this.append(owner, entry);
        return true;
    }

    onMembershipChanged(window, reason = "window-desktops-changed") {
        if (!window || this.closed.has(window) || this.stopped || !this.appState.enabled || this.processing.has(window)) return false;
        this.processing.add(window);
        let completed = false;
        try {
            for (let pass = 0; pass < 8; pass += 1) {
                if (this.transfer(window, reason)) { completed = true; break; }
            }
            if (!completed) throw new Error("workspace-transfer-membership-unstable");
        } catch (error) {
            this.stop();
            this.onFailure(error);
            return false;
        } finally {
            this.processing.delete(window);
        }
        if (this.stopped) return false;
        try {
            if (!this.isProcessing() && this.canCommit() && this.layoutPending) {
                this.layoutPending = false;
                this.flushLayout(reason);
            }
            // Adoption retains Floating/Dialog/native policies and waits for
            // real activation when entering the active workspace without focus.
            if (!this.closed.has(window)) {
                if (this.canCommit() && !this.isProcessing()) this.adoption.onMembershipChanged(window, reason);
                else this.adoption.begin(window, reason);
            }
            if (!this.isProcessing() && this.canCommit()) this.commitDock(reason);
            return true;
        } catch (error) {
            this.stop();
            this.onFailure(error);
            return false;
        }
    }

    onWindowAdded(window) { return this.onMembershipChanged(window, "workspace-window-added"); }
    onWindowClosed(window) {
        this.closed.add(window);
        this.snapshots.removeWindow(this.normalizeUuid(window.internalId));
    }
    commitClosed() {
        if (!this.stopped && !this.isProcessing() && this.canCommit()) this.commitDock("workspace-window-closed");
    }
    stop() { this.stopped = true; }
}

/* cjs:start */
module.exports = { WorkspaceTransferController };
/* cjs:end */
