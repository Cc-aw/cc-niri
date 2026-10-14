"use strict";

// Native ACK means continuing/incoming ownership is installed before geometry changes.
// Each callback is scoped to a layout epoch; a timeout also disarms that epoch.
class ScrollPlanCommitGate {
    constructor(options) {
        Object.assign(this, options);
        this.pending = null; this.activeEpoch = null;
        this.disarming = new Set(); this.idleCallbacks = [];
        this.retainedEpochs = new Set();
    }
    abort(epoch, callback = () => {}) {
        const request = { epoch, timer: null };
        this.disarming.add(request);
        const finish = () => {
            if (!this.disarming.delete(request)) return;
            this.clearTimer(request.timer);
            try { callback(); } finally {
                if (!this.disarming.size) this.idleCallbacks.splice(0).forEach(fn => fn());
            }
        };
        // A disconnected endpoint must not retain historical requests forever.
        // This is the same finite ACK deadline used by visible fallback commits.
        request.timer = this.setTimer(finish, this.timeoutMs);
        try { this.disarm(epoch, finish); } catch (error) {
            this.warn(`[SCROLL_PLAN] disarm unavailable ${error}`); finish();
        }
    }
    whenIdle(callback) {
        if (!this.disarming.size) { callback(); return () => {}; }
        this.idleCallbacks.push(callback);
        return () => {
            const index = this.idleCallbacks.indexOf(callback);
            if (index >= 0) this.idleCallbacks.splice(index, 1);
        };
    }
    commitWhenDisarmed(plan, context, offset) {
        // Reindexing cannot share the old strip projection. Wait for its cancel
        // ACK, with the existing protocol timeout as a visible geometry fallback.
        // This timer gates a commit; it never samples or interpolates motion.
        const pending = { plan, context, envelope: { oldScrollOffsetX: offset },
            activationWindow: null, staticFallback: true, timer: null, cancelIdle: null };
        this.pending = pending;
        const finish = () => {
            if (this.pending !== pending) return;
            this.pending = null;
            this.clearTimer(pending.timer);
            if (pending.cancelIdle) pending.cancelIdle();
            if (this.currentEpoch() === plan.epoch)
                this.commit(plan, context, pending.activationWindow);
        };
        pending.timer = this.setTimer(finish, this.timeoutMs);
        pending.cancelIdle = this.whenIdle(finish);
    }
    releaseForWorkspace() {
        if (this.pending) {
            this.clearTimer(this.pending.timer);
            if (this.pending.cancelIdle) this.pending.cancelIdle();
            this.pending = null;
        }
        this.activeEpoch = null;
        this.retainedEpochs.clear();
        if (this.releaseDeferred) this.releaseDeferred();
    }
    retainForLegacy() {
        // Keep the old viewport until Native has observed the replacement
        // Pair/Wide plan. Retire its epochs only after that publish ACK.
        if (this.releaseDeferred) this.releaseDeferred();
        if (this.pending) {
            this.clearTimer(this.pending.timer);
            if (this.pending.cancelIdle) this.pending.cancelIdle();
            this.retainedEpochs.add(this.pending.plan.epoch);
            this.pending = null;
        }
    }
    cancel() {
        if (this.cancelDeferred) this.cancelDeferred();
        const pending = this.pending;
        this.pending = null;
        if (pending) {
            this.clearTimer(pending.timer);
            if (pending.cancelIdle) pending.cancelIdle();
            this.retainedEpochs.add(pending.plan.epoch);
        }
        if (this.activeEpoch !== null) this.retainedEpochs.add(this.activeEpoch);
        this.activeEpoch = null;
        const epochs = [...this.retainedEpochs];
        this.retainedEpochs.clear();
        epochs.forEach(epoch => this.abort(epoch));
    }
    schedule(plan, envelope, context) {
        if (this.pending) {
            this.clearTimer(this.pending.timer);
            if (this.pending.cancelIdle) this.pending.cancelIdle();
            // The newer arm supersedes ownership. Do not cancel an in-flight
            // arm here: its last painted sample is the next Spring origin.
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
        const prepared = accepted => {
            if (this.pending !== pending || pending.fallback) return;
            if (!accepted) { finish(false); return; }
            try { this.publish(envelope, published => {
                if (this.pending !== pending || pending.fallback) return;
                if (!published || this.currentEpoch() !== plan.epoch) { finish(false); return; }
                try { this.arm(envelope, finish); } catch (error) { finish(false); }
            }); } catch (error) { finish(false); }
        };
        try {
            if (this.prepare) this.prepare(context, prepared);
            else prepared(true);
        } catch (error) { finish(false); }
    }
    baseOffset(offset) {
        if (!this.pending) return offset;
        return this.pending.envelope.type === "COLUMN_REINDEX"
            ? this.pending.envelope.newScrollOffsetX : this.pending.envelope.oldScrollOffsetX;
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
