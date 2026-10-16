"use strict";

/* cjs:start */
const { normalizeColumnWidthMode, normalizePreviousNonFullWidthMode } = require("../model/ColumnStore");
const { deriveV2Layout, projectV2Column, createScrollLayoutGeometry } = require("./ContinuousColumnLayout");
const { resolveV2Viewport } = require("./ViewportPolicy");
/* cjs:end */

function freezeV2Intent(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.values(value).forEach(freezeV2Intent);
        Object.freeze(value);
    }
    return value;
}

// One active workspace, using the existing ColumnStore. Emits internal JS
// intents only; never SCROLL/COLUMN_REINDEX, frameGeometry, activation or IPC.
class ContinuousViewportController {
    constructor(options) {
        this.state = options.state;
        this.store = options.columnStore;
        this.transaction = options.transaction;
        this.getPrimaryOutput = options.getPrimaryOutput;
        this.getCurrentWorkspaceId = options.getCurrentWorkspaceId;
        this.canJoin = options.canJoin;
        this.getUuid = options.getUuid;
        this.getPainted = options.getPainted || (() => null);
        this.onTarget = options.onTarget || (() => {});
        this.dockEnabled = options.dockEnabled === true;
        this.enabled = options.enabled === true;
        if (this.enabled && !this.store.scrollLayoutV2Enabled) throw new Error("V2 requires a V2 ColumnStore");
        this.sessionId = options.sessionId;
        if (this.enabled && (typeof this.sessionId !== "string" || !this.sessionId)) {
            throw new Error("V2 requires the existing runtime session ID");
        }
        this.geometry = null;
        this.scopeRevision = 0;
        this.busy = false;
        this.mounting = false;
        this.lastTarget = null;
        this.lastSample = null; // Two monotonic scalars, not a retained pose cache.
        this.outputName = "";
        this.stopRequested = false;
        this.cleanupFailed = false;
    }

    ready() {
        return this.enabled && this.state.enabled && !this.state.workspaceSwitching &&
            this.state.activeWorkspaceId && this.state.targetOutput === this.getPrimaryOutput() && this.geometry &&
            (!this.getCurrentWorkspaceId || this.getCurrentWorkspaceId() === this.state.activeWorkspaceId);
    }

    uuid(column) { return column.v2WindowUuid; }

    eligible(window, scope) {
        try { return Boolean(this.canJoin(window, scope)); } catch (_error) { return false; }
    }

    windowUuid(window) {
        try {
            const uuid = this.getUuid(window);
            return typeof uuid === "string" && uuid.length ? uuid : null;
        } catch (_error) { return null; }
    }

    validToken(token) {
        return !token || (token.sessionId === this.sessionId && token.workspaceId === this.state.activeWorkspaceId &&
            token.targetOutput === this.outputName && token.scopeRevision === this.scopeRevision &&
            token.epoch === this.state.geometryGeneration);
    }

    copyGeometry(geometry) {
        const copy = createScrollLayoutGeometry({ outputRect: geometry.outputRect, workingArea: geometry.workingArea,
            gap: geometry.gap, topGap: geometry.topGap, physicalScale: geometry.physicalScale });
        const allowed = ["working-area-fallback", "working-area-clipped-to-output", "gap-clamped", "scale-fallback"];
        if (Array.isArray(geometry.diagnostics)) {
            copy.diagnostics = Array.from(new Set(copy.diagnostics.concat(geometry.diagnostics.slice(0, 8)
                .filter(value => allowed.includes(value)))));
        }
        return copy;
    }

    sameGeometry(a, b) {
        return Boolean(a && b && a.gap === b.gap && (a.topGap ?? a.gap) === (b.topGap ?? b.gap) && a.physicalScale === b.physicalScale &&
            a.diagnostics.length === b.diagnostics.length && a.diagnostics.every(value => b.diagnostics.includes(value)) &&
            ["outputRect", "workingArea"].every(area => ["x", "y", "width", "height"]
                .every(key => a[area][key] === b[area][key])));
    }

    validLayout(columns, geometry) {
        try { deriveV2Layout(columns, geometry); return true; }
        catch (_error) { return false; }
    }

