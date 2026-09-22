"use strict";

class CCNiri {
    constructor(options) {
        this.controllers = options.controllers;
        this.lifecycle = new RuntimeLifecycle(options.lifecycle);
        this.onStarted = options.onStarted || (() => {});
        this.onStopping = options.onStopping || (() => {});
    }

    start() {
        if (!this.lifecycle.start()) return false;
        this.onStarted();
        return true;
    }

    stop() {
        if (!this.lifecycle.started) return false;
        this.onStopping();
        return this.lifecycle.stop();
    }
}

/* cjs:start */
const { RuntimeLifecycle } = require("./RuntimeLifecycle");
module.exports = { CCNiri };
/* cjs:end */
