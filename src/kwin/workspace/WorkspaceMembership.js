"use strict";

class WorkspaceMembership {
    constructor(options = {}) {
        this.getCurrentDesktop = options.getCurrentDesktop || (() => null);
    }

    desktopList(window) {
        const list = window && window.desktops;
        // QV4 exposes QList as a Qt sequence: indexed with length, but
        // Array.isArray(list) is false. Copy by index across both runtimes.
        if (!list || typeof list !== "object" || !Number.isInteger(list.length) ||
                list.length < 0) return null;
        const result = [];
        for (let index = 0; index < list.length; index += 1) result.push(list[index]);
        return result;
    }

    desktopIds(window) {
        return (this.desktopList(window) || []).map(desktop => desktop && desktop.id)
            .filter(id => typeof id === "string" && id.length > 0);
    }

    isSticky(window) {
        const list = this.desktopList(window);
        return Boolean(window && (window.onAllDesktops || (list && list.length === 0)));
    }

    isSingleDesktop(window) {
        const list = this.desktopList(window);
        return Boolean(window && !this.isSticky(window) && list && list.length === 1 &&
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
