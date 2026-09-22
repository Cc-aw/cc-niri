"use strict";

/* cjs:start */
const { MotionType } = require("./MotionTokens");
/* cjs:end */

class MotionTransaction {
    constructor(ttlMs) {
        this.ttlMs = Math.max(1, Number(ttlMs) || 1);
        this.nextId = 1;
        this.activeTransaction = null;
    }

    begin(options) {
        const now = options.now === undefined ? Date.now() : options.now;
        const id = this.nextId++;
        this.activeTransaction = {
            id,
            layoutEpoch: options.layoutEpoch === undefined ? id : options.layoutEpoch,
            type: options.type || MotionType.SCROLL,
            deltaX: Number(options.deltaX) || 0,
            continuing: [],
            incoming: [],
            outgoing: [],
            armedAt: now,
        };
        if (options.window && options.role) {
            this.record(options.role, options.window);
        }
        return this.activeTransaction;
    }

    arm(deltaX, window, now = Date.now(), options = {}) {
        const current = this.current(now);
        const normalizedDelta = Number(deltaX) || 0;
        const transaction = !current || current.type !== (options.type || MotionType.SCROLL) ||
                Math.abs(current.deltaX - normalizedDelta) >= 1
            ? this.begin({
                deltaX: normalizedDelta,
                type: options.type || MotionType.SCROLL,
                layoutEpoch: options.layoutEpoch,
                now,
            })
            : current;
        transaction.armedAt = now;
        if (window) this.record("continuing", window);
        return transaction;
    }

    record(role, window) {
        const transaction = this.activeTransaction;
        if (!transaction ||
                ["continuing", "incoming", "outgoing"].indexOf(role) < 0) {
            return false;
        }
        if (transaction[role].indexOf(window) < 0) transaction[role].push(window);
        return true;
    }

    current(now = Date.now()) {
        this.expire(now);
        return this.activeTransaction;
    }

    expire(now = Date.now()) {
        const transaction = this.activeTransaction;
        if (!transaction || now - transaction.armedAt <= this.ttlMs) return null;
        this.activeTransaction = null;
        return transaction;
    }

    clear() {
        const transaction = this.activeTransaction;
        this.activeTransaction = null;
        return transaction;
    }
}

/* cjs:start */
module.exports = { MotionTransaction };
/* cjs:end */
