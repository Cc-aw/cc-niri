"use strict";

class ContextualWideCoordinator {
    constructor(options) {
        this.appState = options.appState;
        this.gateway = options.gateway;
        this.projectedRectForColumn = options.projectedRectForColumn;
        this.isFullyVisible = options.isFullyVisible;
        this.sameRectNear = options.sameRectNear;
        this.presentationRect = options.presentationRect;
        this.normalizeUuid = options.normalizeUuid;
        this.relayout = options.relayout;
        this.commitParking = options.commitParking;
        this.commitHeld = options.commitHeld;
        this.departureState = options.departureState;
        this.setActiveWindow = options.setActiveWindow;
        this.setTimer = options.setTimer;
        this.clearTimer = options.clearTimer;
        this.debug = options.debug;
        this.warn = options.warn;
        this.parkGraceMs = options.parkGraceMs;
        this.retryMs = options.retryMs;
        this.maxAttempts = options.maxAttempts;
        this.lastCommittedViewport = { mode: "pair", wideColumnId: null };
        this.pendingPark = null;
        this.pendingExit = null;
        this.departures = new Set();
        this.nextParkToken = 1;
        this.nextExitToken = 1;
    }

    cancel() {
        if (!this.appState.enabled) {
            Array.from(this.departures).forEach(pending => this.retireDeparture(pending));
        }
        this.releasePark();
        this.clearPendingTimer(this.pendingExit);
        this.pendingExit = null;
    }

    cancelForWorkspace() {
        const pending = this.pendingPark;
        const state = this.appState;
        // Keep the real Pair neighbor for the departing workspace's frozen
        // Effect pose. Park only after the compositor says Slide is idle.
        // A pending geometry ACK has no parkItem and remains an actual Pair.
        if (pending && pending.parkItem &&
                this.ownsPark(pending) &&
                state.columns.includes(pending.target) &&
                state.columns.includes(pending.neighbor)) {
            this.clearPendingTimer(pending);
            this.pendingPark = null;
            pending.workspaceId = state.activeWorkspaceId;
            pending.outputName = state.targetOutput.name;
            pending.departureAttempts = 0;
            this.departures.add(pending);
            this.scheduleDeparture(pending);
        }
        this.cancel();
    }

    retireDeparture(pending) {
        this.clearPendingTimer(pending);
        if (pending.check) this.clearPendingTimer(pending.check);
        pending.check = null;
        this.departures.delete(pending);
    }

    scheduleDeparture(pending) {
        if (!this.departures.has(pending)) return;
        if (++pending.departureAttempts > 60) {
            this.retireDeparture(pending);
            this.warn("[cc-presentation] workspace parking idle check unavailable");
            return; // Hydration/recovery still settles this sleeping workspace.
        }
        pending.timer = this.setTimer(() => {
            pending.timer = null;
            this.checkDeparture(pending);
        }, this.retryMs);
    }

    checkDeparture(pending) {
        if (!this.departures.has(pending)) return;
        const disposition = this.departureState(pending);
        if (disposition === "retired") { this.retireDeparture(pending); return; }
        if (disposition === "waiting") { this.scheduleDeparture(pending); return; }
        const check = { timer: null };
        pending.check = check;
        const finish = active => {
            if (!this.departures.has(pending) || pending.check !== check) return;
            this.clearPendingTimer(check);
            pending.check = null;
            const current = this.departureState(pending);
            if (current === "retired") { this.retireDeparture(pending); return; }
            if (active !== false || current !== "sleeping") { this.scheduleDeparture(pending); return; }
            this.retireDeparture(pending);
            this.commitParking(pending.parkItem);
            this.gateway.reportMotionParked({
                type: "PAIR_TO_WIDE", transitionToken: pending.token,
                targetWindowUuid: this.normalizeUuid(pending.target.window.internalId),
            }, () => {});
        };
        check.timer = this.setTimer(() => finish(null), 1000);
        try { this.gateway.workspaceTransitionStatus(finish); }
        catch (_error) { finish(null); }
    }

