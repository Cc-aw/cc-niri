"use strict";

class DynamicWorkspaceController {
    constructor(options) {
        Object.assign(this, options);
        this.enabled = options.enabled === true;
        this.timer = null;
        this.pendingTopology = null;
        this.failedTopology = null;
        this.stopped = false;
    }

    request() {
        if (!this.enabled || this.stopped || !this.isReady() || this.timer) return false;
        // Retain no Window QObject across this deferred occupancy check.
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.reconcile();
        }, 100);
        return true;
    }

    desktopIds() {
        const desktops = this.getDesktops();
        const ids = [];
        for (let index = 0; index < desktops.length; ++index) ids.push(desktops[index].id);
        return ids;
    }

    occupies(window, desktopId, output) {
        if (!window || !window.managed || window.output !== output || isPlasmaShellWindow(window) ||
                window.desktopWindow || window.dock || window.popupWindow || window.dropdownMenu ||
                window.menu || window.splash || this.membership.isSticky(window)) return false;
        const application = window.normalWindow || window.dialog || window.modal || window.transient ||
            window.utility || window.toolbar;
        return Boolean(application && this.membership.desktopIds(window).includes(desktopId));
    }

    fail(key, reason) {
        this.pendingTopology = null;
        this.failedTopology = key;
        this.warn(`[cc-workspace] trailing desktop unavailable: ${reason}`);
    }

    reconcile() {
        if (!this.enabled || this.stopped) return false;
        const ids = this.desktopIds();
        if (!ids.length || ids.some(id => typeof id !== "string" || !id)) return false;
        const key = JSON.stringify(ids);
        if (this.pendingTopology !== null) {
            if (this.pendingTopology === key) {
                this.fail(key, "creation not confirmed by KDE");
                return false;
            }
            this.pendingTopology = null;
        }
        if (!this.isReady() || this.failedTopology === key) return false;
        const output = this.getTargetOutput();
        if (!output) return false;
        const windows = this.getWindows();
        let occupied = false;
        for (let index = 0; index < windows.length; ++index) {
            if (this.occupies(windows[index], ids[ids.length - 1], output)) { occupied = true; break; }
        }
        if (!occupied) return false;
        if (typeof this.createDesktop !== "function") {
            this.fail(key, "createDesktop API missing");
            return false;
        }
        // Arm before calling KWin: desktopsChanged may be synchronous. A no-op
        // at the native desktop limit is warned once per topology, never retried.
        this.pendingTopology = key;
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.reconcile();
        }, 1000);
        try {
            this.createDesktop(ids.length, "");
        } catch (error) {
            this.clearTimer(this.timer);
            this.timer = null;
            this.fail(key, String(error));
            return false;
        }
        return true;
    }

    stop() {
        this.stopped = true;
        if (this.timer) this.clearTimer(this.timer);
        this.timer = null;
        this.pendingTopology = null;
    }
}

/* cjs:start */
const { isPlasmaShellWindow } = require("../policy/WindowPolicy");
module.exports = { DynamicWorkspaceController };
/* cjs:end */