    painted(before) {
        let sample;
        try { sample = this.getPainted(); } catch (_error) { return null; }
        if (!sample || sample.sessionId !== this.sessionId || sample.workspaceId !== before.workspaceId || sample.targetOutput !== before.outputName ||
                sample.scopeRevision !== before.scopeRevision || !Number.isSafeInteger(sample.epoch) ||
                sample.epoch < 1 || sample.epoch > before.epoch || !Number.isSafeInteger(sample.sampleSerial) ||
                sample.sampleSerial < 0 || !Number.isFinite(sample.cameraX) || sample.cameraX < 0 ||
                !Array.isArray(sample.entries) ||
                (this.lastSample && (sample.epoch < this.lastSample.epoch ||
                    sample.sampleSerial < this.lastSample.sampleSerial))) return null;
        // No new paint may occur between several membership changes. Reuse only
        // the already verified facts at exactly the same sample identity, trimmed
        // to current survivors by the preceding intent. Never synthesize a pose.
        const cached = this.lastTarget && this.lastTarget.source;
        if (cached && sample.epoch === cached.epoch && sample.sampleSerial === cached.sampleSerial &&
                sample.cameraX === cached.cameraX) return cached;
        if (sample.entries.length > before.columns.length) return null;
        const ids = new Set(before.columns.map(c => c.uuid));
        const seen = new Set();
        const entries = [];
        for (const entry of sample.entries) {
            const r = entry.visualRect;
            if (!ids.has(entry.uuid) || seen.has(entry.uuid) || !r ||
                    ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.width < 1 || r.height < 1) return null;
            seen.add(entry.uuid);
            entries.push({ uuid: entry.uuid, visualRect: { x: r.x, y: r.y, width: r.width, height: r.height } });
        }
        this.lastSample = { epoch: sample.epoch, sampleSerial: sample.sampleSerial };
        return { epoch: sample.epoch, sampleSerial: sample.sampleSerial, cameraX: sample.cameraX,
            geometry: before.geometry, entries };
    }

    batch(reason, mutate) {
        if (!this.enabled) return false;
        if (this.busy) return mutate();
        const before = { workspaceId: this.state.activeWorkspaceId, output: this.state.targetOutput,
            scopeRevision: this.scopeRevision, outputName: this.outputName, epoch: this.state.geometryGeneration || 0,
            geometry: this.geometry, target: this.state.scrollOffsetX,
            columns: this.state.columns.map(c => ({ uuid: this.uuid(c), logicalX: c.logicalX,
                pixelWidth: c.pixelWidth, widthMode: c.widthMode })) };
        const observed = before.output && before.geometry ? this.painted(before) : null;
        let plan = null;
        this.transaction.run(reason, epoch => {
            this.busy = true;
            this.changed = false;
            this.anchor = null;
            try {
                mutate();
                if (!this.changed || this.stopRequested) return;
                const layout = deriveV2Layout(this.state.columns, this.geometry);
                const sameScope = before.workspaceId === this.state.activeWorkspaceId &&
                    before.output === this.state.targetOutput;
                const structural = !sameScope || !this.sameGeometry(before.geometry, this.geometry) ||
                    before.columns.length !== this.state.columns.length || before.columns.some((old, i) =>
                        old.uuid !== this.uuid(this.state.columns[i]) || old.widthMode !== this.state.columns[i].widthMode);
                const painted = sameScope ? observed : null;
                const focused = this.store.focusedColumn();
                const paintedFocus = painted && focused && painted.entries.find(e => e.uuid === this.uuid(focused));
                layout.cameraX = resolveV2Viewport(layout, { focusedIndex: this.store.focusedIndex(),
                    currentTarget: sameScope ? before.target : 0, painted, structural,
                    paintedFocusRect: paintedFocus && paintedFocus.visualRect, anchor: this.anchor });
                if (this.centerRequested && focused) layout.cameraX = Math.max(0, Math.min(layout.maxCamera,
                    focused.logicalX + focused.pixelWidth / 2 - this.geometry.workingArea.width / 2));
                this.state.columns.forEach((column, i) => Object.assign(column, layout.columns[i]));
                this.state.scrollOffsetX = layout.cameraX;
                this.state.geometryGeneration = epoch;
                const entries = this.state.columns.map(column => Object.assign({ uuid: this.uuid(column),
                    columnId: column.id, widthMode: column.widthMode, logicalX: column.logicalX,
                    pixelWidth: column.pixelWidth }, projectV2Column(column, this.geometry, layout.cameraX)));
                const survivors = new Set(entries.map(e => e.uuid));
                plan = { kind: "scroll-layout-v2-intent", sessionId: this.sessionId,
                    requiredCapability: structural ? "v2-column-geometry" : "v2-scroll",
                    epoch, scopeRevision: this.scopeRevision, workspaceId: this.state.activeWorkspaceId,
                    targetOutput: this.outputName, focusedUuid: focused ? this.uuid(focused) : null,
                    cameraTargetX: layout.cameraX, maxCamera: layout.maxCamera, geometry: this.copyGeometry(this.geometry), entries,
                    source: painted ? { epoch: painted.epoch, sampleSerial: painted.sampleSerial,
                        cameraX: painted.cameraX, geometry: painted.geometry,
                        entries: painted.entries.filter(e => survivors.has(e.uuid)) } : null,
                    continuity: !sameScope || !before.columns.length ? "initial" : painted ? "observed" : "unavailable",
                    reason };
                this.lastTarget = freezeV2Intent(plan);
            } catch (error) {
                this.stopRequested = true;
                throw error;
            } finally {
                this.busy = false;
                this.anchor = null;
                this.centerRequested = false;
                this.changed = false;
                if (this.stopRequested) { this.stopRequested = false; this.stop(); plan = null; }
            }
        });
        if (plan) this.onTarget(plan);
        return Boolean(plan);
    }

