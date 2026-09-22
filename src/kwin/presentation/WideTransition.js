"use strict";

class WideTransition {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.phases = options.phases;
        this.normalPresentationMode = options.normalPresentationMode;
        this.widePresentationMode = options.widePresentationMode;
        this.timings = options.timings;
        this.maxGeometryAttempts = options.maxGeometryAttempts;
        this.getDockGeneration = options.getDockGeneration;
        this.getDockSessionId = options.getDockSessionId;
        this.requestDeferred = options.requestDeferred;
        this.relayout = options.relayout;
        this.commitDockState = options.commitDockState;
        this.presentationRect = options.presentationRect;
        this.sameRectNear = options.sameRectNear;
        this.clearPresentation = options.clearPresentation;
        this.selectPersistentPresentation = options.selectPersistentPresentation;
        this.setColumnVisibility = options.setColumnVisibility;
        this.applyColumnGeometry = options.applyColumnGeometry;
        this.isFullyVisible = options.isFullyVisible;
        this.projectedRectForColumn = options.projectedRectForColumn;
        this.rectText = options.rectText;
        this.debug = options.debug;
        this.warn = options.warn;
        this.pendingTransition = null;
        this.nextToken = 1;
    }

    pending() {
        return this.pendingTransition;
    }

    cancel() {
        const hadPending = Boolean(this.pendingTransition);
        this.pendingTransition = null;
        return hadPending;
    }

    matchesWindow(windowUuid) {
        return Boolean(this.pendingTransition &&
            this.pendingTransition.windowUuid === this.normalizeUuid(windowUuid));
    }

    pendingColumn(pending = this.pendingTransition) {
        if (!pending) return null;
        const appState = this.getAppState();
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === pending.windowUuid);
        if (!column || !column.persistentWide ||
                appState.columns.indexOf(column) !== appState.focusedColumnIndex ||
                column.window.output !== appState.targetOutput) {
            return null;
        }
        return column;
    }

    finalize(column) {
        const pending = this.pendingTransition;
        if (!pending || pending.phase !== this.phases.animating ||
                !column || this.pendingColumn(pending) !== column) {
            return false;
        }
        this.pendingTransition = null;
        const offset = this.getAppState().scrollOffsetX;
        this.relayout(`${pending.reason}-finalize-wide`, {
            oldScrollOffsetX: offset,
            newScrollOffsetX: offset,
        });
        this.commitDockState(`${pending.reason}-finalize-wide`);
        this.debug(`[cc-presentation] DEFERRED_WIDE_COMPLETE token=${pending.token}` +
            ` uuid=${pending.windowUuid}`);
        return true;
    }

    finalizeCommand(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingTransition;
        if (!pending || token !== pending.token ||
                pending.phase !== this.phases.animating) {
            return false;
        }
        const column = this.pendingColumn(pending);
        if (!column ||
                !this.sameRectNear(column.window.frameGeometry, this.presentationRect())) {
            this.pendingTransition = null;
            this.debug(`[cc-presentation] DEFERRED_WIDE_FINALIZE_CANCEL token=${token}`);
            return false;
        }
        return this.finalize(column);
    }

    acknowledgeGeometry(column) {
        const pending = this.pendingTransition;
        if (!pending || pending.phase !== this.phases.expanding ||
                this.pendingColumn(pending) !== column ||
                !this.sameRectNear(column.window.frameGeometry, this.presentationRect())) {
            return false;
        }
        pending.phase = this.phases.animating;
        /* The 72% client geometry is authoritative now. Park every neighbor in
         * the same acknowledgement turn instead of leaving a 50% window visible
         * underneath the expanding target for the paint-animation duration. */
        const offset = this.getAppState().scrollOffsetX;
        this.relayout(`${pending.reason}-park-wide-neighbors`, {
            oldScrollOffsetX: offset,
            newScrollOffsetX: offset,
        });
        this.requestStage(
            "finalize-wide-transition",
            pending,
            this.getDockGeneration(),
            this.timings.expansion
        );
        this.debug(`[cc-presentation] DEFERRED_WIDE_ACK token=${pending.token}` +
            ` actual=${this.rectText(column.window.frameGeometry)}` +
            ` animation=${this.timings.expansion}`);
        return true;
    }

    checkGeometry(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingTransition;
        if (!pending || token !== pending.token ||
                pending.phase !== this.phases.expanding) {
            return false;
        }
        const column = this.pendingColumn(pending);
        if (!column) {
            this.pendingTransition = null;
            return false;
        }
        const target = this.presentationRect();
        if (this.sameRectNear(column.window.frameGeometry, target)) {
            return this.acknowledgeGeometry(column);
        }
        if (pending.geometryAttempts >= this.maxGeometryAttempts) {
            this.warn(`[cc-presentation] WIDE_GEOMETRY_TIMEOUT token=${token}` +
                ` actual=${this.rectText(column.window.frameGeometry)}`);
            this.pendingTransition = null;
            this.clearPresentation();
            const offset = this.getAppState().scrollOffsetX;
            this.relayout(`${pending.reason}-wide-timeout`, {
                oldScrollOffsetX: offset,
                newScrollOffsetX: offset,
            });
            return false;
        }
        pending.geometryAttempts += 1;
        this.applyColumnGeometry(column, target, `${pending.reason}-retry-wide`);
        this.requestStage(
            "check-wide-transition",
            pending,
            this.getDockGeneration(),
            this.timings.geometryRetry
        );
        return true;
    }

    beginExpansion(pending, column, reason) {
        if (!pending || !column || this.pendingTransition !== pending ||
                this.pendingColumn(pending) !== column) return false;
        pending.reason = reason || pending.reason;
        this.selectPersistentPresentation(column);
        pending.phase = this.phases.expanding;
        pending.geometryAttempts = 1;
        const target = this.presentationRect();
        /* Wayland clients may acknowledge frameGeometry asynchronously. Keep the
         * normal-pair neighbor visible only until the target really reaches 72%;
         * acknowledgeGeometry parks it before the paint animation. */
        this.setColumnVisibility(column, true);
        this.applyColumnGeometry(column, target, `${pending.reason}-request-wide`);
        this.debug(`[cc-presentation] DEFERRED_WIDE_REQUEST token=${pending.token}` +
            ` requested=${this.rectText(target)}` +
            ` actual=${this.rectText(column.window.frameGeometry)}`);
        if (this.sameRectNear(column.window.frameGeometry, target)) {
            this.acknowledgeGeometry(column);
        } else {
            this.requestStage(
                "check-wide-transition",
                pending,
                this.getDockGeneration(),
                this.timings.geometryRetry
            );
        }
        return true;
    }

    complete(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingTransition;
        if (!pending || token !== pending.token ||
                pending.phase !== this.phases.settled) {
            return false;
        }
        const column = this.pendingColumn(pending);
        if (!column) {
            this.pendingTransition = null;
            this.debug(`[cc-presentation] DEFERRED_WIDE_CANCEL token=${token}`);
            return false;
        }
        return this.beginExpansion(pending, column, pending.reason);
    }

    requestStage(type, pending, baseGeneration, delayMs) {
        const sessionId = this.getDockSessionId();
        const command = {
            protocol: 1,
            commandId: `${sessionId}-wide-${pending.token}-${type}-` +
                `${pending.deferredSequence++}`,
            sessionId,
            baseGeneration,
            type,
            transitionToken: pending.token,
            windowUuid: pending.windowUuid,
        };
        this.requestDeferred(command, delayMs, accepted => {
            if (accepted) return;
            this.debug(`[cc-presentation] DEFERRED_WIDE_FALLBACK` +
                ` token=${pending.token} type=${type}`);
            if (type === "settle-wide-transition") {
                this.settle(command);
            } else if (type === "check-wide-transition") {
                this.checkGeometry(command);
            } else if (type === "finalize-wide-transition") {
                this.finalizeCommand(command);
            } else {
                this.complete(command);
            }
        });
    }

    settle(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingTransition;
        if (!pending || token !== pending.token ||
                pending.phase !== this.phases.scrolling) {
            return false;
        }
        const appState = this.getAppState();
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === pending.windowUuid);
        if (!column || !column.persistentWide ||
                appState.columns.indexOf(column) !== appState.focusedColumnIndex ||
                column.window.output !== appState.targetOutput ||
                appState.presentation.mode !== this.normalPresentationMode) {
            this.pendingTransition = null;
            this.debug(`[cc-presentation] DEFERRED_PAIR_CANCEL token=${token}`);
            return false;
        }

        /* Reassert the normal layout after the movement phase. This restores both
         * members of the destination pair even if an activation/minimize signal
         * raced with the initial reveal. No presentation window is selected yet. */
        this.relayout(`${pending.reason}-settle-pair`, {
            oldScrollOffsetX: appState.scrollOffsetX,
            newScrollOffsetX: appState.scrollOffsetX,
        });
        pending.phase = this.phases.settled;
        pending.revealWindowUuids = appState.columns
            .filter(item => this.isFullyVisible(this.projectedRectForColumn(item)))
            .map(item => this.normalizeUuid(item.window.internalId));
        this.requestStage(
            "complete-wide-transition",
            pending,
            Number(command.baseGeneration),
            this.timings.pairHold
        );
        this.debug(`[cc-presentation] DEFERRED_PAIR_SETTLED token=${token}` +
            ` visible=${pending.revealWindowUuids.join(",")}` +
            ` hold=${this.timings.pairHold}`);
        return true;
    }

    schedule(column, reason, baseGeneration) {
        const token = String(this.nextToken++);
        const appState = this.getAppState();
        const windowUuid = this.normalizeUuid(column.window.internalId);
        const revealWindowUuids = appState.columns
            .filter(item => this.isFullyVisible(this.projectedRectForColumn(item)))
            .map(item => this.normalizeUuid(item.window.internalId));
        this.pendingTransition = {
            token,
            windowUuid,
            reason,
            phase: this.phases.scrolling,
            revealWindowUuids,
            deferredSequence: 1,
        };
        this.requestStage(
            "settle-wide-transition",
            this.pendingTransition,
            baseGeneration,
            this.timings.scroll
        );
        this.debug(`[cc-presentation] DEFERRED_WIDE_SCHEDULE token=${token}` +
            ` uuid=${windowUuid} phase=${this.phases.scrolling}` +
            ` visible=${revealWindowUuids.join(",")}` +
            ` delay=${this.timings.scroll}`);
    }

    armStep(column, reason, direction) {
        const token = String(this.nextToken++);
        const windowUuid = this.normalizeUuid(column.window.internalId);
        this.pendingTransition = {
            token,
            windowUuid,
            reason,
            phase: this.phases.awaitingStep,
            entryDirection: direction,
            deferredSequence: 1,
        };
        this.debug(`[cc-presentation] WIDE_STEP_ARM token=${token}` +
            ` uuid=${windowUuid} direction=${direction}`);
    }

    beginStepIfPending(column, direction, reason) {
        const pending = this.pendingTransition;
        if (!column || !column.persistentWide || !pending ||
                pending.phase !== this.phases.awaitingStep ||
                pending.windowUuid !==
                    this.normalizeUuid(column.window.internalId) ||
                pending.entryDirection !== direction) {
            return false;
        }
        return this.beginExpansion(pending, column, reason);
    }

    onGeometryChanged(window) {
        const pending = this.pendingTransition;
        if (!pending || pending.phase !== this.phases.expanding ||
                pending.windowUuid !== this.normalizeUuid(window.internalId) ||
                !this.sameRectNear(window.frameGeometry, this.presentationRect())) {
            return false;
        }
        this.acknowledgeGeometry(this.pendingColumn(pending));
        return true;
    }

    transitionFocused(column, reason, oldScrollOffsetX,
            newScrollOffsetX, wideStepDirection = 0) {
        const appState = this.getAppState();
        const oldWindowUuid = appState.presentation.windowUuid;
        const oldMode = appState.presentation.mode;
        const columnUuid = column
            ? this.normalizeUuid(column.window.internalId)
            : null;
        const alreadySelectedWide = Boolean(column && column.persistentWide &&
            oldMode === this.widePresentationMode && oldWindowUuid === columnUuid);
        if (this.pendingTransition &&
                this.pendingTransition.windowUuid !== columnUuid) {
            this.debug(`[cc-presentation] DEFERRED_WIDE_SUPERSEDE` +
                ` token=${this.pendingTransition.token} reason=${reason}`);
            this.pendingTransition = null;
        }
        if (this.pendingTransition &&
                this.pendingTransition.windowUuid === columnUuid &&
                column && column.persistentWide && !alreadySelectedWide) {
            this.debug(`[cc-presentation] DEFERRED_WIDE_REUSE` +
                ` token=${this.pendingTransition.token} reason=${reason}`);
            return oldWindowUuid !== appState.presentation.windowUuid ||
                oldMode !== appState.presentation.mode;
        }

        if (column && column.persistentWide && !alreadySelectedWide) {
            /* KWin cannot paint between two synchronous geometry commits. Reveal
             * the real 50% slot now, then request the 72% commit after scrolling. */
            this.clearPresentation();
            this.relayout(`${reason}-reveal-wide`, {
                oldScrollOffsetX,
                newScrollOffsetX,
            });
            if (wideStepDirection !== 0) {
                this.armStep(column, reason, wideStepDirection);
            } else {
                const presentationChangedNow = oldWindowUuid !==
                        appState.presentation.windowUuid ||
                    oldMode !== appState.presentation.mode;
                this.schedule(
                    column,
                    reason,
                    this.getDockGeneration() + (presentationChangedNow ? 1 : 0)
                );
            }
        } else {
            this.selectPersistentPresentation(column);
            this.relayout(reason, { oldScrollOffsetX, newScrollOffsetX });
        }

        return oldWindowUuid !== appState.presentation.windowUuid ||
            oldMode !== appState.presentation.mode;
    }
}

/* cjs:start */
module.exports = { WideTransition };
/* cjs:end */
