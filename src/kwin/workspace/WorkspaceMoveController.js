"use strict";

// Command intent stays in JS. Native desktop membership, the existing transfer
// reconciler and switch/mount transaction remain the source of truth.
class WorkspaceMoveController {
    constructor(options) {
        Object.assign(this, options);
        this.pending = null;
        this.stopped = false;
    }

    activeColumn() {
        if (this.stopped || this.pending || !this.mount.canUseActiveWorkspace() ||
                this.switcher.phase !== "IDLE" || this.transfer.isProcessing()) return null;
        const window = this.getActiveWindow();
        if (!window || window.output !== this.appState.targetOutput ||
                this.stateFor(window).floating ||
                !this.windowPolicy.canJoinColumn(window) ||
                !this.membership.belongsTo(window, this.appState.activeWorkspaceId)) return null;
        const index = this.columnStore.indexOfWindow(window);
        return index >= 0 ? this.appState.columns[index] : null;
    }

    movePrevious() { return this.moveRelative(-1); }
    moveNext() { return this.moveRelative(1); }

    moveNumber(number) {
        if (!Number.isInteger(number) || number < 1 || number > 9) return false;
        const target = this.topology.byNumber(number);
        return target ? this.moveTo(this.topology.id(target)) : false;
    }

    moveRelative(direction) {
        if (!this.activeColumn()) return false;
        const current = this.topology.current(this.appState.targetOutput);
        const target = direction < 0 ? this.topology.previous(current) : this.topology.next(current);
        return target ? this.moveTo(this.topology.id(target)) : false;
    }

    moveTo(targetId) {
        const column = this.activeColumn();
        const target = this.topology.byId(targetId);
        if (!column || !target || targetId === this.appState.activeWorkspaceId) return false;
        const pending = { uuid: this.normalizeUuid(column.window.internalId),
            sourceId: this.appState.activeWorkspaceId, targetId,
            outputName: this.appState.targetOutput.name };
        if (!pending.uuid) return false;
        this.columnStore.focusColumn(column); // The actual active Column, even during a pending H/L ACK.
        this.pending = pending;
        const accepted = this.switcher.requestTo(target, {
            reason: "workspace-column-move", focusedUuid: pending.uuid,
            prepare: done => this.settleMotion(() => {
                if (this.pending !== pending || this.stopped) { done(false); return; }
                try { done(this.prepare(pending)); }
                catch (error) {
                    this.onFailure(error);
                    done(false);
                }
            }),
            onFinished: mountedId => this.finish(pending, mountedId),
        });
        if (!accepted && this.pending === pending) this.pending = null;
        return accepted;
    }

    liveWindow(uuid) {
        return this.getWindows().find(window => this.normalizeUuid(window.internalId) === uuid) || null;
    }

    prepare(pending) {
        const state = this.appState;
        const window = this.liveWindow(pending.uuid);
        const target = this.topology.byId(pending.targetId);
        if (!window || !target || !state.enabled || !state.targetOutput ||
                state.targetOutput.name !== pending.outputName ||
                this.topology.id(this.topology.current(state.targetOutput)) !== pending.sourceId ||
                this.getActiveWindow() !== window || window.output !== state.targetOutput ||
                !this.windowPolicy.canJoinColumn(window) ||
                this.stateFor(window).floating ||
                !this.membership.belongsTo(window, pending.sourceId) ||
                this.columnStore.indexOfWindow(window) < 0) return false;
        this.clearPresentation();
        this.changeMembership(window, target);
        // setDesktops can emit synchronously or queue its notification. Resolve
        // the actual property through the same idempotent native transfer path.
        const current = this.liveWindow(pending.uuid);
        if (!current) return false;
        this.transfer.onMembershipChanged(current, "workspace-column-move");
        this.settleSourceLayout();
        this.mount.capture(); // Capture the remaining right/left successor, not the moved owner.
        if (!this.liveWindow(pending.uuid) || this.transfer.stopped ||
                !this.topology.byId(pending.targetId) ||
                !this.membership.belongsTo(current, pending.targetId)) return false;
        if (this.snapshots.workspaceForWindow(pending.uuid) !== pending.targetId)
            throw new Error("workspace-move-owner-mismatch");
        const snapshot = this.snapshots.get(pending.targetId);
        snapshot.focusedUuid = pending.uuid;
        snapshot.viewportAnchor = { uuid: pending.uuid, delta: 0 };
        snapshot.viewport = { mode: "pair", wideUuid: null };
        snapshot.presentation = { mode: "normal", windowUuid: null };
        this.snapshots.set(pending.targetId, snapshot);
        return true;
    }

    finish(pending, mountedId) {
        if (this.pending !== pending) return;
        this.pending = null;
        this.debug(`[cc-workspace] MOVE uuid=${pending.uuid} source=${pending.sourceId}` +
            ` target=${pending.targetId} mounted=${mountedId || "<none>"}`);
        if (!this.stopped) this.onSettled();
    }

    stop() { this.stopped = true; this.pending = null; }
}

/* cjs:start */
module.exports = { WorkspaceMoveController };
/* cjs:end */