    mount(scope, entries, view = {}) {
        if (!this.enabled || this.busy || !this.state.enabled || this.state.workspaceSwitching || !scope ||
                typeof scope.workspaceId !== "string" || !scope.workspaceId.trim() ||
                scope.output !== this.getPrimaryOutput() || !Array.isArray(entries) ||
                (this.getCurrentWorkspaceId && scope.workspaceId !== this.getCurrentWorkspaceId())) return false;
        let geometry;
        try { geometry = this.copyGeometry(scope.geometry); } catch (_error) { return false; }
        if (entries.some(e => !e || !e.window)) return false;
        const uuids = entries.map(e => this.windowUuid(e.window));
        if (uuids.some(id => !id) || new Set(uuids).size !== uuids.length ||
                entries.some(e => !this.eligible(e.window, scope)) || !this.validLayout(entries, geometry)) return false;
        const sameScope = this.state.activeWorkspaceId === scope.workspaceId && this.state.targetOutput === scope.output;
        const sameEntries = entries.length === this.state.columns.length && entries.every((e, i) => {
            const c = this.state.columns[i];
            return c.window === e.window && c.v2WindowUuid === uuids[i] && c.widthMode === normalizeColumnWidthMode(e.widthMode, true) &&
                c.previousNonFullWidthMode === normalizePreviousNonFullWidthMode(e.previousNonFullWidthMode, e.widthMode, true) &&
                c.persistentWide === (e.persistentWide === true);
        });
        if (sameScope && sameEntries && this.sameGeometry(this.geometry, geometry)) {
            const requested = uuids.indexOf(view.focusedUuid);
            const focusedIndex = requested >= 0 ? requested : this.store.focusedIndex();
            const anchorIndex = view.anchor ? uuids.indexOf(view.anchor.uuid) : -1;
            const anchor = anchorIndex >= 0 && Number.isFinite(view.anchor.delta)
                ? { index: anchorIndex, delta: view.anchor.delta } : null;
            const layout = deriveV2Layout(entries, geometry);
            const camera = resolveV2Viewport(layout, { focusedIndex, anchor, currentTarget: this.state.scrollOffsetX });
            if (focusedIndex === this.store.focusedIndex() && camera === this.state.scrollOffsetX) return false;
        }
        return this.batch("workspace-mount", () => {
            this.mounting = true;
            try {
                if (!sameScope || this.outputName !== scope.output.name || !this.sameGeometry(this.geometry, geometry)) {
                    this.outputName = scope.output.name;
                    this.scopeRevision++;
                    this.lastSample = null;
                }
                if (!sameScope) {
                    this.state.activeWorkspaceId = scope.workspaceId;
                    this.state.targetOutput = scope.output;
                    this.outputName = scope.output.name;
                    this.lastSample = null;
                    this.store.clear();
                }
                this.geometry = geometry;
                const keep = new Set(entries.map(e => e.window));
                this.state.columns.slice().forEach(c => { if (!keep.has(c.window)) this.store.removeWindow(c.window); });
                const order = entries.map((e, i) => {
                    let c = this.state.columns.find(c => c.window === e.window);
                    if (!c) c = this.store.insertWindow(e.window, this.state.columns.length, e.widthMode, e.previousNonFullWidthMode);
                    c.v2WindowUuid = uuids[i];
                    c.widthMode = normalizeColumnWidthMode(e.widthMode, true);
                    c.previousNonFullWidthMode = normalizePreviousNonFullWidthMode(e.previousNonFullWidthMode, c.widthMode, true);
                    c.persistentWide = e.persistentWide === true;
                    return c;
                });
                // Reentrant adoption can append a new eligible window while a
                // mount is enumerating; retain it in the same mutation batch.
                this.store.reorder(order.concat(this.state.columns.filter(c => !order.includes(c))));
                const requested = this.state.columns.findIndex(c => this.uuid(c) === view.focusedUuid);
                this.store.focusIndex(requested >= 0 ? requested : sameScope && this.store.focusedColumn()
                    ? this.store.focusedIndex() : 0);
                const anchorIndex = view.anchor && this.state.columns.findIndex(c => this.uuid(c) === view.anchor.uuid);
                if (anchorIndex >= 0 && view.anchor && Number.isFinite(view.anchor.delta)) {
                    this.anchor = { index: anchorIndex, delta: view.anchor.delta };
                }
                this.changed = true;
            } finally { this.mounting = false; }
        });
    }

