"use strict";

// Native ACK means continuing/incoming ownership is installed before geometry changes.
// Each callback is scoped to a layout epoch; a timeout also disarms that epoch.
class ScrollPlanCommitGate {
    constructor(options) { Object.assign(this, options); this.pending = null; this.activeEpoch = null; }
    abort(epoch, callback = () => {}) {
        try { this.disarm(epoch, callback); } catch (error) {
            this.warn(`[SCROLL_PLAN] disarm unavailable ${error}`); callback();
        }
    }
    cancel() {
        if (this.cancelDeferred) this.cancelDeferred();
        const pending = this.pending;
        this.pending = null;
        if (pending) { this.clearTimer(pending.timer); this.abort(pending.plan.epoch); }
        if (this.activeEpoch !== null) { this.abort(this.activeEpoch); this.activeEpoch = null; }
    }
    schedule(plan, envelope, context) {
        if (this.pending) {
            this.clearTimer(this.pending.timer);
            this.abort(this.pending.plan.epoch);
        }
        const pending = { plan, envelope, context, activationWindow: null, timer: null };
        this.pending = pending;
        const commit = () => {
            if (this.pending !== pending) return;
            this.pending = null;
            this.clearTimer(pending.timer);
            if (this.currentEpoch() !== plan.epoch) { this.abort(plan.epoch); return; }
            this.commit(plan, Object.assign({}, context, { nativeScroll: Boolean(pending.nativeAccepted) }), pending.activationWindow);
        };
        const finish = accepted => {
            if (this.pending !== pending || pending.fallback) return;
            this.clearTimer(pending.timer);
            if (this.currentEpoch() !== plan.epoch) {
                this.pending = null; this.abort(plan.epoch); return;
            }
            if (accepted) { pending.nativeAccepted = true; this.activeEpoch = plan.epoch; commit(); return; }
            this.activeEpoch = null;
            pending.fallback = true;
            this.warn(`[SCROLL_PLAN] native fallback epoch=${plan.epoch}`);
            // Normally wait for native ownership removal before legacy geometry
            // signals fire. An unavailable endpoint cannot block layout forever.
            pending.timer = this.setTimer(commit, this.timeoutMs);
            this.abort(plan.epoch, commit);
        };
        pending.timer = this.setTimer(() => finish(false), this.timeoutMs);
        try {
            this.publish(envelope, accepted => {
                if (this.pending !== pending || pending.fallback) return;
                if (!accepted || this.currentEpoch() !== plan.epoch) { finish(false); return; }
                try { this.arm(envelope, finish); } catch (error) { finish(false); }
            });
        } catch (error) { finish(false); }
    }
    deferActivation(window) {
        if (!this.pending) return false;
        this.pending.activationWindow = window;
        return true;
    }
}

/* cjs:start */
module.exports = { ScrollPlanCommitGate };
/* cjs:end */
