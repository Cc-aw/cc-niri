"use strict";

/* cjs:start */
const { ContinuousViewportController } = require("../layout/ContinuousViewportController");
const { ColumnGeometryCoordinator } = require("../layout/ColumnGeometryCoordinator");
/* cjs:end */

// Host glue only: the existing store/transaction, P2 policy, P4 ACK coordinator
// and global Recovery remain the respective authorities. No second layout cache.
class ContinuousLayoutRuntime {
    constructor(options) {
        Object.assign(this, options);
        this.blocked = false;
        this.inExclusive = false;
        this.stopped = false;
        this.actions = new Map();
        this.anchor = null;
        this.exclusiveSequence = 0;
        this.controller = new ContinuousViewportController({
            state: this.state, columnStore: this.columnStore, transaction: this.transaction,
            enabled: true, sessionId: this.bridge.sessionId(), dockEnabled: options.dockEnabled,
            getPrimaryOutput: this.getPrimaryOutput, getCurrentWorkspaceId: this.getCurrentWorkspaceId,
            getUuid: this.getUuid, canJoin: (window, scope) => this.canJoin(window, scope),
            getPainted: () => this.coordinator.getPainted(),
            onTarget: intent => {
                if (!this.blocked && !this.stopped && !this.state.sessionPaused) this.coordinator.submit(intent);
            },
        });
        this.coordinator = new ColumnGeometryCoordinator({
            bridge: this.bridge, currentEpoch: () => this.transaction.currentEpoch(),
            isScope: intent => this.controller.ready() && !this.blocked && !this.stopped && !this.state.sessionPaused &&
                !this.presentationSuspended() && intent.scopeRevision === this.controller.scopeRevision &&
                intent.workspaceId === this.state.activeWorkspaceId &&
                intent.targetOutput === this.state.targetOutput.name,
            columnFor: uuid => this.state.columns.find(column => this.getUuid(column.window) === uuid),
            eligible: (window, intent) => !window.fullScreen && this.canJoin(window, {
                workspaceId: intent.workspaceId, output: this.state.targetOutput }),
            prepare: (intent, done) => this.commitState(intent.reason, done),
            committer: this.committer, setVisibility: this.setVisibility, prepareClient: this.prepareClient,
            activate: (window, intent) => {
                if (!this.blocked && !this.stopped && this.state.enabled && !this.state.workspaceSwitching &&
                        intent.epoch === this.transaction.currentEpoch() &&
                        (this.columnStore.focusedColumn() || {}).window === window) this.activate(window);
            },
            recover: (_intent, proof) => this.fail(proof.reason, proof.cancelled),
            reissue: () => this.controller.reflow("v2-confirmed-recovery"),
            setTimer: this.setTimer, clearTimer: this.clearTimer, now: this.now, warn: this.warn,
            onComplete: () => this.onSettled(),
        });
        this.bridge.handlers["focus-partial-column"] = command => !this.blocked &&
            !this.presentationSuspended() && this.controller.focusPartialRequest(command);
    }

    presentationSuspended() {
        return this.state.presentation.mode === "maximized" || this.state.columns.some(c => c.window.fullScreen);
    }

    ready() { return !this.blocked && !this.stopped && !this.state.sessionPaused && !this.presentationSuspended() && this.controller.ready(); }

    restoreView(anchor, preserve) { this.anchor = preserve ? anchor : null; }

    captureView() {
        const column = this.columnStore.focusedColumn(), geometry = this.getGeometry();
        if (!column || !geometry) return null;
        return { version: 1, uuid: this.getUuid(column.window),
            delta: this.state.scrollOffsetX - column.logicalX,
            basis: { outputRect: geometry.outputRect, workingArea: geometry.workingArea,
                gap: geometry.gap, physicalScale: geometry.physicalScale } };
    }

    sync(reason = "v2-layout") {
        if (this.blocked || this.stopped || this.state.sessionPaused || !this.state.enabled || this.state.workspaceSwitching ||
                !this.state.activeWorkspaceId || this.presentationSuspended()) return false;
        const geometry = this.getGeometry();
        if (!geometry) { this.fail("missing-working-area", false); return false; }
        const focused = this.columnStore.focusedColumn();
        const anchor = this.anchor; this.anchor = null;
        const basisMatches = anchor && anchor.basis && geometry.gap === anchor.basis.gap &&
            geometry.physicalScale === anchor.basis.physicalScale &&
            ["outputRect", "workingArea"].every(key => ["x", "y", "width", "height"]
                .every(field => geometry[key][field] === anchor.basis[key][field]));
        const mounted = this.controller.mount({ workspaceId: this.state.activeWorkspaceId,
            output: this.state.targetOutput, geometry }, this.state.columns.map(column => ({
            window: column.window, widthMode: column.widthMode,
            previousNonFullWidthMode: column.previousNonFullWidthMode, persistentWide: column.persistentWide,
        })), { focusedUuid: focused ? this.getUuid(focused.window) : null,
            anchor: basisMatches ? anchor : null });
        return mounted || this.controller.reflow(reason);
    }

    exclusive(key, action) {
        if (this.stopped || this.state.sessionPaused) return false;
        if (this.inExclusive) return action();
        // Coalesce repeated signals from one live window, bounded by membership.
        if (this.actions.size >= 512 && !this.actions.has(key)) { this.fail("departure-overflow", false); return false; }
        this.actions.set(key, action);
        if (this.blocked) return true;
        this.blocked = true;
        const sequence = ++this.exclusiveSequence;
        this.coordinator.suspend(confirmed => {
            if (this.stopped || sequence !== this.exclusiveSequence) return;
            if (!confirmed) { this.actions.clear(); this.fail(`departure-disarm event=${key}`, false); return; }
            this.inExclusive = true;
            try {
                const actions = Array.from(this.actions.values()); this.actions.clear();
                actions.forEach(callback => callback());
            } catch (error) { this.fail(`departure:${error}`, true); }
            finally { this.inExclusive = false; this.blocked = false; }
            if (!this.stopped) this.sync(key);
        });
        return true;
    }

    pauseSession() {
        ++this.exclusiveSequence;
        this.blocked = true; this.actions.clear(); this.anchor = null;
        // Cancel leases immediately, even if the session query or wake is late.
        this.coordinator.pause();
    }

    resumeSession() {
        if (this.stopped || !this.state.enabled || this.coordinator.releaseEpoch !== null) return false;
        this.coordinator.quarantined = false;
        this.coordinator.recovering = false;
        this.blocked = false;
        return true;
    }

    releaseForWorkspace() {
        this.coordinator.releaseForWorkspace();
        this.controller.geometry = null; this.controller.lastTarget = null;
        this.controller.lastSample = null; this.anchor = null;
    }

    stop(done) {
        if (this.stopped && this.stopConfirmed === true) { done(true); return; }
        this.stopped = true; this.blocked = true; this.actions.clear(); this.anchor = null;
        ++this.exclusiveSequence;
        delete this.bridge.handlers["focus-partial-column"];
        this.coordinator.stop(confirmed => {
            this.stopConfirmed = confirmed;
            this.controller.geometry = null; this.controller.lastTarget = null; this.controller.lastSample = null;
            done(confirmed);
        });
    }
}

/* cjs:start */
module.exports = { ContinuousLayoutRuntime };
/* cjs:end */