    focusWindow(window, source = "programmatic", token = null) {
        if (!this.ready() || this.mounting || !this.validToken(token) ||
                !["programmatic", "activation", "alt-tab", "history", "dock", "directional", "partial-input"].includes(source) ||
                (source === "partial-input" && !token) ||
                (source === "dock" && !this.dockEnabled)) return false;
        const index = this.store.indexOfWindow(window);
        if (index < 0 || !this.eligible(window, { workspaceId: this.state.activeWorkspaceId,
                output: this.state.targetOutput }) || index === this.store.focusedIndex()) return false;
        return this.batch(`focus-${source}`, () => { this.store.focusIndex(index); this.changed = true; return true; });
    }

    focusPartialRequest(request) {
        if (!request || !this.validToken(request)) return false;
        const column = this.state.columns.find(c => this.uuid(c) === request.windowUuid);
        return Boolean(column && this.focusWindow(column.window, "partial-input", request));
    }

    focusRelative(delta) {
        if (!this.ready() || ![-1, 1].includes(delta) || !this.state.columns.length) return false;
        const next = Math.max(0, Math.min(this.state.columns.length - 1, this.store.focusedIndex() + delta));
        return this.focusWindow(this.state.columns[next].window, "directional");
    }

    adopt(window, options = {}) {
        const scope = { workspaceId: this.state.activeWorkspaceId, output: this.state.targetOutput };
        if (!this.ready() || this.store.indexOfWindow(window) >= 0 || !this.eligible(window, scope)) return false;
        const uuid = this.windowUuid(window);
        if (!uuid || this.state.columns.some(c => this.uuid(c) === uuid)) return false;
        const widthMode = normalizeColumnWidthMode(options.widthMode, true);
        if (!this.validLayout(this.state.columns.concat([{ widthMode }]), this.geometry)) return false;
        const requested = options.index === undefined ? this.store.focusedIndex() + 1 : options.index;
        if (!Number.isInteger(requested) || requested < 0 || requested > this.state.columns.length) return false;
        return this.batch("window-added", () => {
            const oldFocus = this.store.focusedColumn();
            const column = this.store.insertWindow(window, requested, widthMode, options.previousNonFullWidthMode);
            if (!this.state.columns.includes(column)) return false;
            column.v2WindowUuid = uuid;
            this.store.focusColumn(options.focus === false && oldFocus ? oldFocus : column);
            this.changed = true;
            return true;
        });
    }

