"use strict";

class VirtualDesktopTopology {
    constructor(options) {
        this.getDesktops = options.getDesktops;
        this.getCurrentDesktop = options.getCurrentDesktop;
    }

    ordered() { return this.getDesktops().slice(); }
    current(output) { return this.getCurrentDesktop(output); }
    id(desktop) {
        return desktop && typeof desktop.id === "string" && desktop.id ? desktop.id : null;
    }
    indexOf(desktop) {
        const id = this.id(desktop);
        return id ? this.ordered().findIndex(item => this.id(item) === id) : -1;
    }
    previous(desktop) {
        const index = this.indexOf(desktop);
        return index > 0 ? this.ordered()[index - 1] : null;
    }
    next(desktop) {
        const index = this.indexOf(desktop);
        return index >= 0 ? this.ordered()[index + 1] || null : null;
    }
    byId(id) { return this.ordered().find(desktop => this.id(desktop) === id) || null; }
    affectsOutput(output, targetOutput) {
        return Boolean(targetOutput && (!output || output === targetOutput));
    }
}

/* cjs:start */
module.exports = { VirtualDesktopTopology };
/* cjs:end */
