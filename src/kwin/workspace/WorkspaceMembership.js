"use strict";

class WorkspaceMembership {
    constructor(options = {}) {
        this.getCurrentDesktop = options.getCurrentDesktop || (() => null);
    }

    desktopIds(window) {
        if (!window || !Array.isArray(window.desktops)) return [];
        return window.desktops.map(desktop => desktop && desktop.id)
            .filter(id => typeof id === "string" && id.length > 0);
    }

    isSticky(window) {
        return Boolean(window && (window.onAllDesktops ||
            (Array.isArray(window.desktops) && window.desktops.length === 0)));
    }

    isSingleDesktop(window) {
        return Boolean(window && !this.isSticky(window) &&
            Array.isArray(window.desktops) && window.desktops.length === 1 &&
            this.desktopIds(window).length === 1);
    }

    ownerId(window) {
        return this.isSingleDesktop(window) ? this.desktopIds(window)[0] : null;
    }

    belongsTo(window, workspaceId) {
        return typeof workspaceId === "string" && workspaceId.length > 0 &&
            this.ownerId(window) === workspaceId;
    }

    belongsToActive(window, output) {
        const desktop = this.getCurrentDesktop(output);
        return this.belongsTo(window, desktop && desktop.id);
    }
}

/* cjs:start */
module.exports = { WorkspaceMembership };
/* cjs:end */
