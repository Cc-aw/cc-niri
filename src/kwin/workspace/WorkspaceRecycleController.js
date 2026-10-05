"use strict";

class WorkspaceRecycleController {
    constructor(options) {
        Object.assign(this, options);
        this.enabled = options.enabled === true;
        this.timer = null;
        this.pendingId = null;
        this.pendingError = null;
        this.confirmedIds = [];
        this.failedTopology = null;
        this.stopped = false;
        this.transitionCheck = null;
        this.transitionAttempts = 0;
    }

    request(retry = false) {
        if (!this.enabled || this.stopped || !this.isReady() || this.timer || this.transitionCheck) return false;
        if (!retry) this.transitionAttempts = 0;
        // The timer retains only this controller; no Window/Desktop QObjects.
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.reconcile();
        }, 200);
        return true;
    }

    onDesktopChanged() {
        // Reject a reply from an earlier switch even if J/K returned to the
        // same desktop UUID. Never keep a Desktop QObject across this barrier.
        if (this.transitionCheck) this.clearTimer(this.transitionCheck.timer);
        this.transitionCheck = null;
        this.transitionAttempts = 0;
    }

    awaitTransitionIdle() {
        if (this.transitionCheck || this.transitionAttempts >= 60) return false;
        const check = { timer: null };
        this.transitionCheck = check;
        ++this.transitionAttempts;
        const finish = active => {
            if (this.stopped || this.transitionCheck !== check) return;
            this.clearTimer(check.timer);
            this.transitionCheck = null;
            if (active === false) {
                // Recompute occupancy, current desktops and candidate now;
                // nothing selected before the asynchronous reply is trusted.
                this.reconcile(true);
            } else if (this.transitionAttempts < 60) {
                this.request(true);
            }
        };
        check.timer = this.setTimer(() => finish(null), 1000);
        try {
            if (typeof this.transitionStatus !== "function") { finish(null); return false; }
            this.transitionStatus(finish);
        } catch (_error) { finish(null); }
        return true;
    }

    fail(key, reason) {
        this.pendingId = null;
        this.failedTopology = key;
        this.warn(`[cc-workspace] recycle unavailable: ${reason}`);
    }

    reconcile(compositorIdle = false) {
        if (!this.enabled || this.stopped) return false;
        let ids = this.getDesktopIds();
        if (!ids.length || ids.some(id => typeof id !== "string" || !id)) return false;
        let key = JSON.stringify(ids);
        if (this.pendingId !== null) {
            if (ids.includes(this.pendingId)) {
                this.fail(key, this.pendingError || "removal not confirmed by KDE");
                return false;
            }
            this.confirmedIds.push(this.pendingId);
            this.pendingId = null;
            this.pendingError = null;
        }
        if (!this.isReady()) return false;
        this.ensureVerticalLayout(ids.length);
        while (this.confirmedIds.length) {
            try {
                this.onRemoved(this.confirmedIds.shift());
            } catch (error) {
                this.stop();
                this.warn(`[cc-workspace] recycle cleanup failed: ${error}`);
                if (this.onFailure) this.onFailure(error);
                return false;
            }
            if (this.stopped || !this.isReady()) return false;
        }
        ids = this.getDesktopIds();
        if (!ids.length || ids.some(id => typeof id !== "string" || !id)) return false;
        key = JSON.stringify(ids);
        if (ids.length === 1 || this.failedTopology === key) return false;
        const protectedIds = this.getProtectedIds();
        if (!protectedIds.length || protectedIds.some(id => !id)) return false;
        const owners = this.occupancy.recyclingOwners(this.getWindows());
        if (!owners) return false;
        // Current desktops stay even when empty. Keep the last desktop so W8
        // creation and recycling cannot alternate deleting/creating the tail.
        const id = ids.slice(0, -1).find(value => !protectedIds.includes(value) && !owners.has(value));
        if (!id) return false;
        if (!compositorIdle) return this.awaitTransitionIdle();
        if (typeof this.removeDesktop !== "function") {
            this.fail(key, "removeDesktop API missing");
            return false;
        }
        this.pendingId = id;
        this.pendingError = null;
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.reconcile();
        }, 1000);
        try {
            // The injected adapter resolves a live Desktop only at this call.
            this.removeDesktop(id);
            if (!this.stopped) this.ensureVerticalLayout(this.getDesktopIds().length);
        } catch (error) {
            // Native code can remove then raise. Confirm actual topology before
            // deciding whether cleanup or a once-per-topology failure is due.
            if (!this.stopped) this.pendingError = String(error);
            return false;
        }
        return true;
    }

    stop() {
        this.stopped = true;
        this.onDesktopChanged();
        if (this.timer) this.clearTimer(this.timer);
        this.timer = null;
        this.pendingId = null;
        this.pendingError = null;
        this.confirmedIds = [];
    }
}

/* cjs:start */
module.exports = { WorkspaceRecycleController };
/* cjs:end */
