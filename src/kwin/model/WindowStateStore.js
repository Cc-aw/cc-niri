"use strict";

class WindowStateStore {
    constructor(createState) {
        this.createState = createState;
        this.states = new Map();
    }

    has(window) {
        return this.states.has(window);
    }

    get(window) {
        return this.states.get(window);
    }

    ensure(window) {
        let state = this.states.get(window);
        if (!state) {
            state = this.createState(window);
            this.states.set(window, state);
        }
        return state;
    }

    delete(window) {
        return this.states.delete(window);
    }

    forEach(callback) {
        this.states.forEach(callback);
    }
}

/* cjs:start */
module.exports = { WindowStateStore };
/* cjs:end */