    adoptRestoredViewport() {
        // Workspace hydration restores an existing presentation, rather than
        // entering Wide from this coordinator's previous workspace Pair.
        // Retaining that workspace's neighbor would expose it until a second
        // Pair-to-Wide completion, even though the restored owner is already Wide.
        this.cancel();
        this.lastCommittedViewport = Object.assign({}, this.appState.viewport);
    }

    cancelExit() {
        this.clearPendingTimer(this.pendingExit);
        this.pendingExit = null;
    }

    clearPendingTimer(pending) {
        if (pending && pending.timer) {
            this.clearTimer(pending.timer);
            pending.timer = null;
        }
    }

    releasePark() {
        const pending = this.pendingPark;
        if (!pending) return;
        this.clearPendingTimer(pending);
        this.pendingPark = null;
        this.gateway.reportMotionParked({
            type: "PAIR_TO_WIDE",
            transitionToken: pending.token,
            targetWindowUuid: this.normalizeUuid(pending.target.window.internalId),
        }, () => {});
    }

    cancelForWindow(window) {
        Array.from(this.departures).forEach(pending => {
            if (pending.target.window === window || pending.neighbor.window === window) this.retireDeparture(pending);
        });
        if (this.pendingPark &&
                (this.pendingPark.target.window === window ||
                 this.pendingPark.neighbor.window === window)) {
            this.releasePark();
        }
        if (this.pendingExit && this.pendingExit.target.window === window) {
            this.clearPendingTimer(this.pendingExit);
            this.pendingExit = null;
        }
    }

    isActivationDeferred() {
        return Boolean(this.pendingExit);
    }

    deferActivation(window) {
        if (!this.pendingExit) return false;
        this.pendingExit.activationWindow = window;
        return true;
    }

    retainedNeighbor() {
        return this.pendingPark ? this.pendingPark.neighbor : null;
    }

    parkToken() {
        return this.pendingPark ? this.pendingPark.token : null;
    }

    ownsPark(pending) {
        const state = this.appState;
        return pending.kind === "full"
            ? pending.target.widthMode === "full" && state.viewport.mode === "pair" &&
                state.presentation.mode === "normal" &&
                state.columns[state.focusedColumnIndex] === pending.target
            : state.viewport.mode === "wide-focus" &&
                state.viewport.wideColumnId === pending.target.id;
    }

    wideExitColumn() {
        const state = this.appState;
        return this.lastCommittedViewport.mode === "wide-focus" &&
            state.presentation.mode === "normal" &&
            state.viewport.mode === "pair"
            ? state.columns.find(column =>
                column.id === this.lastCommittedViewport.wideColumnId) || null
            : null;
    }

    prepareLayoutTransition(target, widthTransition) {
        const state = this.appState;
        if (this.pendingExit && (state.viewport.mode !== "pair" ||
                state.columns.indexOf(this.pendingExit.target) < 0)) {
            this.cancelExit();
        }
        if (widthTransition) {
            this.releasePark();
            if (widthTransition.column.widthMode === "full" && widthTransition.neighbor &&
                    this.isFullyVisible(widthTransition.oldRect)) {
                this.pendingPark = {
                    kind: "full", token: String(this.nextParkToken++),
                    target: widthTransition.column, neighbor: widthTransition.neighbor,
                    expected: this.projectedRectForColumn(widthTransition.column),
                    attempts: 0, scheduled: false,
                };
            }
            return;
        }
        if (this.pendingPark && this.pendingPark.kind === "full") {
            if (this.ownsPark(this.pendingPark) && state.columns.includes(this.pendingPark.target) &&
                    state.columns.includes(this.pendingPark.neighbor)) return;
            this.releasePark();
        }
        if (!target || state.viewport.mode !== "wide-focus") {
            this.releasePark();
            return;
        }
        if (this.pendingPark && this.pendingPark.target === target) return;
        if (this.lastCommittedViewport.mode !== "pair") return;
        const targetRect = this.projectedRectForColumn(target);
        const neighbor = state.columns.find(column => {
            if (column === target) return false;
            const rect = this.projectedRectForColumn(column);
            return this.isFullyVisible(rect) &&
                Math.abs(rect.y - targetRect.y) < 2 &&
                (Math.abs(rect.x - targetRect.x - targetRect.width -
                    state.innerGap) < 3 ||
                 Math.abs(rect.x + rect.width + state.innerGap -
                    targetRect.x) < 3);
        }) || null;
        if (!neighbor) return;
        this.pendingPark = {
            token: String(this.nextParkToken++), target, neighbor,
            attempts: 0, scheduled: false,
        };
        this.debug(`[cc-presentation] RETAIN_PAIR_NEIGHBOR token=${this.pendingPark.token}` +
            ` target=${target.id} neighbor=${neighbor.id}`);
    }

