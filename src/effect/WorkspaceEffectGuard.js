"use strict";

/* cjs:start */
const { CC_NIRI_VIEWPORT_CLIP_ROLE, CC_NIRI_MOTION_PLAN_ROLE, CC_NIRI_MOTION_COMPLETE_ROLE, MotionType } = require("./MotionTokens");
/* cjs:end */

class WorkspaceEffectGuard {
    constructor(options) {
        Object.assign(this, options);
        this.epoch = 0;
        this.clearing = false;
        this.frozenWindows = new Set();
    }

    canAnimate(window) {
        return !this.clearing && window && window.onCurrentDesktop !== false &&
            !this.frozenWindows.has(window);
    }

    forget(window) {
        this.frozenWindows.delete(window);
    }

    onTransitionChanged() {
        if (this.transitionActive() || this.clearing) return;
        this.clearing = true;
        try {
            this.frozenWindows.forEach(window => {
                this.motion.cancel(window);
                this.releaseWindowIsolation(window, "workspace-slide-finished");
            });
            this.frozenWindows.clear();
            this.repaint();
        } finally {
            this.clearing = false;
        }
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
            const preserved = new Set();
            if (this.transitionActive && this.transitionActive()) {
                const now = Date.now();
                for (const [window, state] of this.motion.states) {
                    if (window.onCurrentDesktop === false &&
                            [MotionType.PAIR_TO_WIDE, MotionType.WIDE_TO_PAIR,
                                MotionType.WIDE_ENTER, MotionType.WIDE_EXIT].includes(state.type) &&
                            this.motion.freezeForWorkspace(window, now)) preserved.add(window);
                }
                for (const window of this.getIsolationWindows()) {
                    if (window.onCurrentDesktop === false) preserved.add(window);
                }
            }
            this.motionTransaction.clear();
            this.clearTemporaryState();
            this.releaseIsolation("workspace-switch", preserved);
            this.parkingGrabber.releaseAll("workspace-switch");
            windows.forEach(window => {
                if (!window) return;
                if (!preserved.has(window)) {
                    this.motion.cancel(window); // Also cancel orphaned legacy IDs.
                    delete window.ccNiriScrollAnimation;
                    delete window.ccNiriIncomingVisual;
                }
                if (typeof window.setData === "function") {
                    if (!preserved.has(window)) window.setData(CC_NIRI_VIEWPORT_CLIP_ROLE, null);
                    window.setData(CC_NIRI_MOTION_PLAN_ROLE, null);
                    window.setData(CC_NIRI_MOTION_COMPLETE_ROLE, null);
                }
            });
            this.frozenWindows = preserved;
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
