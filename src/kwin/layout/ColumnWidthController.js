"use strict";

class ColumnWidthController {
    constructor(options) { Object.assign(this, options); }

    activeColumn() {
        const state = this.getAppState();
        const window = this.getActiveWindow();
        if (!state.enabled || state.workspaceSwitching || !window || window.fullScreen ||
                window.output !== state.targetOutput) return null;
        return state.columns.find(column => column.window === window) || null;
    }

    apply(column, widthMode, reason) {
        // Capture the real pair before changing strip widths. The existing
        // presentation transaction owns only the paint/parking handoff.
        const transition = this.captureLayout(column);
        this.cancelPending(reason);
        this.clearPresentation();
        column.widthMode = widthMode;
        column.previousNonFullWidthMode = "half";
        this.focusColumn(column);
        this.recomputeLogicalLayout();
        this.ensureColumnVisible(column);
        this.relayout(reason, undefined, transition);
        this.commitState(reason);
        return true;
    }

    cycle() {
        const column = this.activeColumn();
        if (!column) return false;
        return this.apply(column, column.widthMode === "full" ? "half" : "full", "cycle-column-width");
    }

    toggleFull() {
        const column = this.activeColumn();
        if (!column) return false;
        const widthMode = column.widthMode === "full" ? "half" : "full";
        return this.apply(column, widthMode, "toggle-column-full");
    }
}

/* cjs:start */
module.exports = { ColumnWidthController };
/* cjs:end */