    preparePartialExit(plan) {
        if (!plan.viewportMotion || plan.viewportMotion.type !== "WIDE_TO_PAIR" ||
                !plan.windows.some(item => item.partial)) return null;
        const target = plan.windows.find(item => item.columnId === plan.viewportMotion.targetColumnId);
        this.pendingExit = { token: String(this.nextExitToken++), target: target.column,
            expected: target.rect, attempts: 0, waitAttempts: 0, requireMotionComplete: true };
        return this.pendingExit.token;
    }

    onPlanCommitted(plan, wideExitColumn, commitResult, activationWindow, options = {}) {
        const state = this.appState;
        if (this.pendingExit && this.pendingExit.requireMotionComplete &&
                options.nativeScroll && options.legacyMotion && commitResult.heldIncoming.length) {
            this.pendingExit.heldPlan = plan;
        }
        if (this.pendingPark && plan.viewportMotion &&
                plan.viewportMotion.type === "PAIR_TO_WIDE" && plan.layoutSnapshots) {
            const neighbor = this.pendingPark.neighbor;
            const entry = plan.layoutSnapshots.to.entries.find(item =>
                item.columnId === neighbor.id && item.placement === "isolated-hidden");
            const item = plan.windows.find(item => item.column === neighbor);
            if (entry && item) this.pendingPark.parkItem = Object.assign({}, item, {
                placement: "parked", rect: Object.assign({}, entry.realRect),
            });
        }
        if (wideExitColumn && commitResult.heldIncoming.length &&
                !(this.pendingExit && this.pendingExit.requireMotionComplete)) {
            this.clearPendingTimer(this.pendingExit);
            this.pendingExit = {
                token: String(this.nextExitToken++), target: wideExitColumn,
                expected: plan.windows.find(item =>
                    item.column === wideExitColumn).rect,
                attempts: 0, activationWindow,
            };
        }
        this.lastCommittedViewport = Object.assign({}, state.viewport);
        if (this.pendingExit && this.pendingExit.attempts === 0) {
            this.requestExit(this.pendingExit);
        }
        if (this.pendingPark && !this.pendingPark.scheduled) {
            this.pendingPark.scheduled = true;
            this.requestPark(this.pendingPark, this.retryMs);
        }
        if (activationWindow && !this.pendingExit) {
            this.setActiveWindow(activationWindow);
        }
    }

    requestPark(pending, delayMs) {
        this.clearPendingTimer(pending);
        const command = {
            commandId: `${this.gateway.sessionId()}-contextual-wide-${pending.token}-` +
                `${pending.attempts++}`,
            type: "finalize-contextual-wide",
            transitionToken: pending.token,
            windowUuid: this.normalizeUuid(pending.target.window.internalId),
        };
        pending.commandId = command.commandId;
        pending.timer = this.setTimer(() => {
            if (this.pendingPark === pending &&
                    pending.commandId === command.commandId) {
                this.finalizePark(command);
            }
        }, delayMs + 150);
        this.gateway.requestDeferred(command, delayMs, accepted => {
            if (!accepted) this.finalizePark(command);
        });
    }