    remove(window) {
        if (!this.enabled || this.store.indexOfWindow(window) < 0) return false;
        if (!this.ready()) {
            this.store.removeWindow(window);
            this.lastTarget = null;
            return true; // Release closed wrappers during a native workspace/output departure; do not activate/publish.
        }
        return this.batch("window-removed", () => { this.store.removeWindow(window); this.changed = true; return true; });
    }

    reorder(uuids) {
        if (!this.ready() || !Array.isArray(uuids) || uuids.length !== this.state.columns.length ||
                new Set(uuids).size !== uuids.length) return false;
        const byUuid = new Map(this.state.columns.map(c => [this.uuid(c), c]));
        if (uuids.some(id => !byUuid.has(id)) || uuids.every((id, i) => this.uuid(this.state.columns[i]) === id)) return false;
        return this.batch("column-reordered", () => {
            this.store.reorder(uuids.map(id => byUuid.get(id))); this.changed = true; return true;
        });
    }

    moveFocused(delta) {
        if (!this.ready() || ![-1, 1].includes(delta)) return false;
        const index = this.store.focusedIndex();
        const next = index + delta;
        if (index < 0 || next < 0 || next >= this.state.columns.length) return false;
        return this.batch("column-moved", () => { this.store.moveFocused(delta); this.changed = true; return true; });
    }

    setWidth(column, mode, reason = "column-width") {
        if (!this.ready() || !this.state.columns.includes(column)) return false;
        mode = normalizeColumnWidthMode(mode, true);
        if (column.widthMode === mode) return false;
        const proposed = this.state.columns.map(c => ({ widthMode: c === column ? mode : c.widthMode }));
        if (!this.validLayout(proposed, this.geometry)) return false;
        return this.batch(reason, () => {
            const previous = column.widthMode === "full" ? column.previousNonFullWidthMode : column.widthMode;
            column.widthMode = mode;
            column.previousNonFullWidthMode = normalizePreviousNonFullWidthMode(previous, mode, true);
            this.store.focusColumn(column); this.changed = true; return true;
        });
    }

    setGeometry(geometry) {
        if (!this.ready()) return false;
        let next;
        try { next = this.copyGeometry(geometry); } catch (_error) { return false; }
        if (this.sameGeometry(this.geometry, next) || !this.validLayout(this.state.columns, next)) return false;
        return this.batch("working-area-changed", () => { this.geometry = next; this.scopeRevision++; this.lastSample=null; this.changed = true; return true; });
    }

    reflow(reason = "native-recovery") {
        if (!this.ready()) return false;
        return this.batch(reason, () => {this.changed=true;return true;});
    }

    center(window) {
        if (!this.ready() || this.store.indexOfWindow(window) < 0) return false;
        return this.batch("center-focused-column", () => {
            this.store.focusWindow(window); this.centerRequested = true; this.changed = true; return true;
        });
    }

    captureView() {
        const focused = this.store.focusedColumn();
        return this.ready() && focused ? { focusedUuid: this.uuid(focused),
            anchor: { uuid: this.uuid(focused), delta: this.state.scrollOffsetX - focused.logicalX } } : null;
    }

    stop() {
        if (!this.enabled) return false;
        if (this.busy) { this.stopRequested = true; return true; }
        this.enabled = false;
        this.geometry = null;
        this.lastTarget = null;
        this.lastSample = null;
        this.state.activeWorkspaceId = null;
        this.state.targetOutput = null;
        this.state.scrollOffsetX = 0;
        this.outputName = "";
        this.scopeRevision++;
        try { this.store.clear(); } catch (_error) { this.cleanupFailed = true; }
        return !this.cleanupFailed;
    }
}

/* cjs:start */
module.exports = { ContinuousViewportController };
/* cjs:end */
