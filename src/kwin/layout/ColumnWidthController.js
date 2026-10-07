"use strict";

/* cjs:start */
const { normalizePreviousNonFullWidthMode } = require("../model/ColumnStore");
/* cjs:end */

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
        const previous = column.widthMode === "full"
            ? normalizePreviousNonFullWidthMode(column.previousNonFullWidthMode, "full")
            : normalizePreviousNonFullWidthMode(column.widthMode, "half");
        // Width changes replace strip geometry. Retire old motion ownership and
        // presentations before committing a new layout, keeping Wide preference.
        this.cancelPending(reason);
        this.clearPresentation();
        column.widthMode = widthMode;
        column.previousNonFullWidthMode = widthMode === "full" ? previous : widthMode;
        this.focusColumn(column);
        this.recomputeLogicalLayout();
        this.ensureColumnVisible(column);
        this.relayout(reason);
        this.commitState(reason);
        return true;
    }

    cycle() {
        const column = this.activeColumn();
        if (!column) return false;
        const modes = ["third", "half", "twoThirds", "full"];
        const index = modes.indexOf(column.widthMode);
        return this.apply(column, modes[(index + 1) % modes.length], "cycle-column-width");
    }

    toggleFull() {
        const column = this.activeColumn();
        if (!column) return false;
        const widthMode = column.widthMode === "full"
            ? normalizePreviousNonFullWidthMode(column.previousNonFullWidthMode, "full") : "full";
        return this.apply(column, widthMode, "toggle-column-full");
    }
}

/* cjs:start */
module.exports = { ColumnWidthController };
/* cjs:end */
