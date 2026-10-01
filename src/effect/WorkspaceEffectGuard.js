"use strict";

/* cjs:start */
const { CC_NIRI_VIEWPORT_CLIP_ROLE, CC_NIRI_MOTION_PLAN_ROLE, CC_NIRI_MOTION_COMPLETE_ROLE } = require("./MotionTokens");
/* cjs:end */

class WorkspaceEffectGuard {
    constructor(options) {
        Object.assign(this, options);
        this.epoch = 0;
        this.clearing = false;
    }

    canAnimate(window) {
        return !this.clearing && window && window.onCurrentDesktop !== false;
    }

    onDesktopChanged(_previous, _current, _with, output) {
        if (output && !this.affectsOutput(output)) return false;
        if (this.clearing) return false;
        this.clearing = true;
        ++this.epoch;
        try {
            const windows = new Set(this.motion.states.keys());
            const stacking = this.getWindows();
            for (let index = 0; index < stacking.length; ++index) windows.add(stacking[index]);
            this.motionTransaction.clear();
            this.clearTemporaryState();
            this.motion.cancelAll();
            this.releaseIsolation("workspace-switch");
            this.parkingGrabber.releaseAll("workspace-switch");
            windows.forEach(window => {
                if (!window) return;
                this.motion.cancel(window); // Also cancel orphaned legacy IDs.
                delete window.ccNiriScrollAnimation;
                delete window.ccNiriIncomingVisual;
                if (typeof window.setData === "function") {
                    window.setData(CC_NIRI_VIEWPORT_CLIP_ROLE, null);
                    window.setData(CC_NIRI_MOTION_PLAN_ROLE, null);
                    window.setData(CC_NIRI_MOTION_COMPLETE_ROLE, null);
                }
            });
            this.repaint();
            this.debug(`[WORKSPACE_EFFECT] clear epoch=${this.epoch}`);
            return true;
        } finally {
            this.clearing = false;
        }
    }
}

/* cjs:start */
module.exports = { WorkspaceEffectGuard };
/* cjs:end */
