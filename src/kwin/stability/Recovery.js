"use strict";

class Recovery {
    constructor(options) {
        this.appState = options.appState;
        this.windowStates = options.windowStates;
        this.parking = options.parking;
        this.indexOfWindow = options.indexOfWindow;
        this.beforeRestore = options.beforeRestore;
        this.retire = options.retire || null;
        this.retiring = false;
        this.waitForRestored = options.waitForRestored || null;
        this.onStatus = options.onStatus || (() => {});
        this.status = { state: "running", requestId: null, restoredCount: 0 };
        this.waiting = false;
        this.blocked = false;
        this.debug = options.debug;
        this.warn = options.warn || options.debug;
        this.getWindows = options.getWindows;
        this.getWindowId = options.getWindowId;
        this.obligations = new Map(); // UUID + value DTOs only, never QObject references.
        this.retired = !this.retire;
        this.retryable = false;
        this.restoredCount = 0;
    }

    report(state, restoredCount = 0) {
        this.status = Object.assign({}, this.status, { state, restoredCount });
        this.onStatus(this.status);
    }

    restoreAll(reason, requestId = null) {
        if (this.retiring || this.waiting) return 0;
        this.status = { state: "pending", requestId, restoredCount: 0 };
        this.onStatus(this.status);
        if (this.blocked) {
            if (this.retired && this.retryable) {
                const live = new Map(this.getWindows().map(window => [this.getWindowId(window), window]));
                const rows = [];
                for (const [id, obligation] of this.obligations) {
                    const window = live.get(id);
                    if (window) rows.push(Object.assign({ window }, obligation));
                    else this.obligations.delete(id);
                }
                this.checkRestored(rows, this.restoredCount);
            } else this.report("blocked");
            return 0;
        }
        if (this.retire) {
            if (this.retiring) return 0;
            this.retiring = true;
            this.retire(confirmed => {
                this.retiring = false;
                if (confirmed === true) { this.retired = true; this.restoreReleased(reason); }
                else { this.blocked = true; this.report("blocked"); this.warn(`[cc-stability] RESTORE_BLOCKED native ownership unconfirmed reason=${reason}`); }
            });
            return 0;
        }
        return this.restoreReleased(reason);
    }

    restoreReleased(reason) {
        this.beforeRestore(reason);
        let restored = 0;
        const requests = [];
        this.appState.columns.slice().forEach((column, index) => {
            if (this.parking.release(column.window, reason, true, index, row => requests.push(row))) restored += 1;
        });
        this.windowStates.forEach((_windowState, window) => {
            if (this.indexOfWindow(window) >= 0) return;
            if (this.parking.release(window, reason, true, restored, row => requests.push(row))) restored += 1;
        });
        if (this.waitForRestored) {
            this.retryable = Boolean(this.getWindows && this.getWindowId);
            if (this.retryable) for (const row of requests) {
                this.obligations.set(this.getWindowId(row.window), {
                    target: row.target ? Object.assign({}, row.target) : null,
                    opacity: row.opacity, minimized: row.minimized,
                });
            }
            this.checkRestored(requests, restored);
        } else this.report("restored", restored);
        this.warn(`[cc-stability] EMERGENCY_RESTORE count=${restored} reason=${reason}`);
        return restored;
    }

    checkRestored(requests, restored) {
        this.restoredCount = restored;
        this.waiting = true;
        this.waitForRestored(requests, accepted => {
            this.waiting = false; this.blocked = accepted !== true;
            if (accepted === true) { this.obligations.clear(); this.retryable = false; }
            this.report(accepted ? "restored" : "blocked", restored);
        });
    }

    forgetWindow(window) {
        if (this.getWindowId) this.obligations.delete(this.getWindowId(window));
    }
}

/* cjs:start */
module.exports = { Recovery };
/* cjs:end */
