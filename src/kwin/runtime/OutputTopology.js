"use strict";

/* cjs:start */
const { createScrollLayoutGeometry } = require("../layout/ContinuousColumnLayout");
/* cjs:end */

class OutputTopology {
    constructor(options) {
        this.getScreens = options.getScreens;
        this.getWindows = options.getWindows || (() => []);
        this.config = options.config;
        this.computeSafeRect = options.computeSafeRect;
        this.getWorkingArea = options.getWorkingArea;
        this.warn = options.warn;
        this.warnedMissingPrimary = false;
        this.warnedMissingSecondary = false;
    }

    ordered() {
        return this.getScreens().slice().sort((a, b) =>
            a.geometry.x === b.geometry.x
                ? a.geometry.y - b.geometry.y
                : a.geometry.x - b.geometry.x
        );
    }

    primary() {
        const outputs = this.ordered();
        if (!outputs.length) return null;
        if (this.config.targetOutputName) {
            const configured = outputs.find(output =>
                output.name === this.config.targetOutputName);
            if (configured) {
                this.warnedMissingPrimary = false;
                return configured;
            }
            if (!this.warnedMissingPrimary) {
                this.warn(`configured output ${this.config.targetOutputName}` +
                    " not found; using leftmost output");
                this.warnedMissingPrimary = true;
            }
        }
        return outputs[0];
    }

    secondary() {
        if (!this.config.manageSecondaryOutput) return null;
        const primary = this.primary();
        const candidates = this.ordered().filter(output => output !== primary);
        if (!candidates.length) return null;
        if (this.config.secondaryOutputName) {
            const configured = candidates.find(output =>
                output.name === this.config.secondaryOutputName);
            if (configured) {
                this.warnedMissingSecondary = false;
                return configured;
            }
            if (!this.warnedMissingSecondary) {
                this.warn(`configured secondary output ${this.config.secondaryOutputName}` +
                    " not found; using rightmost non-primary output");
                this.warnedMissingSecondary = true;
            }
        }
        return candidates[candidates.length - 1];
    }

    profile(output) {
        if (!output) return null;
        const primary = this.primary();
        if (output === primary) {
            const gaps = this.config.primary;
            return {
                role: "primary", output,
                top: gaps.top, bottom: gaps.bottom,
                left: gaps.left, right: gaps.right, inner: gaps.inner,
            };
        }
        const secondary = this.secondary();
        if (output === secondary) {
            const gaps = this.config.secondary;
            return {
                role: "secondary", output,
                top: gaps.top, bottom: gaps.bottom,
                left: gaps.left, right: gaps.right, inner: gaps.inner,
            };
        }
        return null;
    }

    managed() {
        const outputs = [this.primary(), this.secondary()].filter(Boolean);
        return outputs.filter((output, index) => outputs.indexOf(output) === index);
    }

    safeRect(output) {
        const profile = this.profile(output);
        return profile ? this.computeSafeRect(output.geometry, profile) : null;
    }

    panelRects(output, desktop) {
        return this.getWindows().filter(window => window.dock && !window.deleted && !window.hidden &&
            !window.minimized && window.opacity !== 0 && (!window.output || window.output === output) &&
            (!desktop || window.onAllDesktops || !window.desktops || !window.desktops.length ||
                Array.from(window.desktops).some(owner => String(owner.id) === String(desktop.id))))
            .map(window => window.frameGeometry);
    }

    // Keep official struts and visible full-edge overlay bars separate from gap.
    v2Geometry(output, desktop) {
        if (!this.config.scrollLayoutV2Enabled || !output || output !== this.primary()) return null;
        let workingArea;
        if (this.getWorkingArea) {
            try { workingArea = this.getWorkingArea(output, desktop); }
            catch (_error) { /* Use the conservative, panel-safe profile below. */ }
        }
        try {
            return createScrollLayoutGeometry({ outputRect: output.geometry, workingArea,
                fallbackRect: this.safeRect(output), panelRects: this.panelRects(output, desktop), gap: this.config.scrollLayoutGap,
                topGap: this.config.scrollLayoutTopGap,
                physicalScale: output.devicePixelRatio || output.scale });
        } catch (_error) {
            return null; // No trustworthy output/area means no V2 layout.
        }
    }
}

/* cjs:start */
module.exports = { OutputTopology };
/* cjs:end */
