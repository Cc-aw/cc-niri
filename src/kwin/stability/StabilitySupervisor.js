"use strict";

class StabilitySupervisor {
    constructor(options) {
        this.checker = options.checker;
        this.setTimer = options.setTimer;
        this.clearTimer = options.clearTimer;
        this.relayout = options.relayout;
        this.recovery = options.recovery;
        this.disableLayout = options.disableLayout;
        this.isEnabled = options.isEnabled;
        this.warn = options.warn;
        this.debug = options.debug;
        this.verifyDelayMs = options.verifyDelayMs || 250;
        this.settleDelayMs = options.settleDelayMs || 250;
        this.phase = "normal";
        this.pending = null;
        this.failureEpoch = 0;
    }

    clearPending() {
        if (this.pending) this.clearTimer(this.pending);
        this.pending = null;
        this.failureEpoch += 1;
    }

    schedule(callback, delayMs) {
        const token = ++this.failureEpoch;
        this.pending = this.setTimer(() => {
            if (token !== this.failureEpoch || this.phase === "disabled") return;
            this.pending = null;
            callback();
        }, delayMs);
    }

    audit(reason, epoch) {
        if (this.phase === "disabled" || !this.isEnabled()) return true;
        const passed = this.checker.check(reason, epoch);
        if (this.phase === "healing" || this.phase === "recovering") return passed;
        if (passed) {
            if (this.phase === "verify") {
                this.clearPending();
                this.phase = "normal";
            }
            return true;
        }
        if (this.phase !== "verify") {
            this.phase = "verify";
            this.warn(`[cc-stability] INVARIANT_FAIL epoch=${epoch}` +
                ` errors=${this.checker.errors().join(",")}`);
            this.debug(`[cc-stability] VERIFY_PENDING epoch=${epoch}`);
            this.schedule(() => this.verify(epoch), this.verifyDelayMs);
        }
        return false;
    }

    verify(epoch) {
        if (!this.isEnabled()) return this.stop();
        const errors = this.checker.errors();
        if (!errors.length) {
            this.checker.check("delayed-verification", epoch);
            this.phase = "normal";
            return;
        }
        if (errors.some(error => this.isCritical(error))) {
            this.failSafe(epoch, errors);
            return;
        }
        this.phase = "healing";
        this.warn(`[cc-stability] SELF_HEAL epoch=${epoch} errors=${errors.join(",")}`);
        try {
            this.relayout("invariant-self-heal");
        } catch (error) {
            this.failSafe(epoch, [`relayout-error:${error}`]);
            return;
        }
        if (this.phase !== "healing") return;
        this.schedule(() => {
            if (!this.isEnabled()) return this.stop();
            const remaining = this.checker.errors();
            if (remaining.length) {
                this.failSafe(epoch, remaining);
                return;
            }
            this.checker.check("self-heal", epoch);
            this.phase = "normal";
            this.warn(`[cc-stability] SELF_HEAL_RECOVERED epoch=${epoch}`);
        }, this.settleDelayMs);
    }

    isCritical(error) {
        return /^(duplicate-window|duplicate-uuid|state-ownership|wrong-output|invalid-width|invalid-viewport-mode|sticky-managed):/.test(error);
    }

    failSafe(epoch, errors) {
        if (this.phase === "recovering" || this.phase === "disabled") return;
        this.phase = "recovering";
        this.clearPending();
        this.warn(`[cc-stability] FAIL_SAFE epoch=${epoch} errors=${errors.join(",")}`);
        this.disableLayout();
        try {
            this.recovery.restoreAll("invariant-failure");
        } finally {
            this.phase = "disabled";
        }
    }

    stop() {
        if (this.phase === "disabled") return;
        this.clearPending();
        this.phase = "disabled";
    }
}

/* cjs:start */
module.exports = { StabilitySupervisor };
/* cjs:end */
