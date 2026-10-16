"use strict";

/* cjs:start */
const { normalizeColumnWidthMode, normalizePreviousNonFullWidthMode } = require("../model/ColumnStore");
/* cjs:end */

class ColumnWidthController {
    constructor(options) {
        Object.assign(this, options);
        this.scrollLayoutV2Enabled = options.scrollLayoutV2Enabled === true;
    }

    activeColumn() {
        const state = this.getAppState();
        const window = this.getActiveWindow();
        if (!state.enabled || state.workspaceSwitching || !window || window.fullScreen ||
                window.output !== state.targetOutput) return null;
        return state.columns.find(column => column.window === window) || null;
    }

    apply(column, widthMode, reason) {
        widthMode = normalizeColumnWidthMode(widthMode, this.scrollLayoutV2Enabled);
        if (this.scrollLayoutV2Enabled && this.applyV2Width) {
            return this.applyV2Width(column, widthMode, reason);
        }
        // Capture the real pair before changing strip widths. The existing
        // presentation transaction owns only the paint/parking handoff.
        const transition = this.captureLayout(column);
        this.cancelPending(reason);
        this.clearPresentation();
        const previous = column.widthMode === "full"
            ? column.previousNonFullWidthMode : column.widthMode;
        column.widthMode = widthMode;
        column.previousNonFullWidthMode = normalizePreviousNonFullWidthMode(
            previous, widthMode, this.scrollLayoutV2Enabled);
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
        const widthMode = this.scrollLayoutV2Enabled
            ? ({ half: "twoThirds", twoThirds: "full", full: "half" })[column.widthMode] || "half"
            : column.widthMode === "full" ? "half" : "full";
        return this.apply(column, widthMode, "cycle-column-width");
    }

    toggleFull() {
        const column = this.activeColumn();
        if (!column) return false;
        const widthMode = column.widthMode === "full"
            ? normalizePreviousNonFullWidthMode(column.previousNonFullWidthMode,
                "full", this.scrollLayoutV2Enabled) : "full";
        return this.apply(column, widthMode, "toggle-column-full");
    }
}

/* cjs:start */
module.exports = { ColumnWidthController };
/* cjs:end */
