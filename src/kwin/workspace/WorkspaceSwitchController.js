"use strict";

class WorkspaceSwitchController {
    constructor(options) {
        Object.assign(this, options);
        this.phase = "IDLE";
        this.switchEpoch = 0;
        this.timer = null;
        this.stopped = false;
        this.pendingRequest = null;
    }

    ready() {
        return !this.stopped && !this.mount.stopped && this.appState.enabled &&
            this.appState.targetOutput && this.appState.activeWorkspaceId;
    }

    previous() { return this.request(-1); }
    next() { return this.request(1); }

    focusNumber(number) {
        if (this.stopped || this.phase !== "IDLE" || this.appState.workspaceSwitching ||
                !Number.isInteger(number) || number < 1 || number > 9) return false;
        // Numbers describe the current KDE order, never a cached workspace ID.
        const target = this.topology.byNumber(number);
        return target ? this.requestTo(target, { reason: "workspace-direct-shortcut" }) : false;
    }

    request(direction) {
        if (this.stopped || this.phase !== "IDLE") return false;
        this.mount.refreshState();
        if (!this.ready()) return false;
        const current = this.topology.current(this.appState.targetOutput);
        const target = direction < 0 ? this.topology.previous(current) : this.topology.next(current);
        if (!target) return false; // Fixed topology, no wrapping or implicit creation.
        return this.requestTo(target);
    }

    requestTo(target, options = {}) {
        if (this.stopped || this.phase !== "IDLE") return false;
        this.mount.refreshState();
        if (!this.ready()) return false;
        const targetId = this.topology.id(target);
        if (!targetId || !this.topology.byId(targetId) ||
                targetId === this.topology.id(this.topology.current(this.appState.targetOutput))) return false;
        const request = { targetId, focusedUuid: options.focusedUuid || null,
            onFinished: options.onFinished || (() => {}) };
        this.pendingRequest = request;
        const epoch = this.begin(options.reason || "workspace-shortcut");
        if (epoch === null) return false;
        // The same barrier and bounded timeout cover motion retirement,
        // membership preparation and the native desktop request.
        try {
            this.timer = this.setTimer(() => this.finish(epoch, "workspace-timeout"), 400);
            const prepared = accepted => {
                if (!this.valid(epoch) || this.phase !== "PREPARING" || this.pendingRequest !== request) return;
                const desktop = this.topology.byId(targetId);
                if (!accepted || !desktop) { this.finish(epoch, "workspace-prepare-aborted"); return; }
                this.phase = "AWAITING_KWIN";
                try { this.requestDesktop(desktop, this.appState.targetOutput); }
                catch (error) {
                    this.debug(`[cc-workspace] request failed: ${error}`);
                    this.finish(epoch, "workspace-request-failed");
                }
            };
            if (options.prepare) options.prepare(prepared);
            else prepared(true);
        } catch (error) {
            this.debug(`[cc-workspace] request failed: ${error}`);
            this.finish(epoch, "workspace-request-failed");
        }
        return true;
    }

    begin(reason) {
        const epoch = ++this.switchEpoch;
        this.phase = "PREPARING";
        this.appState.workspaceSwitching = true;
        try {
            this.mount.cancelPending(reason);
            this.mount.capture();
            return this.valid(epoch) ? epoch : null;
        } catch (error) {
            this.fail(error);
            return null;
        }
    }

    valid(epoch) {
        return !this.stopped && !this.mount.stopped && this.appState.enabled &&
            epoch === this.switchEpoch && this.phase !== "IDLE";
    }

    clearTimeout() {
        if (this.timer) this.clearTimer(this.timer);
        this.timer = null;
    }

    finish(epoch, reason) {
        if (!this.valid(epoch) || this.phase === "MOUNTING") return false;
        this.clearTimeout();
        this.phase = "MOUNTING";
        const request = this.pendingRequest;
        let committed = false;
        try {
            // Preparation can emit another native switch. Hydrate the final KDE
            // authority before publishing one runtime generation for this transaction.
            for (let pass = 0; pass < 8; pass += 1) {
                const desktop = this.topology.current(this.appState.targetOutput);
                if (!this.topology.id(desktop)) throw new Error("workspace-current-desktop-unavailable");
                const focusedUuid = request && request.targetId === this.topology.id(desktop)
                    ? request.focusedUuid : null;
                if (!this.mount.mountPrepared(desktop, reason, focusedUuid)) return false;
                if (!this.valid(epoch)) return false;
                if (this.appState.activeWorkspaceId === this.topology.id(this.topology.current(this.appState.targetOutput))) {
                    this.mount.commitState(reason);
                    committed = true;
                    return true;
                }
            }
            throw new Error("workspace-desktop-changed-during-every-mount");
        } catch (error) {
            this.fail(error);
            return false;
        } finally {
            if (epoch === this.switchEpoch) {
                this.phase = "IDLE";
                this.appState.workspaceSwitching = false;
                this.pendingRequest = null;
                if (request) request.onFinished(committed ? this.appState.activeWorkspaceId : null);
            }
        }
    }

    onDesktopChanged(_previous, _current, output) {
        if (!this.ready()) return false;
        this.mount.refreshState();
        if (!this.topology.affectsOutput(output, this.appState.targetOutput)) return false;
        if (this.phase === "AWAITING_KWIN") return this.finish(this.switchEpoch, "workspace-switch");
        if (this.phase !== "IDLE" || this.appState.activeWorkspaceId ===
                this.topology.id(this.topology.current(this.appState.targetOutput))) return false;
        const epoch = this.begin("workspace-native-switch");
        return epoch !== null && this.finish(epoch, "workspace-switch");
    }

    onTopologyChanged() {
        if (!this.ready()) return false;
        if (this.phase === "AWAITING_KWIN") return this.finish(this.switchEpoch, "workspace-topology-change");
        if (this.phase !== "IDLE") return false;
        this.mount.pruneSnapshots();
        return this.onDesktopChanged(null, null, this.appState.targetOutput);
    }

    fail(error) {
        this.stop();
        this.onFailure(error);
    }

    stop() {
        if (this.stopped) return;
        this.stopped = true;
        ++this.switchEpoch;
        this.clearTimeout();
        this.phase = "IDLE";
        this.appState.workspaceSwitching = false;
        const request = this.pendingRequest;
        this.pendingRequest = null;
        if (request) request.onFinished(null);
    }
}

/* cjs:start */
module.exports = { WorkspaceSwitchController };
/* cjs:end */
