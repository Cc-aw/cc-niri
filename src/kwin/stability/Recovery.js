"use strict";

class Recovery {
    constructor(options) {
        this.appState = options.appState;
        this.windowStates = options.windowStates;
        this.parking = options.parking;
        this.indexOfWindow = options.indexOfWindow;
        this.beforeRestore = options.beforeRestore;
        this.debug = options.debug;
    }

    restoreAll(reason) {
        this.beforeRestore(reason);
        let restored = 0;
        this.appState.columns.forEach((column, index) => {
            if (this.parking.release(column.window, reason, true, index)) restored += 1;
        });
        this.windowStates.forEach((_windowState, window) => {
            if (this.indexOfWindow(window) >= 0) return;
            if (this.parking.release(window, reason, true, restored)) restored += 1;
        });
        this.debug(`[cc-stability] EMERGENCY_RESTORE count=${restored} reason=${reason}`);
        return restored;
    }
}

/* cjs:start */
module.exports = { Recovery };
/* cjs:end */
