"use strict";

class WorkspaceOccupancy {
    constructor(options) { this.membership = options.membership; }

    shell(window) {
        return !window || isPlasmaShellWindow(window) || window.desktopWindow || window.dock;
    }

    occupies(window, desktopId, output) {
        if (this.shell(window) || !window.managed || window.output !== output ||
                window.popupWindow || window.dropdownMenu || window.menu || window.splash ||
                this.membership.isSticky(window)) return false;
        const application = window.normalWindow || window.dialog || window.modal || window.transient ||
            window.utility || window.toolbar;
        return Boolean(application && this.membership.desktopIds(window).includes(desktopId));
    }

    recyclingOwners(windows) {
        const owners = new Set();
        for (let index = 0; index < windows.length; ++index) {
            const window = windows[index];
            if (this.shell(window) || window.onAllDesktops) continue;
            const list = this.membership.desktopList(window);
            // Deletion must be conservative: include native-only windows, all
            // outputs and activities. Unknown membership cannot prove emptiness.
            if (!list) return null;
            for (const desktop of list) {
                if (!desktop || typeof desktop.id !== "string" || !desktop.id) return null;
                owners.add(desktop.id);
            }
        }
        return owners;
    }
}

/* cjs:start */
const { isPlasmaShellWindow } = require("../policy/WindowPolicy");
module.exports = { WorkspaceOccupancy };
/* cjs:end */
