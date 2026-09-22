"use strict";

class PresentationController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.stateFor = options.stateFor;
        this.setLayoutMode = options.setLayoutMode;
        this.modes = options.modes;
        this.normalLayoutMode = options.normalLayoutMode;
        this.maximizeLayoutMode = options.maximizeLayoutMode;
        this.wideRatio = options.wideRatio;
        this.rectCopy = options.rectCopy;
        this.cancelPendingDockScroll = options.cancelPendingDockScroll;
        this.cancelPendingWideTransition = options.cancelPendingWideTransition;
        this.focusColumn = options.focusColumn;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.ensureColumnVisible = options.ensureColumnVisible;
        this.relayout = options.relayout;
        this.getActiveWindow = options.getActiveWindow;
        this.setActiveWindow = options.setActiveWindow;
        this.commitDockState = options.commitDockState;
        this.debug = options.debug;
    }

    isMode(mode) {
        return mode === this.modes.normal || mode === this.modes.wide ||
            mode === this.modes.maximized;
    }

    column() {
        const appState = this.getAppState();
        if (appState.presentation.mode === this.modes.normal ||
                !appState.presentation.windowUuid) return null;
        return appState.columns.find(column =>
            this.normalizeUuid(column.window.internalId) ===
                appState.presentation.windowUuid) || null;
    }

    wideRect() {
        const safeRect = this.getAppState().safeRect;
        const width = Math.max(1, Math.min(
            safeRect.width,
            Math.round(safeRect.width * this.wideRatio)
        ));
        return {
            x: safeRect.x + Math.floor((safeRect.width - width) / 2),
            y: safeRect.y,
            width,
            height: safeRect.height,
        };
    }

    rect() {
        const appState = this.getAppState();
        return appState.presentation.mode === this.modes.wide
            ? this.wideRect()
            : this.rectCopy(appState.safeRect);
    }

    resetPresentedWindowLayoutState() {
        const column = this.column();
        if (!column) return false;
        const windowState = this.stateFor(column.window);
        if (windowState.layoutMode !== this.maximizeLayoutMode) return false;
        this.setLayoutMode(windowState, this.normalLayoutMode);
        windowState.pendingAction = null;
        return true;
    }

    clear() {
        const appState = this.getAppState();
        this.resetPresentedWindowLayoutState();
        appState.presentation.windowUuid = null;
        appState.presentation.mode = this.modes.normal;
    }

    selectPersistent(column) {
        const appState = this.getAppState();
        const oldWindowUuid = appState.presentation.windowUuid;
        const oldMode = appState.presentation.mode;
        this.clear();
        if (column && column.persistentWide) {
            appState.presentation.windowUuid =
                this.normalizeUuid(column.window.internalId);
            appState.presentation.mode = this.modes.wide;
        }
        return oldWindowUuid !== appState.presentation.windowUuid ||
            oldMode !== appState.presentation.mode;
    }

    setMode(windowUuid, mode, reason) {
        if (!this.isMode(mode)) return false;
        const appState = this.getAppState();
        const normalizedUuid = this.normalizeUuid(windowUuid);
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === normalizedUuid);
        if (!column || column.window.output !== appState.targetOutput) return false;

        this.cancelPendingDockScroll(reason);
        this.cancelPendingWideTransition(reason);
        this.resetPresentedWindowLayoutState();

        const oldScrollOffsetX = appState.scrollOffsetX;
        this.focusColumn(column);
        this.recomputeLogicalLayout();
        this.ensureColumnVisible(column);

        const targetState = this.stateFor(column.window);
        targetState.internalChange = true;
        try {
            column.window.setMaximize(false, false);
        } finally {
            targetState.internalChange = false;
        }

        if (mode === this.modes.normal) {
            column.persistentWide = false;
            appState.presentation.windowUuid = null;
            appState.presentation.mode = this.modes.normal;
        } else {
            if (mode === this.modes.wide) column.persistentWide = true;
            appState.presentation.windowUuid = normalizedUuid;
            appState.presentation.mode = mode;
            if (mode === this.modes.maximized) {
                targetState.internalChange = true;
                try {
                    this.setLayoutMode(targetState, this.maximizeLayoutMode);
                    targetState.pendingAction = null;
                } finally {
                    targetState.internalChange = false;
                }
            }
        }

        this.relayout(reason, {
            oldScrollOffsetX,
            newScrollOffsetX: appState.scrollOffsetX,
        });
        if (this.getActiveWindow() !== column.window) {
            this.setActiveWindow(column.window);
        }
        this.debug(`[cc-presentation] SET mode=${mode} uuid=${normalizedUuid}` +
            ` reason=${reason}`);
        this.commitDockState(reason);
        return true;
    }
}

/* cjs:start */
module.exports = { PresentationController };
/* cjs:end */
