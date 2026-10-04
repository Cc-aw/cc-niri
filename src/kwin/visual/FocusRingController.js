"use strict";

// Publishes eligibility only. Native KWin focus, visibility and paint state
// choose the owner; neither ColumnStore focus nor layout transactions do so.
class FocusRingController {
    constructor(options) {
        Object.assign(this, options);
        this.sessionId = options.sessionId || `${options.now().toString(16)}-` +
            `${Math.floor(options.random() * 0x100000000).toString(16)}`;
        this.generation = 0;
        this.started = false;
        this.connections = [];
        this.watched = new Map();
        this.closed = new Set();
        this.lastKey = null;
    }

    connect(signal, handler, connections = this.connections) {
        if (!signal || typeof signal.connect !== "function") return;
        signal.connect(handler);
        connections.push({ signal, handler });
    }

    disconnect(connections) {
        connections.forEach(({ signal, handler }) => {
            try {
                if (signal && typeof signal.disconnect === "function") signal.disconnect(handler);
            } catch (_error) {
                // Qt may already have destroyed the signal's owning Window.
            }
        });
    }

    watchWindow(window) {
        if (!window || this.watched.has(window) || this.closed.has(window)) return;
        const connections = [];
        this.watched.set(window, connections);
        ["outputChanged", "desktopsChanged", "skipTaskbarChanged", "transientChanged",
            "modalChanged", "fullScreenChanged", "minimizedChanged", "activitiesChanged"]
            .forEach(name => this.connect(window[name], () => this.publish(), connections));
        this.connect(window.closed, () => {
            if (this.getState().columns.some(column => column.window === window)) this.closed.add(window);
            this.disconnect(connections);
            this.watched.delete(window);
            this.publish();
        }, connections);
    }

    snapshot(enabled = this.started) {
        const state = this.getState();
        const output = state.targetOutput;
        const desktop = output && this.getCurrentDesktop(output);
        // A mount may be between workspaces. Never qualify its old Columns for
        // KDE's new desktop, even when publication occurs inside a transaction.
        const ready = Boolean(enabled && state.enabled && output && desktop &&
            state.activeWorkspaceId === desktop.id);
        const ids = new Set();
        (state.columns || []).forEach(column => {
            const window = column.window;
            // Check identity before reading a potentially destroyed Qt wrapper.
            if (!window || this.closed.has(window) || !ready) return;
            const windowState = this.getWindowState(window);
            if (window.output !== output || !this.membership.belongsTo(window, desktop.id) ||
                    !this.windowPolicy.canJoinColumn(window) || !windowState || windowState.floating) return;
            const id = String(window.internalId || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) &&
                    id !== "00000000-0000-0000-0000-000000000000") ids.add(id);
        });
        return { protocol: 1, type: "focus-ring-eligibility", sessionId: this.sessionId,
            generation: this.generation, enabled: ready, targetOutput: ready ? output.name : "",
            workspaceId: ready ? desktop.id : "", windows: Array.from(ids).sort() };
    }

    publish(force = false) {
        if (!this.started) return null;
        return this.send(this.snapshot(), force);
    }

    send(snapshot, force) {
        const key = JSON.stringify([snapshot.enabled, snapshot.targetOutput, snapshot.workspaceId, snapshot.windows]);
        if (!force && key === this.lastKey) return null;
        this.lastKey = key;
        snapshot.generation = ++this.generation;
        // Off means the native endpoint may be absent. Do not retry, poll, or
        // apply delayed acknowledgements; loading the effect requests a resend.
        try {
            this.invoke("org.kde.KWin", "/ccNiriFocusRing", "org.cc.NiriFocusRing1",
                "PublishEligibility", JSON.stringify(snapshot), () => {});
        } catch (_error) {
            // A stopped/uninstalled effect must not interrupt model mutation.
            this.lastKey = null;
            return null;
        }
        return snapshot;
    }

    start() {
        if (this.started) return false;
        this.started = true;
        this.workspace.windowList().forEach(window => this.watchWindow(window));
        this.connect(this.workspace.windowAdded, window => { this.watchWindow(window); this.publish(); });
        this.connect(this.workspace.windowActivated, () => this.publish(true));
        ["currentDesktopChanged", "desktopsChanged", "screensChanged", "screenOrderChanged"]
            .forEach(name => this.connect(this.workspace[name], () => this.publish()));
        this.publish(true);
        return true;
    }

    membershipChanged() {
        // Removed closed wrappers must not be retained across repeated closes.
        const mounted = new Set(this.getState().columns.map(column => column.window));
        this.closed.forEach(window => { if (!mounted.has(window)) this.closed.delete(window); });
        return this.publish();
    }

    stop() {
        if (!this.started) return false;
        this.send(this.snapshot(false), true);
        this.started = false;
        this.disconnect(this.connections);
        this.watched.forEach(connections => this.disconnect(connections));
        this.connections = [];
        this.watched.clear();
        this.closed.clear();
        this.lastKey = null;
        return true;
    }
}

/* cjs:start */
module.exports = { FocusRingController };
/* cjs:end */
