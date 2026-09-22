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
            direction: options.direction ||
                (Number(options.deltaX) > 0 ? "left" :
                    (Number(options.deltaX) < 0 ? "right" : "none")),
            oldScrollOffsetX: options.oldScrollOffsetX === undefined
                ? null : Number(options.oldScrollOffsetX),
            newScrollOffsetX: options.newScrollOffsetX === undefined
                ? null : Number(options.newScrollOffsetX),
            viewport: options.viewport ? Object.assign({}, options.viewport) : null,
            continuing: [],
            incoming: [],
            outgoing: [],
            roleByWindow: new Map(),
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
                direction: options.direction,
                oldScrollOffsetX: options.oldScrollOffsetX,
                newScrollOffsetX: options.newScrollOffsetX,
                viewport: options.viewport,
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
        const previousRole = transaction.roleByWindow.get(window);
        if (previousRole && previousRole !== role) {
            transaction[previousRole] = transaction[previousRole]
                .filter(item => item !== window);
        }
        if (transaction[role].indexOf(window) < 0) transaction[role].push(window);
        transaction.roleByWindow.set(window, role);
        return true;
    }

    roleFor(window) {
        const transaction = this.activeTransaction;
        return transaction ? transaction.roleByWindow.get(window) || null : null;
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

    complete(id) {
        if (!this.activeTransaction || this.activeTransaction.id !== id) return null;
        return this.clear();
    }
}

/* cjs:start */
module.exports = { MotionTransaction };
/* cjs:end */
