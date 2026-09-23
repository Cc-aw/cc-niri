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
        this.nextParkToken = 1;
        this.nextExitToken = 1;
    }

    cancel() {
        this.releasePark();
        this.clearPendingTimer(this.pendingExit);
        this.pendingExit = null;
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

    wideExitColumn() {
        const state = this.appState;
        return this.lastCommittedViewport.mode === "wide-focus" &&
            state.presentation.mode === "normal" &&
            state.viewport.mode === "pair"
            ? state.columns.find(column =>
                column.id === this.lastCommittedViewport.wideColumnId) || null
            : null;
    }

    prepareLayoutTransition(target) {
        const state = this.appState;
        if (this.pendingExit && (state.viewport.mode !== "pair" ||
                state.columns.indexOf(this.pendingExit.target) < 0)) {
            this.cancelExit();
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

    onPlanCommitted(plan, wideExitColumn, commitResult, activationWindow) {
        const state = this.appState;
        if (wideExitColumn && commitResult.heldIncoming.length) {
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
                state.viewport.mode !== "wide-focus" ||
                state.viewport.wideColumnId !== pending.target.id ||
                state.columns.indexOf(pending.target) < 0) return false;
        this.clearPendingTimer(pending);
        if (command.motionCompleted) pending.motionCompleted = true;
        if (!this.sameRectNear(pending.target.window.frameGeometry,
                this.presentationRect()) && pending.attempts <= this.maxAttempts) {
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
                pending.commandId !== command.commandId) return false;
        this.clearPendingTimer(pending);
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
        this.requestExit(pending, 1);
        return true;
    }
}

/* cjs:start */
module.exports = { ContextualWideCoordinator };
/* cjs:end */
