"use strict";

class LayoutEligibility {
    constructor(options) {
        this.windowPolicy = options.windowPolicy;
        this.membership = options.membership;
        this.isEnabled = options.isEnabled;
        this.getPrimaryOutput = options.getPrimaryOutput;
        this.isPrimaryReady = options.isPrimaryReady;
    }

    isWorkspaceReady(window) {
        if (!this.isEnabled() || !window || !window.output ||
                !this.membership.belongsToActive(window, window.output)) return false;
        // Only primary Columns depend on the primary workspace mount.
        return window.output !== this.getPrimaryOutput() || this.isPrimaryReady();
    }

    eligible(window) {
        return Boolean(window && !window.fullScreen &&
            this.windowPolicy.managedLayoutEligible(window) &&
            this.isWorkspaceReady(window));
    }
}

/* cjs:start */
module.exports = { LayoutEligibility };
/* cjs:end */
