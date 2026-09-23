"use strict";

const WindowDisposition = Object.freeze({
    MANAGED_ELIGIBLE: "managed-eligible",
    POLICY_FLOATING: "policy-floating",
    NATIVE_ONLY: "native-only",
});

function isPlasmaShellWindow(window) {
    if (!window) return false;
    const shellIdentities = new Set([
        "plasmashell",
        "org.kde.plasmashell",
        "org.kde.plasma.desktop",
    ]);
    return [window.resourceClass, window.resourceName, window.desktopFileName]
        .map(value => String(value || "").trim().toLowerCase())
        .some(value => shellIdentities.has(value));
}

class WindowPolicy {
    classify(window) {
        const nativeOnly = reason => ({
            kind: WindowDisposition.NATIVE_ONLY, reason, parent: null,
        });
        const policyFloating = reason => ({
            kind: WindowDisposition.POLICY_FLOATING,
            reason,
            parent: window.transientFor || null,
        });
        if (!window || !window.managed) return nativeOnly("unmanaged");
        if (isPlasmaShellWindow(window)) return nativeOnly("plasma-shell");
        if (window.desktopWindow) return nativeOnly("desktop");
        if (window.dock) return nativeOnly("dock");
        if (window.popupWindow || window.dropdownMenu || window.menu) {
            return nativeOnly("popup");
        }
        if (window.splash) return nativeOnly("splash");
        if (window.dialog) return policyFloating("dialog");
        if (window.modal) return policyFloating("modal");
        if (window.transient) return policyFloating("transient");
        if (window.utility) return policyFloating("utility");
        if (window.toolbar) return policyFloating("toolbar");
        if (window.specialWindow) return nativeOnly("special-window");
        if (window.skipTaskbar) return nativeOnly("skip-taskbar");
        if (!window.normalWindow) return nativeOnly("not-normal");
        if (!window.moveable) return nativeOnly("not-moveable");
        if (!window.resizeable) return nativeOnly("not-resizeable");
        return {
            kind: WindowDisposition.MANAGED_ELIGIBLE,
            reason: "normal",
            parent: null,
        };
    }

    canJoinColumn(window) {
        return this.classify(window).kind === WindowDisposition.MANAGED_ELIGIBLE;
    }

    managedLayoutEligible(window) {
        return this.canJoinColumn(window) && Boolean(window.maximizable);
    }
}

/* cjs:start */
module.exports = { WindowDisposition, WindowPolicy, isPlasmaShellWindow };
/* cjs:end */
