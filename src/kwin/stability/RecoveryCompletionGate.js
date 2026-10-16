"use strict";

// Event-driven proof of restored KWin frames/visibility. No paint sampling,
// geometry authority or persistent window references after completion/timeout.
class RecoveryCompletionGate {
    constructor(options) { Object.assign(this, options); this.pending = null; }

    wait(requests, done) {
        if (this.pending) { done(false); return; }
        const pending = { rows: new Set(requests), disposers: [], timer: null };
        this.pending = pending;
        const finish = (accepted, reason = "observer-error") => {
            if (this.pending !== pending) return;
            this.pending = null;
            if (pending.timer) this.clearTimer(pending.timer);
            pending.disposers.splice(0).forEach(dispose => { try { dispose(); } catch (_error) { /* destroyed */ } });
            if (!accepted && this.warn) {
                // One bounded failure report, never per-frame diagnostics.
                try {
                    const live = this.getWindows(), details = [];
                    for (const row of pending.rows) {
                        if (details.length >= 8) break;
                        if (!live.includes(row.window)) continue;
                        try {
                            details.push({ windowId: this.getWindowId(row.window), target: row.target,
                                actual: row.window.frameGeometry, opacity: Number(row.window.opacity),
                                expectedOpacity: row.opacity, minimized: row.window.minimized, expectedMinimized: row.minimized });
                        } catch (_error) { /* destroyed */ }
                    }
                    this.warn(`[cc-stability] RESTORE_ACK_FAILED reason=${reason} clients=${pending.rows.size} details=${JSON.stringify(details)}`);
                } catch (_error) { /* diagnostics must not interrupt proof cleanup */ }
            }
            pending.rows.clear();
            done(accepted);
        };
        const check = () => {
            if (this.pending !== pending) return;
            const windows = this.getWindows();
            for (const row of pending.rows) {
                if (!windows.includes(row.window)) continue;
                try {
                    if (row.target && !this.sameRect(row.window.frameGeometry, row.target)) return;
                    if (!Number.isFinite(Number(row.window.opacity)) || !Number.isFinite(row.opacity) ||
                            Math.abs(Number(row.window.opacity) - row.opacity) > 0.000001 ||
                            row.window.minimized !== row.minimized) return;
                } catch (_error) { finish(false); return; }
            }
            finish(true);
        };
        try {
            for (const row of requests) {
                const window = row.window;
                if (!this.getWindows().includes(window)) continue;
                for (const signal of [window.frameGeometryChanged, window.opacityChanged, window.minimizedChanged]) {
                    if (!signal || !signal.connect) continue;
                    signal.connect(check); pending.disposers.push(() => signal.disconnect(check));
                }
                const closed = () => { pending.rows.delete(row); check(); };
                window.closed.connect(closed); pending.disposers.push(() => window.closed.disconnect(closed));
            }
            pending.timer = this.setTimer(() => finish(false, "deadline"), this.timeoutMs || 3500);
            check();
        } catch (_error) { finish(false); }
    }
}

/* cjs:start */
module.exports = { RecoveryCompletionGate };
/* cjs:end */
