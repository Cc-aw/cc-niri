"use strict";

class LayoutTransaction {
    constructor(options) {
        this.audit = options.audit;
        this.debug = options.debug;
        this.depth = 0;
        this.epoch = 0;
        this.activeReason = "";
    }

    begin(reason) {
        if (this.depth === 0) {
            this.epoch += 1;
            this.activeReason = reason;
            this.debug(`[cc-stability] BEGIN epoch=${this.epoch} reason=${reason}`);
        }
        this.depth += 1;
        return this.epoch;
    }

    end(reason, epoch) {
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth !== 0) return;
        this.audit(reason, epoch);
        this.debug(`[cc-stability] END epoch=${epoch} reason=${this.activeReason}`);
        this.activeReason = "";
    }

    run(reason, callback) {
        const epoch = this.begin(reason);
        try {
            return callback(epoch);
        } finally {
            this.end(reason, epoch);
        }
    }

    isActive() {
        return this.depth > 0;
    }

    currentEpoch() {
        return this.epoch;
    }
}

/* cjs:start */
module.exports = { LayoutTransaction };
/* cjs:end */
