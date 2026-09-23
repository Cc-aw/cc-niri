"use strict";

class MotionPlanCommitGate {
    constructor(options) {
        this.publish = options.publish;
        this.currentEpoch = options.currentEpoch;
        this.commit = options.commit;
        this.warn = options.warn;
        this.timeoutMs = options.timeoutMs === undefined ? 150 : options.timeoutMs;
        this.setTimer = options.setTimer;
        this.clearTimer = options.clearTimer;
        this.pending = null;
    }

    schedule(plan, envelope, context) {
        this.cancel();
        const pending = { plan, context, activationWindow: null, timer: null };
        this.pending = pending;
        pending.timer = this.setTimer(() => {
            if (this.pending !== pending) return;
            this.clearTimer(pending.timer);
            this.pending = null;
            if (this.currentEpoch() !== plan.epoch) return;
            this.warn(`[MOTION_TX] handoff timeout epoch=${plan.epoch}`);
            this.commit(plan, Object.assign({}, context, {
                motionFallback: true,
            }), pending.activationWindow);
        }, this.timeoutMs);
        this.publish(envelope, accepted => {
            if (this.pending !== pending) return;
            this.clearTimer(pending.timer);
            this.pending = null;
            if (this.currentEpoch() !== plan.epoch) return;
            if (!accepted) {
                this.warn(`[MOTION_TX] plan handoff unavailable epoch=${plan.epoch}`);
            }
            this.commit(plan, context, pending.activationWindow);
        });
        return pending;
    }

    deferActivation(window) {
        if (!this.pending) return false;
        this.pending.activationWindow = window;
        return true;
    }

    cancel() {
        const pending = this.pending;
        this.pending = null;
        if (pending) this.clearTimer(pending.timer);
        return pending;
    }
}

/* cjs:start */
module.exports = { MotionPlanCommitGate };
/* cjs:end */
