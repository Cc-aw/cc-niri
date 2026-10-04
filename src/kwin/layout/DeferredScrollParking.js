"use strict";

// Completion is polled from the native owner, never inferred from animation time.
// Timers and replies belong to one session/workspace/output/epoch. A watchdog
// disarms before parking if the owner or endpoint disappears.
class DeferredScrollParking {
    constructor(options) { Object.assign(this, options); this.pending = null; }
    sameContext(context) {
        const current = this.context();
        return ["sessionId", "workspaceId", "targetOutput"].every(key => current[key] === context[key]);
    }
    start(epoch, items) {
        this.cancel();
        const pending = { epoch, items, context: this.context(), timer: null, watchdog: null, rescue: null };
        this.pending = pending;
        items.forEach(item => { this.stateFor(item.column.window).scrollPendingParkEpoch = epoch; });
        const poll = () => {
            if (this.pending !== pending) return;
            if (!this.sameContext(pending.context)) { this.cancel(); return; }
            try {
                this.status(json => {
                    if (this.pending !== pending) return;
                    let status;
                    try { status = JSON.parse(String(json)); } catch (_) { status = null; }
                    if (status && this.sameContext(pending.context) &&
                            ["sessionId", "workspaceId", "targetOutput"].every(key => status[key] === pending.context[key]) &&
                            status.epoch === epoch && status.completed === true && status.active === true) {
                        this.cancel();
                    } else {
                        pending.timer = this.setTimer(poll, 32);
                    }
                });
            } catch (_) { pending.timer = this.setTimer(poll, 32); }
        };
        pending.timer = this.setTimer(poll, 32);
        pending.watchdog = this.setTimer(() => {
            if (this.pending !== pending) return;
            this.warn(`[SCROLL_PLAN] completion timeout epoch=${epoch}`);
            // Cancel ACK clears projection before a fallback parks real windows.
            pending.rescue = this.setTimer(() => { if (this.pending === pending) this.cancel(); }, 150);
            try { this.disarm(epoch, () => { if (this.pending === pending) this.cancel(); }); }
            catch (_) { /* The bounded rescue handles an unavailable endpoint. */ }
        }, 3500);
    }
    cancel(disarm = true) {
        const pending = this.pending;
        if (!pending) return;
        this.pending = null;
        if (pending.timer) this.clearTimer(pending.timer);
        if (pending.watchdog) this.clearTimer(pending.watchdog);
        if (pending.rescue) this.clearTimer(pending.rescue);
        pending.items.forEach(item => {
            const state = this.getState ? this.getState(item.column.window) : this.stateFor(item.column.window);
            if (!state) return;
            if (state.scrollPendingParkEpoch !== pending.epoch) return;
            state.scrollPendingParkEpoch = null;
            if (this.sameContext(pending.context) && this.isCurrent(item.column) &&
                    state.managedByScrollLayout && !state.floating && !item.column.window.fullScreen) {
                this.finalize(item);
            }
        });
        if (disarm) {
            try { this.disarm(pending.epoch, () => {}); } catch (_) { /* Layout can continue. */ }
        }
    }
}

/* cjs:start */
module.exports = { DeferredScrollParking };
/* cjs:end */
