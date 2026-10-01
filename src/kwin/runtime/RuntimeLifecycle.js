"use strict";

class RuntimeLifecycle {
    constructor(options) {
        this.workspace = options.workspace;
        this.setupWindow = options.setupWindow;
        this.onWindowAdded = options.onWindowAdded;
        this.onWindowActivated = options.onWindowActivated;
        this.onCurrentDesktopChanged = options.onCurrentDesktopChanged;
        this.onDesktopsChanged = options.onDesktopsChanged;
        this.onScreensChanged = options.onScreensChanged;
        this.onVirtualScreenGeometryChanged =
            options.onVirtualScreenGeometryChanged;
        this.connectManagedGeometry = options.connectManagedGeometry;
        this.initializeScrollLayout = options.initializeScrollLayout;
        this.readPreviousState = options.readPreviousState ||
            (callback => callback(""));
        this.setTimer = options.setTimer || null;
        this.clearTimer = options.clearTimer || null;
        this.startupTimeoutMs = options.startupTimeoutMs || 500;
        this.markInitialized = options.markInitialized;
        this.registerShortcut = options.registerShortcut;
        this.shortcuts = options.shortcuts;
        this.commitInitialState = options.commitInitialState;
        this.connections = [];
        this.started = false;
        this.shortcutsRegistered = false;
        this.startupTimer = null;
        this.startupPending = false;
        this.startupGeneration = 0;
    }

    connect(signal, handler) {
        if (!signal || typeof signal.connect !== "function") return;
        signal.connect(handler);
        this.connections.push({ signal, handler });
    }

    start() {
        if (this.started) return false;
        this.started = true;
        const generation = ++this.startupGeneration;
        this.workspace.windowList().forEach(this.setupWindow);
        this.connect(this.workspace.windowAdded, this.onWindowAdded);
        this.connect(this.workspace.windowActivated, this.onWindowActivated);
        if (this.onCurrentDesktopChanged) this.connect(this.workspace.currentDesktopChanged, this.onCurrentDesktopChanged);
        if (this.onDesktopsChanged) this.connect(this.workspace.desktopsChanged, this.onDesktopsChanged);
        this.connect(this.workspace.screensChanged, this.onScreensChanged);
        this.connect(
            this.workspace.virtualScreenGeometryChanged,
            this.onVirtualScreenGeometryChanged
        );
        this.connect(this.workspace.screenOrderChanged, this.onScreensChanged);
        this.connectManagedGeometry();
        if (!this.shortcutsRegistered) {
            this.shortcuts.forEach(shortcut => this.registerShortcut(
                shortcut.name,
                shortcut.description,
                shortcut.defaultSequence,
                shortcut.handler
            ));
            this.shortcutsRegistered = true;
        }
        this.startupPending = true;
        const complete = snapshot => {
            if (!this.started || !this.startupPending ||
                    generation !== this.startupGeneration) return;
            this.startupPending = false;
            if (this.startupTimer && this.clearTimer) {
                this.clearTimer(this.startupTimer);
                this.startupTimer = null;
            }
            this.initializeScrollLayout(snapshot);
            this.markInitialized(true);
            this.commitInitialState();
        };
        if (this.setTimer) {
            this.startupTimer = this.setTimer(
                () => complete(""), this.startupTimeoutMs);
        }
        try {
            this.readPreviousState(complete);
        } catch (_error) {
            complete("");
        }
        return true;
    }

    stop() {
        if (!this.started) return false;
        this.connections.forEach(connection => {
            if (!connection.signal ||
                    typeof connection.signal.disconnect !== "function") return;
            try {
                connection.signal.disconnect(connection.handler);
            } catch (_error) {
                // KWin also drops script-owned connections during unload.
            }
        });
        this.connections = [];
        this.startupGeneration += 1;
        this.startupPending = false;
        if (this.startupTimer && this.clearTimer) {
            this.clearTimer(this.startupTimer);
            this.startupTimer = null;
        }
        this.markInitialized(false);
        this.started = false;
        return true;
    }
}

/* cjs:start */
module.exports = { RuntimeLifecycle };
/* cjs:end */