    finalizePark(command) {
        const pending = this.pendingPark;
        const state = this.appState;
        if (!pending || pending.token !== String(command.transitionToken) ||
                (!command.motionCompleted &&
                 pending.commandId !== command.commandId) ||
                !this.ownsPark(pending) ||
                state.columns.indexOf(pending.target) < 0) return false;
        this.clearPendingTimer(pending);
        if (command.motionCompleted) pending.motionCompleted = true;
        if (!this.sameRectNear(pending.target.window.frameGeometry,
                pending.expected || this.presentationRect()) && pending.attempts <= this.maxAttempts) {
            this.requestPark(pending, this.retryMs);
            return true;
        }
        if (!pending.geometryAcknowledged) {
            pending.geometryAcknowledged = true;
            if (!pending.motionCompleted) {
                this.requestPark(pending, this.parkGraceMs);
                return true;
            }
        }
        this.pendingPark = null;
        const offset = state.scrollOffsetX;
        this.relayout("contextual-wide-park", {
            oldScrollOffsetX: offset, newScrollOffsetX: offset,
        });
        this.gateway.reportMotionParked({
            type: "PAIR_TO_WIDE",
            transitionToken: pending.token,
            targetWindowUuid: this.normalizeUuid(pending.target.window.internalId),
        }, accepted => {
            if (!accepted) this.warn("[cc-presentation] motion-park repaint rejected");
        });
        return true;
    }

    requestExit(pending, delayMs = this.retryMs) {
        this.clearPendingTimer(pending);
        const command = {
            commandId: `${this.gateway.sessionId()}-contextual-wide-exit-` +
                `${pending.token}-${pending.attempts++}`,
            type: "finalize-contextual-wide-exit",
            transitionToken: pending.token,
            windowUuid: this.normalizeUuid(pending.target.window.internalId),
        };
        pending.commandId = command.commandId;
        pending.timer = this.setTimer(() => {
            if (this.pendingExit === pending &&
                    pending.commandId === command.commandId) {
                this.finalizeExit(command);
            }
        }, delayMs + 150);
        this.gateway.requestDeferred(command, delayMs, accepted => {
            if (!accepted) this.finalizeExit(command);
        });
    }

    finalizeExit(command) {
        const pending = this.pendingExit;
        if (!pending || pending.token !== String(command.transitionToken) ||
                (!command.motionCompleted && pending.commandId !== command.commandId)) return false;
        this.clearPendingTimer(pending);
        if (command.motionCompleted) pending.motionCompleted = true;
        if (pending.requireMotionComplete && !pending.motionCompleted && pending.waitAttempts++ < 120) {
            this.requestExit(pending); return true;
        }
        if (!this.sameRectNear(pending.target.window.frameGeometry,
                pending.expected) && pending.attempts <= this.maxAttempts) {
            this.requestExit(pending);
            return true;
        }
        this.pendingExit = null;
        const state = this.appState;
        const offset = state.scrollOffsetX;
        this.relayout("contextual-wide-exit-ack", {
            oldScrollOffsetX: offset, newScrollOffsetX: offset,
        });
        const focused = state.columns[state.focusedColumnIndex];
        if (pending.activationWindow && focused &&
                focused.window === pending.activationWindow) {
            this.setActiveWindow(pending.activationWindow);
        }
        return true;
    }

    onTargetGeometryChanged(window) {
        const pending = this.pendingExit;
        if (!pending || pending.target.window !== window ||
                !this.sameRectNear(window.frameGeometry, pending.expected)) return false;
        if (pending.heldPlan && this.commitHeld) {
            const plan = pending.heldPlan;
            pending.heldPlan = null;
            this.commitHeld(plan);
        }
        this.requestExit(pending, 1);
        return true;
    }
}

/* cjs:start */
module.exports = { ContextualWideCoordinator };
/* cjs:end */
