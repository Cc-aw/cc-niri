"use strict";

class ParkingAnimationGrabber {
    constructor(options) {
        this.effect = options.effect;
        this.minimizedRole = options.minimizedRole;
        this.unminimizedRole = options.unminimizedRole;
        this.debug = options.debug;
        this.grabbedWindows = new Set();
    }

    has(window) {
        return this.grabbedWindows.has(window);
    }

    grab(window, reason) {
        if (!window) return false;
        if (this.has(window)) return true;

        const minimized = this.effect.grab(window, this.minimizedRole, true);
        const unminimized = this.effect.grab(window, this.unminimizedRole, true);
        if (!minimized || !unminimized) {
            if (minimized) this.effect.ungrab(window, this.minimizedRole);
            if (unminimized) this.effect.ungrab(window, this.unminimizedRole);
            this.debug(`[PARK_GRAB] failed reason=${reason}` +
                ` minimize=${minimized} unminimize=${unminimized}`);
            return false;
        }

        this.grabbedWindows.add(window);
        this.debug(`[PARK_GRAB] grab reason=${reason}` +
            " minimize=true unminimize=true");
        return true;
    }

    release(window, reason) {
        if (!window || !this.has(window)) return false;
        this.grabbedWindows.delete(window);
        const minimized = this.effect.ungrab(window, this.minimizedRole);
        const unminimized = this.effect.ungrab(window, this.unminimizedRole);
        this.debug(`[PARK_GRAB] release reason=${reason}` +
            ` minimize=${minimized} unminimize=${unminimized}`);
        return minimized && unminimized;
    }

    releaseAll(reason) {
        Array.from(this.grabbedWindows).forEach(window =>
            this.release(window, reason));
    }
}

/* cjs:start */
module.exports = { ParkingAnimationGrabber };
/* cjs:end */
