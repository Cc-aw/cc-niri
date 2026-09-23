"use strict";

class DockScrollController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.clampScrollOffset = options.clampScrollOffset;
        this.stripWidth = options.stripWidth;
        this.isFullyVisible = options.isFullyVisible;
        this.projectedRectForColumn = options.projectedRectForColumn;
        this.requestDeferred = options.requestDeferred;
        this.getSessionId = options.getSessionId;
        this.stepMs = options.stepMs;
        this.clearPresentation = options.clearPresentation;
        this.normalPresentationMode = options.normalPresentationMode;
        this.commitDockState = options.commitDockState;
        this.publishDockState = options.publishDockState;
        this.focusIndex = options.focusIndex;
        this.transitionFocused = options.transitionFocused;
        this.setActiveWindow = options.setActiveWindow;
        this.isActivationDeferred = options.isActivationDeferred || (() => false);
        this.relayout = options.relayout;
        this.debug = options.debug;
        this.pendingScroll = null;
        this.nextToken = 1;
    }

    pending() {
        return this.pendingScroll;
    }

    hasPending() {
        return Boolean(this.pendingScroll);
    }

    cancel(reason) {
        if (!this.pendingScroll) return false;
        this.debug(`[cc-dock] SCROLL_CANCEL token=${this.pendingScroll.token}` +
            ` reason=${reason}`);
        this.pendingScroll = null;
        return true;
    }

    boundedOffset(offset) {
        const appState = this.getAppState();
        const viewportWidth = appState.safeRect ? appState.safeRect.width : 0;
        const maximum = Math.max(0, this.stripWidth() - viewportWidth);
        return Math.max(0, Math.min(Number(offset) || 0, maximum));
    }

    offsetsToTarget(column) {
        const appState = this.getAppState();
        if (!column || !appState.safeRect) return [];
        this.recomputeLogicalLayout();
        this.clampScrollOffset();
        if (this.isFullyVisible(this.projectedRectForColumn(column))) return [];

        const currentOffset = appState.scrollOffsetX;
        const targetOffset = this.boundedOffset(
            column.logicalX + column.pixelWidth - appState.safeRect.width
        );
        if (targetOffset === currentOffset) return [];

        const direction = targetOffset > currentOffset ? 1 : -1;
        const offsets = [];
        const seen = new Set();
        appState.columns.forEach(item => {
            const offset = this.boundedOffset(
                item.logicalX + item.pixelWidth - appState.safeRect.width
            );
            const between = direction > 0
                ? offset > currentOffset && offset <= targetOffset
                : offset < currentOffset && offset >= targetOffset;
            if (!between || seen.has(offset)) return;
            seen.add(offset);
            offsets.push(offset);
        });
        if (!seen.has(targetOffset)) offsets.push(targetOffset);
        offsets.sort((left, right) =>
            direction > 0 ? left - right : right - left);
        return offsets;
    }

    requestStep(pending) {
        const command = {
            commandId: `${this.getSessionId()}-dock-scroll-${pending.token}-` +
                `${pending.deferredSequence++}`,
            type: "advance-dock-scroll",
            transitionToken: pending.token,
            windowUuid: pending.windowUuid,
        };
        this.requestDeferred(command, this.stepMs, accepted => {
            if (accepted) return;
            this.debug(`[cc-dock] SCROLL_DEFER_FALLBACK token=${pending.token}`);
            this.advance(command);
        });
    }

    finish(pending, column) {
        const appState = this.getAppState();
        if (!pending || this.pendingScroll !== pending || !column) return false;
        const index = appState.columns.indexOf(column);
        if (index < 0 || column.window.output !== appState.targetOutput) {
            this.cancel("finish-target-missing");
            return false;
        }

        this.pendingScroll = null;
        const offset = appState.scrollOffsetX;
        this.focusIndex(index);
        const presentationChanged = this.transitionFocused(
            column,
            `${pending.reason}-arrive`,
            offset,
            offset
        );
        if (!this.isActivationDeferred() && column.window.minimized) {
            column.window.minimized = false;
        }
        this.setActiveWindow(column.window);
        this.debug(`[cc-dock] SCROLL_COMPLETE token=${pending.token}` +
            ` index=${index} offset=${offset} caption=${column.window.caption}`);
        if (presentationChanged) {
            this.commitDockState(`${pending.reason}-presentation`);
        } else {
            this.publishDockState(pending.reason);
        }
        return true;
    }

    advance(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingScroll;
        if (!pending || token !== pending.token ||
                this.normalizeUuid(command.windowUuid) !== pending.windowUuid) {
            return false;
        }
        const appState = this.getAppState();
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === pending.windowUuid);
        if (!column || column.window.output !== appState.targetOutput) {
            this.cancel("advance-target-missing");
            return false;
        }
        if (!pending.offsets.length) return this.finish(pending, column);

        const oldScrollOffsetX = appState.scrollOffsetX;
        appState.scrollOffsetX = pending.offsets.shift();
        this.clampScrollOffset();
        const newScrollOffsetX = appState.scrollOffsetX;
        this.relayout(`${pending.reason}-step`, {
            oldScrollOffsetX,
            newScrollOffsetX,
        });
        this.debug(`[cc-dock] SCROLL_STEP token=${pending.token}` +
            ` old=${oldScrollOffsetX} new=${newScrollOffsetX}` +
            ` remaining=${pending.offsets.length}`);
        if (pending.offsets.length) this.requestStep(pending);
        else this.finish(pending, column);
        return true;
    }

    begin(column, reason) {
        const appState = this.getAppState();
        if (!column || !appState.safeRect) return false;
        this.cancel("superseded-by-dock-click");
        const offsets = this.offsetsToTarget(column);

        if (appState.presentation.mode !== this.normalPresentationMode ||
                (appState.viewport && appState.viewport.mode !== "pair")) {
            this.clearPresentation();
            this.commitDockState(`${reason}-clear-presentation`);
        }

        const pending = {
            token: String(this.nextToken++),
            windowUuid: this.normalizeUuid(column.window.internalId),
            reason,
            offsets,
            deferredSequence: 1,
        };
        this.pendingScroll = pending;
        this.debug(`[cc-dock] SCROLL_BEGIN token=${pending.token}` +
            ` target=${pending.windowUuid}` +
            ` steps=${offsets.join(",") || "focus-only"}`);
        if (!offsets.length) return this.finish(pending, column);
        return this.advance({
            transitionToken: pending.token,
            windowUuid: pending.windowUuid,
        });
    }
}

/* cjs:start */
module.exports = { DockScrollController };
/* cjs:end */
