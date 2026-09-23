"use strict";

class MotionPlanCommitGate {
    constructor(options) {
        this.publish = options.publish;
        this.currentEpoch = options.currentEpoch;
        this.commit = options.commit;
        this.warn = options.warn;
        this.pending = null;
    }

    schedule(plan, envelope, context) {
        const pending = { plan, context, activationWindow: null };
        this.pending = pending;
        this.publish(envelope, accepted => {
            if (this.pending !== pending) return;
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
        return pending;
    }
}

/* cjs:start */
module.exports = { MotionPlanCommitGate };
/* cjs:end */
