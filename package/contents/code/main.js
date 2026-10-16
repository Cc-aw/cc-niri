/* SPDX-License-Identifier: MIT
 * CC Niri Maximize V3 - V2 safe areas plus main-output scrollable columns.
 */

/* BEGIN GENERATED KWIN MODULES */
// Generated from src/kwin/model/ColumnStore.js
// Opt in only for V2 model consumers. V1 snapshots keep their existing migration.
function normalizeColumnWidthMode(value, scrollLayoutV2Enabled = false) {
    if (value === "full") return "full";
    return scrollLayoutV2Enabled === true && value === "twoThirds" ? "twoThirds" : "half";
}

function normalizePreviousNonFullWidthMode(value, widthMode, scrollLayoutV2Enabled = false) {
    if (scrollLayoutV2Enabled !== true) return "half";
    if (widthMode !== "full") return normalizeColumnWidthMode(widthMode, true);
    return value === "twoThirds" ? "twoThirds" : "half";
}

class ColumnStore {
    constructor(state, onMembershipChanged = () => {}, options = {}) {
        this.state = state;
        this.onMembershipChanged = onMembershipChanged;
        this.scrollLayoutV2Enabled = options.scrollLayoutV2Enabled === true;
    }

    indexOf(column) {
        return this.state.columns.indexOf(column);
    }

    clear() {
        this.state.columns = [];
        this.state.focusedColumnIndex = -1;
        this.onMembershipChanged();
    }

    indexOfWindow(window) {
        return this.state.columns.findIndex(column => column.window === window);
    }

    focusedIndex() {
        return this.state.focusedColumnIndex;
    }

    focusedColumn() {
        return this.state.columns[this.state.focusedColumnIndex] || null;
    }

    focusIndex(index) {
        if (!this.state.columns.length) {
            this.state.focusedColumnIndex = -1;
            return null;
        }
        const numericIndex = Number(index);
        if (!Number.isInteger(numericIndex) || numericIndex < 0 ||
                numericIndex >= this.state.columns.length) {
            return null;
        }
        this.state.focusedColumnIndex = numericIndex;
        return this.state.columns[numericIndex];
    }

    focusColumn(column) {
        return this.focusIndex(this.indexOf(column));
    }

    focusWindow(window) {
        return this.focusIndex(this.indexOfWindow(window));
    }

    insertWindow(window, insertionIndex, widthMode, previousNonFullWidthMode) {
        if (this.indexOfWindow(window) >= 0) return null;
        const column = {
            id: this.state.nextColumnId++,
            window,
            widthMode: normalizeColumnWidthMode(widthMode, this.scrollLayoutV2Enabled),
            previousNonFullWidthMode: normalizePreviousNonFullWidthMode(
                previousNonFullWidthMode, widthMode, this.scrollLayoutV2Enabled),
            persistentWide: false,
            logicalX: 0,
            pixelWidth: 0,
        };
        const requestedIndex = Number(insertionIndex);
        const index = Math.max(0, Math.min(
            Number.isFinite(requestedIndex)
                ? requestedIndex
                : this.state.columns.length,
            this.state.columns.length
        ));
        this.state.columns.splice(index, 0, column);
        this.onMembershipChanged();
        return column;
    }

    removeWindow(window) {
        const index = this.indexOfWindow(window);
        if (index < 0) return null;
        const focusedColumn = this.focusedColumn();
        const column = this.state.columns[index];
        const wasFocused = focusedColumn === column;
        this.state.columns.splice(index, 1);

        if (!this.state.columns.length) {
            this.state.focusedColumnIndex = -1;
        } else if (wasFocused) {
            this.state.focusedColumnIndex = Math.min(
                index,
                this.state.columns.length - 1
            );
        } else {
            const preservedIndex = this.state.columns.indexOf(focusedColumn);
            this.state.focusedColumnIndex = preservedIndex >= 0
                ? preservedIndex
                : Math.min(index, this.state.columns.length - 1);
        }
        this.onMembershipChanged();
        return { column, index, wasFocused };
    }

    reorder(columns) {
        if (!Array.isArray(columns) || columns.length !== this.state.columns.length) {
            return false;
        }
        const current = new Set(this.state.columns);
        if (new Set(columns).size !== columns.length ||
                columns.some(column => !current.has(column))) {
            return false;
        }
        const focusedColumn = this.focusedColumn();
        this.state.columns = columns.slice();
        this.state.focusedColumnIndex = focusedColumn
            ? this.state.columns.indexOf(focusedColumn)
            : -1;
        return true;
    }

    moveFocused(delta) {
        const oldIndex = this.state.focusedColumnIndex;
        if (oldIndex < 0 || oldIndex >= this.state.columns.length) return null;
        const nextIndex = Math.max(0, Math.min(
            this.state.columns.length - 1,
            oldIndex + delta
        ));
        if (nextIndex === oldIndex) return null;
        const column = this.state.columns[oldIndex];
        this.state.columns[oldIndex] = this.state.columns[nextIndex];
        this.state.columns[nextIndex] = column;
        this.state.focusedColumnIndex = nextIndex;
        return { column, oldIndex, nextIndex };
    }
}

// Generated from src/kwin/model/WindowStateStore.js
class WindowStateStore {
    constructor(createState) {
        this.createState = createState;
        this.states = new Map();
    }

    has(window) {
        return this.states.has(window);
    }

    get(window) {
        return this.states.get(window);
    }

    ensure(window) {
        let state = this.states.get(window);
        if (!state) {
            state = this.createState(window);
            this.states.set(window, state);
        }
        return state;
    }

    delete(window) {
        return this.states.delete(window);
    }

    forEach(callback) {
        this.states.forEach(callback);
    }
}

// Generated from src/kwin/workspace/WorkspaceSnapshotStore.js
// Only plain, steady-state data crosses this boundary. Never retain live Columns,
// windows, temporary Column IDs or pending transition state.
function workspaceSnapshotUuid(value) {
    return typeof value === "string"
        ? value.trim().toLowerCase().replace(/^\{/, "").replace(/\}$/, "") : "";
}

function workspaceSnapshotId(value) {
    return typeof value === "string" ? value.trim() : "";
}

// An explicit version is required: historical, unversioned twoThirds meant half.
function normalizeWorkspaceWidthV2(value) {
    if (value === undefined) return undefined;
    if (!value || value.version !== 1 || !["half", "twoThirds", "full"].includes(value.widthMode) ||
            !["half", "twoThirds"].includes(value.previousNonFullWidthMode)) {
        throw new TypeError("invalid-width-v2");
    }
    return { version: 1, widthMode: value.widthMode,
        previousNonFullWidthMode: normalizePreviousNonFullWidthMode(
            value.previousNonFullWidthMode, value.widthMode, true) };
}

function workspaceColumnPreference(column, uuid, v2 = false) {
    const entry = { uuid, widthMode: column.widthMode,
        previousNonFullWidthMode: column.previousNonFullWidthMode, persistentWide: column.persistentWide === true };
    const width = v2 ? { version: 1, widthMode: column.widthMode,
        previousNonFullWidthMode: column.previousNonFullWidthMode } : column.widthV2;
    if (width !== undefined) entry.widthV2 = normalizeWorkspaceWidthV2(width);
    return entry;
}

function normalizeViewportAnchorV2(value, member) {
    if (value === undefined || value === null) return null;
    const basis = value.basis;
    if (value.version !== 1 || typeof value.uuid !== "string" ||
            !Number.isFinite(value.delta) || Math.abs(value.delta) > 10000000 || !basis ||
            !Number.isFinite(basis.gap) || basis.gap < 0 || basis.gap > 1000000 ||
            !Number.isFinite(basis.physicalScale) || basis.physicalScale <= 0 || basis.physicalScale > 16 ||
            !["outputRect", "workingArea"].every(key => basis[key] &&
                ["x", "y", "width", "height"].every(field => Number.isFinite(basis[key][field]) && Math.abs(basis[key][field]) <= 10000000) &&
                basis[key].width > 0 && basis[key].height > 0)) throw new TypeError("invalid-anchor-v2");
    const uuid = member(value.uuid);
    const rect = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    return uuid ? { version: 1, uuid, delta: value.delta, basis: {
        outputRect: rect(basis.outputRect), workingArea: rect(basis.workingArea),
        gap: basis.gap, physicalScale: basis.physicalScale } } : null;
}

function normalizeWorkspaceSnapshot(workspaceId, snapshot) {
    const id = workspaceSnapshotId(workspaceId);
    if (!id) throw new TypeError("workspaceId must be a non-empty stable ID");
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const seen = new Set();
    const columns = [];
    if (Array.isArray(source.columns) && source.columns.length > 256) throw new TypeError("too-many-columns");
    for (const column of Array.isArray(source.columns) ? source.columns : []) {
        const uuid = workspaceSnapshotUuid(column && column.uuid);
        if (!uuid || seen.has(uuid)) continue;
        seen.add(uuid);
        const widthV2 = normalizeWorkspaceWidthV2(column.widthV2);
        if (widthV2 && !["half", "twoThirds", "full"].includes(column.widthMode)) throw new TypeError("invalid-versioned-width");
        const widthMode = normalizeColumnWidthMode(column.widthMode, Boolean(widthV2));
        const entry = {
            uuid,
            widthMode,
            previousNonFullWidthMode: normalizePreviousNonFullWidthMode(
                column.previousNonFullWidthMode, widthMode, Boolean(widthV2)),
            persistentWide: column.persistentWide === true,
        };
        if (widthV2) entry.widthV2 = widthV2;
        columns.push(entry);
    }
    const member = value => {
        const uuid = workspaceSnapshotUuid(value);
        return seen.has(uuid) ? uuid : null;
    };
    const anchor = source.viewportAnchor;
    const anchorUuid = member(anchor && anchor.uuid);
    const validAnchor = anchorUuid && typeof anchor.delta === "number" &&
        Number.isFinite(anchor.delta) && anchor.delta >= 0;
    const migratedWidths = (Array.isArray(source.columns) ? source.columns : []).some(column =>
        column && !column.widthV2 && ["third", "twoThirds"].includes(column.widthMode));
    const viewport = source.viewport || {};
    const wideUuid = member(viewport.wideUuid);
    const wide = ["wide", "wide-focus"].includes(viewport.mode) && wideUuid;
    const presentation = source.presentation || {};
    const windowUuid = member(presentation.windowUuid);
    const presented = ["wide", "maximized"].includes(presentation.mode) && windowUuid;
    const result = {
        workspaceId: id, columns,
        focusedUuid: member(source.focusedUuid),
        viewportAnchor: validAnchor ? { uuid: anchorUuid, delta: migratedWidths ? 0 : anchor.delta } : null,
        viewport: { mode: wide ? "wide" : "pair", wideUuid: wide ? wideUuid : null },
        presentation: {
            mode: presented ? presentation.mode : "normal",
            windowUuid: presented ? windowUuid : null,
        },
    };
    if (source.viewportAnchorV2 !== undefined) result.viewportAnchorV2 = normalizeViewportAnchorV2(source.viewportAnchorV2, member);
    if (source.dormantViewportV1 !== undefined) {
        const dormant = source.dormantViewportV1;
        if (!dormant || dormant.version !== 1 || !["pair", "wide", "wide-focus"].includes(dormant.mode))
            throw new TypeError("invalid-dormant-viewport");
        const uuid = member(dormant.wideUuid);
        result.dormantViewportV1 = { version: 1, mode: dormant.mode !== "pair" && uuid ? "wide" : "pair",
            wideUuid: dormant.mode !== "pair" ? uuid : null };
    }
    return result;
}

// Accept the same protocol-1 column/anchor envelope used by StartupLayout.
// A caller may supply expectedTargetOutput to reject another output's saved data.
// This helper neither loads nor publishes Bridge state.
function migrateLegacyWorkspaceSnapshot(legacy, workspaceId, expectedTargetOutput) {
    let source = legacy;
    if (typeof source === "string") {
        try { source = JSON.parse(source); } catch (_error) { return null; }
    }
    if (!workspaceSnapshotId(workspaceId) || !source || source.protocol !== 1 ||
            !Array.isArray(source.columns) ||
            (expectedTargetOutput !== undefined && source.targetOutput !== expectedTargetOutput)) {
        return null;
    }
    const uuids = source.columns.map(column => workspaceSnapshotUuid(column && column.uuid));
    if (uuids.some(uuid => !uuid) || new Set(uuids).size !== uuids.length) return null;
    const presentation = source.presentation || {};
    // Protocol 1 represents contextual Wide through presentation, without viewport.
    return normalizeWorkspaceSnapshot(workspaceId, Object.assign({}, source, {
        columns: source.columns.map(column => Object.assign({}, column, {
            persistentWide: column.persistentWide === true || (presentation.mode === "wide" &&
                workspaceSnapshotUuid(column.uuid) === workspaceSnapshotUuid(presentation.windowUuid)),
        })),
        viewport: presentation.mode === "wide"
            ? { mode: "wide", wideUuid: presentation.windowUuid } : { mode: "pair" },
    }));
}

class WorkspaceSnapshotStore {
    constructor() {
        this.snapshots = new Map();
        this.uuidOwner = new Map();
    }

    get(id) {
        const snapshot = this.snapshots.get(workspaceSnapshotId(id));
        return snapshot ? normalizeWorkspaceSnapshot(snapshot.workspaceId, snapshot) : null;
    }

    set(id, snapshot) {
        const normalized = normalizeWorkspaceSnapshot(id, snapshot);
        // Check before modifying either map: a conflicting write is atomic.
        for (const column of normalized.columns) {
            const owner = this.uuidOwner.get(column.uuid);
            if (owner !== undefined && owner !== normalized.workspaceId) {
                throw new Error(`duplicate-workspace-owner:${column.uuid}`);
            }
        }
        this.remove(normalized.workspaceId);
        this.snapshots.set(normalized.workspaceId, normalized);
        normalized.columns.forEach(column => this.uuidOwner.set(column.uuid, normalized.workspaceId));
        return this.get(normalized.workspaceId);
    }

    has(id) {
        return this.snapshots.has(workspaceSnapshotId(id));
    }

    remove(id) {
        const key = workspaceSnapshotId(id);
        const snapshot = this.snapshots.get(key);
        if (!snapshot) return false;
        snapshot.columns.forEach(column => this.uuidOwner.delete(column.uuid));
        return this.snapshots.delete(key);
    }

    removeWindow(uuid) {
        const key = workspaceSnapshotUuid(uuid);
        const owner = this.uuidOwner.get(key);
        if (owner === undefined) return false;
        const snapshot = this.get(owner);
        snapshot.columns = snapshot.columns.filter(column => column.uuid !== key);
        this.set(owner, snapshot); // normalization also clears dangling references
        return true;
    }

    workspaceForWindow(uuid) {
        return this.uuidOwner.get(workspaceSnapshotUuid(uuid)) || null;
    }

    all() {
        return Array.from(this.snapshots.keys(), id => this.get(id));
    }

    clear() {
        this.snapshots.clear();
        this.uuidOwner.clear();
    }
}

// Generated from src/kwin/workspace/WorkspacePersistence.js
class WorkspacePersistence {
    constructor(options) {
        this.snapshots = options.snapshots;
        this.hasDesktop = options.hasDesktop;
    }

    validColumns(columns) {
        if (!Array.isArray(columns)) return false;
        const normalized = normalizeWorkspaceSnapshot("validation", { columns });
        return normalized.columns.length === columns.length;
    }

    validWorkspace(source) {
        if (!source || !this.validColumns(source.columns)) return false;
        const normalized = normalizeWorkspaceSnapshot("validation", source);
        return !source.viewportAnchorV2 || Boolean(normalized.viewportAnchorV2);
    }

    restore(previousState, currentId, targetOutput) {
        let source = previousState;
        if (typeof source === "string" && source.length > 1024 * 1024) return false;
        if (typeof source === "string") {
            try { source = JSON.parse(source); } catch (_) { return false; }
        }
        const candidate = new WorkspaceSnapshotStore();
        if (!source || source.targetOutput !== targetOutput) return false;
        try {
            if (source.protocol === 1) {
                if (!this.validWorkspace(source)) return false;
                const legacy = migrateLegacyWorkspaceSnapshot(source, currentId, targetOutput);
                if (!legacy) return false;
                candidate.set(currentId, legacy);
            } else if (source.protocol === 2) {
                if (!Array.isArray(source.workspaces) || source.workspaces.length > 256 || !this.validWorkspace(source) ||
                        typeof source.workspaceId !== "string" || !source.workspaceId.trim()) return false;
                const ids = new Set();
                for (const workspace of source.workspaces) {
                    const id = workspace && typeof workspace.id === "string" ? workspace.id.trim() : "";
                    if (!id || ids.has(id) || !this.validWorkspace(workspace)) return false;
                    ids.add(id);
                    candidate.set(id, workspace); // Reject conflicting UUID owners before committing.
                }
                const active = candidate.get(source.workspaceId);
                const root = normalizeWorkspaceSnapshot("validation", source);
                const columns = root.columns;
                if (!active || columns.length !== active.columns.length || columns.some((column, index) =>
                    column.uuid !== active.columns[index].uuid || column.widthMode !== active.columns[index].widthMode ||
                    JSON.stringify(column.widthV2 || null) !== JSON.stringify(active.columns[index].widthV2 || null))) return false;
                if (JSON.stringify(root.viewportAnchorV2 || null) !== JSON.stringify(active.viewportAnchorV2 || null)) return false;
            } else return false;
        } catch (_) { return false; }
        const restored = candidate.all().filter(snapshot => this.hasDesktop(snapshot.workspaceId));
        this.snapshots.clear();
        restored.forEach(snapshot => this.snapshots.set(snapshot.workspaceId, snapshot));
        return true;
    }

    snapshot(active) {
        return Object.assign({}, active, {
            workspaces: this.snapshots.all().map(snapshot => {
                // KWin's QJSEngine does not parse object rest destructuring.
                const data = Object.assign({}, snapshot);
                delete data.workspaceId;
                return Object.assign({ id: snapshot.workspaceId }, data);
            }),
        });
    }
}

// Generated from src/kwin/workspace/WorkspaceMembership.js
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

// Generated from src/kwin/workspace/WorkspaceOccupancy.js
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

// Generated from src/kwin/workspace/VirtualDesktopTopology.js
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
    byNumber(number) {
        return Number.isInteger(number) && number > 0 ? this.ordered()[number - 1] || null : null;
    }
    affectsOutput(output, targetOutput) {
        return Boolean(targetOutput && (!output || output === targetOutput));
    }
}

// Generated from src/kwin/workspace/WorkspaceMountController.js
class WorkspaceMountController {
    constructor(options) {
        Object.assign(this, options);
        this.stopped = false;
        this.persistence = options.persistence || new WorkspacePersistence({
            snapshots: this.snapshots, hasDesktop: id => Boolean(this.topology.byId(id)),
        });
    }

    currentId() {
        return this.topology.id(this.topology.current(this.appState.targetOutput));
    }

    canUseActiveWorkspace() {
        return Boolean(!this.stopped && this.appState.enabled &&
            !this.appState.workspaceSwitching && this.appState.activeWorkspaceId &&
            this.currentId() === this.appState.activeWorkspaceId);
    }

    eligible(window, workspaceId) {
        return Boolean(window && this.normalizeUuid(window.internalId) &&
            this.windowPolicy.canJoinColumn(window) &&
            this.membership.belongsTo(window, workspaceId) &&
            window.output === this.appState.targetOutput && !this.stateFor(window).floating);
    }

    pruneSnapshots() {
        const windows = new Map(this.getWindows().map(window => [this.normalizeUuid(window.internalId), window]));
        this.snapshots.all().forEach(snapshot => {
            if (!this.topology.byId(snapshot.workspaceId)) {
                this.snapshots.remove(snapshot.workspaceId);
                return;
            }
            snapshot.columns = snapshot.columns.filter(column =>
                this.eligible(windows.get(column.uuid), snapshot.workspaceId));
            this.snapshots.set(snapshot.workspaceId, snapshot);
        });
    }

    capture() {
        const state = this.appState;
        if (!state.activeWorkspaceId) return null;
        const columns = state.columns.filter(column => this.eligible(column.window, state.activeWorkspaceId));
        const focused = this.columnStore.focusedColumn();
        const anchor = columns.reduce((previous, column) =>
            column.logicalX <= state.scrollOffsetX ? column : previous, null);
        const wide = columns.find(column => column.id === state.viewport.wideColumnId);
        const previous = this.snapshots.get(state.activeWorkspaceId);
        const result = {
            columns: columns.map(column => workspaceColumnPreference(column,
                this.normalizeUuid(column.window.internalId), this.scrollLayoutV2Enabled)),
            focusedUuid: focused ? this.normalizeUuid(focused.window.internalId) : null,
            viewportAnchor: anchor ? { uuid: this.normalizeUuid(anchor.window.internalId),
                delta: state.scrollOffsetX - anchor.logicalX } : null,
            viewport: { mode: state.viewport.mode, wideUuid: wide ? this.normalizeUuid(wide.window.internalId) : null },
            presentation: state.presentation,
        };
        if (this.captureV2View) result.viewportAnchorV2 = this.captureV2View();
        else if (previous && previous.viewportAnchorV2 !== undefined) result.viewportAnchorV2 = previous.viewportAnchorV2;
        if (this.scrollLayoutV2Enabled && previous) result.dormantViewportV1 = previous.dormantViewportV1 ||
            Object.assign({ version: 1 }, previous.viewport);
        else if (previous && previous.dormantViewportV1) result.dormantViewportV1 = Object.assign({ version: 1 }, result.viewport);
        return this.snapshots.set(state.activeWorkspaceId, result);
    }

    unmount(capture = true) {
        if (capture) this.capture();
        this.resetPresentation();
        this.appState.columns.forEach(column => {
            const state = this.stateFor(column.window);
            state.managedByScrollLayout = false;
            state.columnId = null;
            // Parking remains script-owned. A sleeping workspace is not detached.
            state.viewportBeforeFullscreen = null;
            this.transitionAdoption(column.window, state, this.phases.waitingWorkspace, "workspace-unmount");
        });
        this.columnStore.clear();
        this.appState.scrollOffsetX = 0;
        this.appState.activeWorkspaceId = null;
        this.appState.prePresentationViewport = null;
    }

    reconcile(workspaceId, snapshot) {
        const saved = new Map((snapshot ? snapshot.columns : []).map(column => [column.uuid, column]));
        const windows = new Map();
        // prepareWindow can synchronously emit signals. A second enumeration also
        // includes windows added during native maximize/tile preparation.
        for (let pass = 0; pass < 2; pass += 1) {
            this.getWindows().forEach(window => {
                const uuid = this.normalizeUuid(window.internalId);
                if (windows.has(uuid) || !this.eligible(window, workspaceId) ||
                        (window.fullScreen && !saved.has(uuid))) return;
                if (window.fullScreen || this.prepareWindow(window)) windows.set(uuid, window);
            });
        }
        windows.forEach((window, uuid) => {
            if (!this.eligible(window, workspaceId) ||
                    (window.fullScreen && !saved.has(uuid))) windows.delete(uuid);
        });
        const order = [];
        saved.forEach((entry, uuid) => {
            if (windows.has(uuid)) { order.push({ window: windows.get(uuid), entry }); windows.delete(uuid); }
        });
        windows.forEach((window, uuid) => order.push({ window, entry: { uuid, widthMode: "half", persistentWide: false } }));
        return order;
    }

    hydrate(workspaceId, snapshot, focusedUuid = null) {
        const state = this.appState;
        const entries = this.reconcile(workspaceId, snapshot);
        state.activeWorkspaceId = workspaceId;
        entries.forEach(({ window, entry }) => {
            const column = this.columnStore.insertWindow(window, state.columns.length,
                this.scrollLayoutV2Enabled && entry.widthV2 ? entry.widthV2.widthMode : entry.widthMode,
                this.scrollLayoutV2Enabled && entry.widthV2 ? entry.widthV2.previousNonFullWidthMode : entry.previousNonFullWidthMode);
            column.persistentWide = entry.persistentWide;
            if (entry.widthV2) column.widthV2 = entry.widthV2;
            const windowState = this.stateFor(window);
            windowState.workspaceOwnerId = workspaceId;
            windowState.workspaceColumnPreference = null;
            windowState.managedByScrollLayout = true;
            windowState.columnId = column.id;
            this.transitionAdoption(window, windowState, this.phases.managed, "workspace-mount");
        });
        this.recomputeLayout();
        const kdeIndex = this.columnStore.indexOfWindow(this.getActiveWindow());
        const requestedIndex = focusedUuid ? state.columns.findIndex(column =>
            this.normalizeUuid(column.window.internalId) === focusedUuid) : -1;
        const selectedIndex = requestedIndex >= 0 ? requestedIndex : kdeIndex;
        const savedIndex = snapshot ? state.columns.findIndex(column =>
            this.normalizeUuid(column.window.internalId) === snapshot.focusedUuid) : -1;
        this.columnStore.focusIndex(selectedIndex >= 0 ? selectedIndex : savedIndex >= 0 ? savedIndex : 0);
        if (this.scrollLayoutV2Enabled) {
            this.resetPresentation();
            this.restoreViewport({ mode: "pair", wideColumnId: null });
            this.restoreV2View(snapshot && snapshot.viewportAnchorV2,
                selectedIndex < 0 || selectedIndex === savedIndex);
            return;
        }
        const anchor = snapshot && snapshot.viewportAnchor;
        const anchorColumn = anchor && state.columns.find(column =>
            this.normalizeUuid(column.window.internalId) === anchor.uuid);
        state.scrollOffsetX = this.boundOffset(anchorColumn ? anchorColumn.logicalX + anchor.delta : 0);
        const focused = this.columnStore.focusedColumn();
        // Keep a valid saved anchor unless KDE selected a different Column.
        if (focused && (!anchorColumn || (selectedIndex >= 0 && selectedIndex !== savedIndex))) this.ensureVisible(focused);
        this.resetPresentation();
        // Snapshots store UUIDs, while newly mounted Columns receive fresh IDs.
        // Restore the saved viewport only when KDE still focuses that Wide owner.
        const savedViewport = snapshot && (snapshot.dormantViewportV1 || snapshot.viewport);
        let restoredViewport = { mode: "pair", wideColumnId: null };
        if (focused && focused.persistentWide && !focused.window.fullScreen &&
                savedViewport && ["wide", "wide-focus"].includes(savedViewport.mode) &&
                savedViewport.wideUuid === this.normalizeUuid(focused.window.internalId) &&
                snapshot.presentation.mode !== "maximized") {
            restoredViewport = { mode: "wide-focus", wideColumnId: focused.id };
        }
        this.restoreViewport(restoredViewport);
        this.relayout("workspace-mount");
        // Explicit move-and-follow selects a live mounted Column. Commit its
        // real target before activation; ordinary J/K keeps native focus policy.
        if (requestedIndex >= 0) this.activateColumn(focused.window);
    }

    mountPrepared(desktop, reason, focusedUuid = null) {
        return this.mount(desktop, reason, false, true, focusedUuid);
    }

    mount(desktop, reason = "workspace-switch", commit = true, prepared = false, focusedUuid = null) {
        const state = this.appState;
        const id = this.topology.id(desktop);
        if (this.stopped || (state.workspaceSwitching && !prepared) || !state.enabled || !state.targetOutput || !id) return false;
        state.workspaceSwitching = true;
        try {
            if (!prepared) this.cancelPending(reason);
            this.pruneSnapshots();
            if (!prepared) this.capture();
            const snapshot = this.snapshots.get(id);
            this.unmount(false);
            this.hydrate(id, snapshot, focusedUuid);
            this.capture();
            // V2 publishes the final derived camera in the P4 membership ACK
            // stage, after the workspace barrier opens. Never persist the
            // temporary unmounted camera before applying a signed anchor.
            if (commit && !this.scrollLayoutV2Enabled) this.commitState(reason);
            this.debug(`[cc-workspace] MOUNT id=${id} columns=${state.columns.length} reason=${reason}`);
            return true;
        } catch (error) {
            this.stop();
            this.onFailure(error);
            return false;
        } finally {
            if (!prepared) state.workspaceSwitching = false;
            if (!prepared && !this.stopped && this.onMounted) this.onMounted(reason);
            // A native change can be emitted synchronously by preparation. Its
            // handler was gated by the batch; reconcile the final KDE authority.
            if (!prepared && !this.stopped && state.activeWorkspaceId && this.currentId() &&
                    this.currentId() !== state.activeWorkspaceId) {
                this.onDesktopChanged(null, null, state.targetOutput);
            }
        }
    }

    initialize(previousState) {
        this.refreshState();
        const desktop = this.topology.current(this.appState.targetOutput);
        const id = this.topology.id(desktop);
        this.persistence.restore(previousState, id,
            this.appState.targetOutput ? this.appState.targetOutput.name : "");
        return this.mount(desktop, "script-start-workspace", false);
    }

    onDesktopChanged(_previous, _current, output) {
        this.refreshState();
        if (!this.topology.affectsOutput(output, this.appState.targetOutput) ||
                !this.appState.activeWorkspaceId || this.currentId() === this.appState.activeWorkspaceId) return false;
        // Query KDE's actual current desktop; never hydrate a stale signal payload.
        return this.mount(this.topology.current(this.appState.targetOutput));
    }

    onTopologyChanged() {
        if (this.stopped || this.appState.workspaceSwitching) return false;
        this.pruneSnapshots();
        return this.onDesktopChanged(null, null, this.appState.targetOutput);
    }

    onWindowMembershipChanged(window) {
        const owner = this.snapshots.workspaceForWindow(this.normalizeUuid(window.internalId)) ||
            this.stateFor(window).workspaceOwnerId;
        if (owner && !this.eligible(window, owner)) {
            this.snapshots.removeWindow(this.normalizeUuid(window.internalId));
            // Sleeping parked windows becoming Sticky must immediately be accessible.
            this.releaseWindow(window, "workspace-membership-changed");
        }
    }

    onWindowClosed(window) { this.snapshots.removeWindow(this.normalizeUuid(window.internalId)); }
    stop() {
        if (this.stopped) return;
        this.stopped = true;
        this.cancelPending("workspace-stop");
    }
}

// Generated from src/kwin/workspace/WorkspaceSwitchController.js
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
                    if (!this.mount.scrollLayoutV2Enabled) this.mount.commitState(reason);
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
                if (committed && this.mount.onMounted) this.mount.onMounted(reason);
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

// Generated from src/kwin/workspace/WorkspaceTransferController.js
class WorkspaceTransferController {
    constructor(options) {
        Object.assign(this, options);
        this.processing = new Set();
        // QV4 WeakSet entries holding closed QObject wrappers can crash in
        // sameValueZero on a later add/has. Retain only bounded UUID strings.
        this.closedUuids = new Set();
        this.layoutPending = false;
        this.stopped = false;
    }

    isProcessing() { return this.processing.size > 0; }

    deferLayout() {
        if (!this.isProcessing()) return false;
        this.layoutPending = true;
        return true;
    }

    append(owner, entry) {
        const snapshot = this.snapshots.get(owner) || { columns: [] };
        if (!snapshot.columns.some(column => column.uuid === entry.uuid)) {
            snapshot.columns.push(entry);
            this.snapshots.set(owner, snapshot);
        }
    }

    transfer(window, reason, uuid) {
        const state = this.stateFor(window);
        const column = this.getColumn(window);
        const savedOwner = this.snapshots.workspaceForWindow(uuid);
        const previous = savedOwner || state.workspaceOwnerId;
        const owner = this.membership.ownerId(window);
        const saved = savedOwner && this.snapshots.get(savedOwner);
        const savedEntry = saved && saved.columns.find(item => item.uuid === uuid);
        const eligible = Boolean(uuid && owner && this.topology.byId(owner) &&
            this.windowPolicy.canJoinColumn(window) && !state.floating &&
            (!window.fullScreen || column || savedEntry) &&
            window.output === this.appState.targetOutput);
        const entry = column ? workspaceColumnPreference(column, uuid, this.scrollLayoutV2Enabled)
            : savedEntry ||
                state.workspaceColumnPreference || { uuid, widthMode: "half", persistentWide: false };
        const changed = owner !== previous || !eligible;
        if (changed) {
            state.workspaceColumnPreference = Object.assign({}, entry);
            // Unmanaged dialogs/transients must not retire the active strip's owner.
            if (column || savedEntry || state.managedByScrollLayout) this.cancelPending(window, reason);
            // Restore opacity, script-owned minimization and accessible geometry
            // before removing the live column or assigning the new owner.
            this.releaseWindow(window, reason);
            if (this.closedUuids.has(uuid)) return true;
            if (column) this.removeWindow(window, reason);
            this.snapshots.removeWindow(uuid);
            state.managedByScrollLayout = false;
            state.columnId = null;
            state.viewportBeforeFullscreen = null;
        }
        // A synchronous release signal may have changed desktops again.
        if (this.membership.ownerId(window) !== owner) return false;
        state.workspaceOwnerId = owner;
        state.workspaceColumnPreference = eligible ? Object.assign({}, entry) : null;
        if (eligible && owner !== this.appState.activeWorkspaceId) this.append(owner, entry);
        return true;
    }

    onMembershipChanged(window, reason = "window-desktops-changed") {
        if (!window || this.stopped || !this.appState.enabled) return false;
        const uuid = this.normalizeUuid(window.internalId);
        if (!uuid || this.closedUuids.has(uuid) || this.processing.has(uuid)) return false;
        this.processing.add(uuid);
        let completed = false;
        try {
            for (let pass = 0; pass < 8; pass += 1) {
                if (this.transfer(window, reason, uuid)) { completed = true; break; }
            }
            if (!completed) throw new Error("workspace-transfer-membership-unstable");
        } catch (error) {
            this.stop();
            this.onFailure(error);
            return false;
        } finally {
            this.processing.delete(uuid);
        }
        if (this.stopped) return false;
        try {
            if (!this.isProcessing() && this.canCommit() && this.layoutPending) {
                this.layoutPending = false;
                this.flushLayout(reason);
            }
            // Adoption retains Floating/Dialog/native policies and waits for
            // real activation when entering the active workspace without focus.
            if (!this.closedUuids.has(uuid)) {
                if (this.canCommit() && !this.isProcessing()) this.adoption.onMembershipChanged(window, reason);
                else this.adoption.begin(window, reason);
            }
            if (!this.isProcessing() && this.canCommit()) this.commitState(reason);
            return true;
        } catch (error) {
            this.stop();
            this.onFailure(error);
            return false;
        }
    }

    onWindowAdded(window) { return this.onMembershipChanged(window, "workspace-window-added"); }
    onWindowClosed(window) {
        const uuid = this.normalizeUuid(window.internalId);
        if (!uuid) return;
        this.closedUuids.add(uuid);
        if (this.closedUuids.size > 4096) this.closedUuids.delete(this.closedUuids.values().next().value);
        this.snapshots.removeWindow(uuid);
    }
    commitClosed() {
        if (!this.stopped && !this.isProcessing() && this.canCommit()) this.commitState("workspace-window-closed");
    }
    stop() { this.stopped = true; }
}

// Generated from src/kwin/workspace/WorkspaceMoveController.js
// Command intent stays in JS. Native desktop membership, the existing transfer
// reconciler and switch/mount transaction remain the source of truth.
class WorkspaceMoveController {
    constructor(options) {
        Object.assign(this, options);
        this.pending = null;
        this.stopped = false;
    }

    activeColumn() {
        if (this.stopped || this.pending || !this.mount.canUseActiveWorkspace() ||
                this.switcher.phase !== "IDLE" || this.transfer.isProcessing()) return null;
        const window = this.getActiveWindow();
        if (!window || window.output !== this.appState.targetOutput ||
                this.stateFor(window).floating ||
                !this.windowPolicy.canJoinColumn(window) ||
                !this.membership.belongsTo(window, this.appState.activeWorkspaceId)) return null;
        const index = this.columnStore.indexOfWindow(window);
        return index >= 0 ? this.appState.columns[index] : null;
    }

    movePrevious() { return this.moveRelative(-1); }
    moveNext() { return this.moveRelative(1); }

    moveNumber(number) {
        if (!Number.isInteger(number) || number < 1 || number > 9) return false;
        const target = this.topology.byNumber(number);
        return target ? this.moveTo(this.topology.id(target)) : false;
    }

    moveRelative(direction) {
        if (!this.activeColumn()) return false;
        const current = this.topology.current(this.appState.targetOutput);
        const target = direction < 0 ? this.topology.previous(current) : this.topology.next(current);
        return target ? this.moveTo(this.topology.id(target)) : false;
    }

    moveTo(targetId) {
        const column = this.activeColumn();
        const target = this.topology.byId(targetId);
        if (!column || !target || targetId === this.appState.activeWorkspaceId) return false;
        const pending = { uuid: this.normalizeUuid(column.window.internalId),
            sourceId: this.appState.activeWorkspaceId, targetId,
            outputName: this.appState.targetOutput.name };
        if (!pending.uuid) return false;
        this.columnStore.focusColumn(column); // The actual active Column, even during a pending H/L ACK.
        this.pending = pending;
        const accepted = this.switcher.requestTo(target, {
            reason: "workspace-column-move", focusedUuid: pending.uuid,
            prepare: done => this.settleMotion(() => {
                if (this.pending !== pending || this.stopped) { done(false); return; }
                try { done(this.prepare(pending)); }
                catch (error) {
                    this.onFailure(error);
                    done(false);
                }
            }),
            onFinished: mountedId => this.finish(pending, mountedId),
        });
        if (!accepted && this.pending === pending) this.pending = null;
        return accepted;
    }

    liveWindow(uuid) {
        return this.getWindows().find(window => this.normalizeUuid(window.internalId) === uuid) || null;
    }

    prepare(pending) {
        const state = this.appState;
        const window = this.liveWindow(pending.uuid);
        const target = this.topology.byId(pending.targetId);
        if (!window || !target || !state.enabled || !state.targetOutput ||
                state.targetOutput.name !== pending.outputName ||
                this.topology.id(this.topology.current(state.targetOutput)) !== pending.sourceId ||
                this.getActiveWindow() !== window || window.output !== state.targetOutput ||
                !this.windowPolicy.canJoinColumn(window) ||
                this.stateFor(window).floating ||
                !this.membership.belongsTo(window, pending.sourceId) ||
                this.columnStore.indexOfWindow(window) < 0) return false;
        this.clearPresentation();
        this.changeMembership(window, target);
        // setDesktops can emit synchronously or queue its notification. Resolve
        // the actual property through the same idempotent native transfer path.
        const current = this.liveWindow(pending.uuid);
        if (!current) return false;
        this.transfer.onMembershipChanged(current, "workspace-column-move");
        this.settleSourceLayout();
        this.mount.capture(); // Capture the remaining right/left successor, not the moved owner.
        if (!this.liveWindow(pending.uuid) || this.transfer.stopped ||
                !this.topology.byId(pending.targetId) ||
                !this.membership.belongsTo(current, pending.targetId)) return false;
        if (this.snapshots.workspaceForWindow(pending.uuid) !== pending.targetId)
            throw new Error("workspace-move-owner-mismatch");
        const snapshot = this.snapshots.get(pending.targetId);
        snapshot.focusedUuid = pending.uuid;
        snapshot.viewportAnchor = { uuid: pending.uuid, delta: 0 };
        snapshot.viewport = { mode: "pair", wideUuid: null };
        snapshot.presentation = { mode: "normal", windowUuid: null };
        this.snapshots.set(pending.targetId, snapshot);
        return true;
    }

    finish(pending, mountedId) {
        if (this.pending !== pending) return;
        this.pending = null;
        this.debug(`[cc-workspace] MOVE uuid=${pending.uuid} source=${pending.sourceId}` +
            ` target=${pending.targetId} mounted=${mountedId || "<none>"}`);
        if (!this.stopped) this.onSettled();
    }

    stop() { this.stopped = true; this.pending = null; }
}

// Generated from src/kwin/workspace/DynamicWorkspaceController.js
class DynamicWorkspaceController {
    constructor(options) {
        Object.assign(this, options);
        this.enabled = options.enabled === true;
        this.occupancy = options.occupancy || new WorkspaceOccupancy({ membership: this.membership });
        this.onSettled = options.onSettled || (() => {});
        this.timer = null;
        this.pendingTopology = null;
        this.failedTopology = null;
        this.stopped = false;
    }

    request() {
        if (!this.enabled || this.stopped || !this.isReady() || this.timer) return false;
        // Retain no Window QObject across this deferred occupancy check.
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.reconcile();
        }, 100);
        return true;
    }

    desktopIds() {
        const desktops = this.getDesktops();
        const ids = [];
        for (let index = 0; index < desktops.length; ++index) ids.push(desktops[index].id);
        return ids;
    }

    occupies(window, desktopId, output) {
        return this.occupancy.occupies(window, desktopId, output);
    }

    fail(key, reason) {
        this.pendingTopology = null;
        this.failedTopology = key;
        this.warn(`[cc-workspace] trailing desktop unavailable: ${reason}`);
        this.onSettled();
    }

    reconcile() {
        if (!this.enabled || this.stopped) return false;
        const ids = this.desktopIds();
        if (!ids.length || ids.some(id => typeof id !== "string" || !id)) return false;
        const key = JSON.stringify(ids);
        if (this.pendingTopology !== null) {
            if (this.pendingTopology === key) {
                this.fail(key, "creation not confirmed by KDE");
                return false;
            }
            this.pendingTopology = null;
            this.onSettled();
        }
        if (!this.isReady()) return false;
        // KDE keeps its row count when desktops are appended. One column
        // requires rows=count, including existing desktops at startup.
        this.ensureVerticalLayout(ids.length);
        if (this.failedTopology === key) return false;
        const output = this.getTargetOutput();
        if (!output) return false;
        const windows = this.getWindows();
        let occupied = false;
        for (let index = 0; index < windows.length; ++index) {
            if (this.occupies(windows[index], ids[ids.length - 1], output)) { occupied = true; break; }
        }
        if (!occupied) return false;
        if (typeof this.createDesktop !== "function") {
            this.fail(key, "createDesktop API missing");
            return false;
        }
        // Arm before calling KWin: desktopsChanged may be synchronous. A no-op
        // at the native desktop limit is warned once per topology, never retried.
        this.pendingTopology = key;
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.reconcile();
        }, 1000);
        try {
            this.createDesktop(ids.length, "");
            // Synchronous creation must repair the grid before the next J/K;
            // delayed creation is handled by the confirmation check above.
            if (!this.stopped) this.ensureVerticalLayout(this.desktopIds().length);
        } catch (error) {
            this.clearTimer(this.timer);
            this.timer = null;
            this.fail(key, String(error));
            return false;
        }
        return true;
    }

    stop() {
        this.stopped = true;
        if (this.timer) this.clearTimer(this.timer);
        this.timer = null;
        this.pendingTopology = null;
    }
}

// Generated from src/kwin/workspace/WorkspaceRecycleController.js
class WorkspaceRecycleController {
    constructor(options) {
        Object.assign(this, options);
        this.enabled = options.enabled === true;
        this.timer = null;
        this.pendingId = null;
        this.pendingError = null;
        this.confirmedIds = [];
        this.failedTopology = null;
        this.stopped = false;
        this.transitionCheck = null;
        this.transitionAttempts = 0;
    }

    request(retry = false) {
        if (!this.enabled || this.stopped || !this.isReady() || this.timer || this.transitionCheck) return false;
        if (!retry) this.transitionAttempts = 0;
        // The timer retains only this controller; no Window/Desktop QObjects.
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.reconcile();
        }, 200);
        return true;
    }

    onDesktopChanged() {
        // Reject a reply from an earlier switch even if J/K returned to the
        // same desktop UUID. Never keep a Desktop QObject across this barrier.
        if (this.transitionCheck) this.clearTimer(this.transitionCheck.timer);
        this.transitionCheck = null;
        this.transitionAttempts = 0;
    }

    awaitTransitionIdle() {
        if (this.transitionCheck || this.transitionAttempts >= 60) return false;
        const check = { timer: null };
        this.transitionCheck = check;
        ++this.transitionAttempts;
        const finish = active => {
            if (this.stopped || this.transitionCheck !== check) return;
            this.clearTimer(check.timer);
            this.transitionCheck = null;
            if (active === false) {
                // Recompute occupancy, current desktops and candidate now;
                // nothing selected before the asynchronous reply is trusted.
                this.reconcile(true);
            } else if (this.transitionAttempts < 60) {
                this.request(true);
            }
        };
        check.timer = this.setTimer(() => finish(null), 1000);
        try {
            if (typeof this.transitionStatus !== "function") { finish(null); return false; }
            this.transitionStatus(finish);
        } catch (_error) { finish(null); }
        return true;
    }

    fail(key, reason) {
        this.pendingId = null;
        this.failedTopology = key;
        this.warn(`[cc-workspace] recycle unavailable: ${reason}`);
    }

    reconcile(compositorIdle = false) {
        if (!this.enabled || this.stopped) return false;
        let ids = this.getDesktopIds();
        if (!ids.length || ids.some(id => typeof id !== "string" || !id)) return false;
        let key = JSON.stringify(ids);
        if (this.pendingId !== null) {
            if (ids.includes(this.pendingId)) {
                this.fail(key, this.pendingError || "removal not confirmed by KDE");
                return false;
            }
            this.confirmedIds.push(this.pendingId);
            this.pendingId = null;
            this.pendingError = null;
        }
        if (!this.isReady()) return false;
        this.ensureVerticalLayout(ids.length);
        while (this.confirmedIds.length) {
            try {
                this.onRemoved(this.confirmedIds.shift());
            } catch (error) {
                this.stop();
                this.warn(`[cc-workspace] recycle cleanup failed: ${error}`);
                if (this.onFailure) this.onFailure(error);
                return false;
            }
            if (this.stopped || !this.isReady()) return false;
        }
        ids = this.getDesktopIds();
        if (!ids.length || ids.some(id => typeof id !== "string" || !id)) return false;
        key = JSON.stringify(ids);
        if (ids.length === 1 || this.failedTopology === key) return false;
        const protectedIds = this.getProtectedIds();
        if (!protectedIds.length || protectedIds.some(id => !id)) return false;
        const owners = this.occupancy.recyclingOwners(this.getWindows());
        if (!owners) return false;
        // Current desktops stay even when empty. Keep the last desktop so W8
        // creation and recycling cannot alternate deleting/creating the tail.
        const id = ids.slice(0, -1).find(value => !protectedIds.includes(value) && !owners.has(value));
        if (!id) return false;
        if (!compositorIdle) return this.awaitTransitionIdle();
        if (typeof this.removeDesktop !== "function") {
            this.fail(key, "removeDesktop API missing");
            return false;
        }
        this.pendingId = id;
        this.pendingError = null;
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.reconcile();
        }, 1000);
        try {
            // The injected adapter resolves a live Desktop only at this call.
            this.removeDesktop(id);
            if (!this.stopped) this.ensureVerticalLayout(this.getDesktopIds().length);
        } catch (error) {
            // Native code can remove then raise. Confirm actual topology before
            // deciding whether cleanup or a once-per-topology failure is due.
            if (!this.stopped) this.pendingError = String(error);
            return false;
        }
        return true;
    }

    stop() {
        this.stopped = true;
        this.onDesktopChanged();
        if (this.timer) this.clearTimer(this.timer);
        this.timer = null;
        this.pendingId = null;
        this.pendingError = null;
        this.confirmedIds = [];
    }
}

// Generated from src/kwin/layout/Geometry.js
function copyRect(rect) {
    return rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
}

function formatRect(rect) {
    return rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : "<none>";
}

function rectsEqual(a, b) {
    return Boolean(a && b && a.x === b.x && a.y === b.y &&
        a.width === b.width && a.height === b.height);
}

function rectsNearlyEqual(a, b, tolerance = 1) {
    return Boolean(a && b && Math.abs(a.x - b.x) < tolerance &&
        Math.abs(a.y - b.y) < tolerance &&
        Math.abs(a.width - b.width) < tolerance &&
        Math.abs(a.height - b.height) < tolerance);
}

function sizesNearlyEqual(a, b, tolerance = 1) {
    return Boolean(a && b && Math.abs(a.width - b.width) < tolerance &&
        Math.abs(a.height - b.height) < tolerance);
}

function rectanglesIntersect(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

function quickTileRect(mode, safeRect, requestedInnerGap, maximizeMode = "maximize") {
    if (mode === maximizeMode) return copyRect(safeRect);
    const gap = Math.min(
        Math.max(0, requestedInnerGap),
        Math.max(0, Math.min(safeRect.width, safeRect.height) - 2)
    );
    const leftWidth = Math.floor((safeRect.width - gap) / 2);
    const rightWidth = safeRect.width - gap - leftWidth;
    const topHeight = Math.floor((safeRect.height - gap) / 2);
    const bottomHeight = safeRect.height - gap - topHeight;
    const rightX = safeRect.x + leftWidth + gap;
    const bottomY = safeRect.y + topHeight + gap;
    const rects = {
        left: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: safeRect.height },
        right: { x: rightX, y: safeRect.y, width: rightWidth, height: safeRect.height },
        top: { x: safeRect.x, y: safeRect.y, width: safeRect.width, height: topHeight },
        bottom: { x: safeRect.x, y: bottomY, width: safeRect.width, height: bottomHeight },
        topLeft: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: topHeight },
        topRight: { x: rightX, y: safeRect.y, width: rightWidth, height: topHeight },
        bottomLeft: { x: safeRect.x, y: bottomY, width: leftWidth, height: bottomHeight },
        bottomRight: { x: rightX, y: bottomY, width: rightWidth, height: bottomHeight },
    };
    return rects[mode] ? copyRect(rects[mode]) : null;
}

// Generated from src/kwin/layout/SafeArea.js
function computeSafeRect(screen, gaps) {
    const xInset = Math.min(gaps.left, Math.max(0, screen.width - 1));
    const yInset = Math.min(gaps.top, Math.max(0, screen.height - 1));
    return {
        x: screen.x + xInset,
        y: screen.y + yInset,
        width: Math.max(1, screen.width - gaps.left - gaps.right),
        height: Math.max(1, screen.height - gaps.top - gaps.bottom),
    };
}

// Generated from src/kwin/layout/ColumnLayout.js
function computeColumnWidth(mode, safeWidth, requestedInnerGap) {
    const width = Number.isFinite(safeWidth) && safeWidth > 0
        ? Math.min(safeWidth, Number.MAX_SAFE_INTEGER) : 1;
    if (mode === "full") return Math.max(1, width);
    const gap = Number.isFinite(requestedInnerGap)
        ? Math.min(Math.max(0, requestedInnerGap), Math.max(0, width - 1)) : 0;
    return Math.max(1, Math.floor((width - gap) / 2));
}

// One coordinate origin for every column count; multi-column visibility scrolls
// this inset out of view. Native offsets and logical coordinates stay nonnegative.
function virtualLeadingInset(safeWidth, innerGap, enabled) {
    if (!enabled || !Number.isFinite(safeWidth) || safeWidth <= 0 ||
            safeWidth > Number.MAX_SAFE_INTEGER) return 0;
    return Math.max(0, Math.floor((safeWidth - computeColumnWidth("half", safeWidth, innerGap)) / 2));
}

function deriveColumnLayout(columns, safeWidth, innerGap, options = {}) {
    let logicalX = virtualLeadingInset(safeWidth, innerGap, options.alwaysCenterSingleColumn === true);
    const gap = Number.isFinite(innerGap) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, innerGap)) : 0;
    return columns.map(column => {
        const pixelWidth = computeColumnWidth(column.widthMode, safeWidth, innerGap);
        const derived = { logicalX, pixelWidth };
        logicalX += pixelWidth + gap;
        return derived;
    });
}

function computeStripWidth(columns) {
    if (!columns.length) return 0;
    const last = columns[columns.length - 1];
    return last.logicalX + last.pixelWidth;
}

function boundScrollOffset(offset, stripWidth, viewportWidth) {
    return Math.max(0, Math.min(offset, Math.max(0, stripWidth - viewportWidth)));
}

function scrollOffsetToRevealColumn(offset, column, stripWidth, viewportWidth) {
    const viewportRight = offset + viewportWidth;
    let nextOffset = offset;
    if (column.logicalX < offset) {
        nextOffset = column.logicalX;
    } else if (column.logicalX + column.pixelWidth > viewportRight) {
        nextOffset = column.logicalX + column.pixelWidth - viewportWidth;
    }
    return boundScrollOffset(nextOffset, stripWidth, viewportWidth);
}

// Generated from src/kwin/layout/ContinuousColumnLayout.js
// Event-time JS geometry only. No windows, timers, motion state or retained cache.
function scrollLayoutValidRect(rect) {
    return Boolean(rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
        rect.width >= 1 && rect.height >= 1 &&
        [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, rect.width, rect.height]
            .every(value => Math.abs(value) <= Number.MAX_SAFE_INTEGER));
}

function scrollLayoutIntersection(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y
        ? { x, y, width: right - x, height: bottom - y } : null;
}

// Some visible panels (e.g. Plasma "windows go below") deliberately have no
// strut. Reserve their measured edge extent as well as the official WorkArea.
// Only bars spanning the output qualify; short auto-hide docks/popups do not.
function reserveV2EdgePanels(output, area, panels) {
    let left = area.x, top = area.y, right = area.x + area.width, bottom = area.y + area.height;
    for (const panel of panels || []) {
        if (!scrollLayoutValidRect(panel)) continue;
        const pr = panel.x + panel.width, pb = panel.y + panel.height;
        if (panel.x <= output.x && pr >= output.x + output.width && panel.height < output.height) {
            if (panel.y <= output.y && pb > output.y) top = Math.max(top, pb);
            if (pb >= output.y + output.height && panel.y < output.y + output.height) bottom = Math.min(bottom, panel.y);
        }
        if (panel.y <= output.y && pb >= output.y + output.height && panel.width < output.width) {
            if (panel.x <= output.x && pr > output.x) left = Math.max(left, pr);
            if (pr >= output.x + output.width && panel.x < output.x + output.width) right = Math.min(right, panel.x);
        }
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
}

function effectiveScrollLayoutGap(width, height, requestedGap) {
    const requested = Number.isFinite(requestedGap) ? Math.max(0, requestedGap) : 16;
    // Enough room for at least a one-pixel half column and positive height.
    const limit = Math.max(0, Math.floor(Math.min((width - 2) / 3, (height - 1) / 2)));
    return Math.min(requested, limit);
}

function createScrollLayoutGeometry(options) {
    const output = options.outputRect;
    if (!scrollLayoutValidRect(output)) throw new RangeError("invalid V2 OutputRect");
    const outputRect = { x: output.x, y: output.y, width: output.width, height: output.height };
    const diagnostics = [];
    const physicalScale = Number.isFinite(options.physicalScale) && options.physicalScale > 0 &&
        options.physicalScale <= 16 ? options.physicalScale : 1;
    if (physicalScale !== options.physicalScale) diagnostics.push("scale-fallback");
    let area = options.workingArea;
    if (!scrollLayoutValidRect(area) || !scrollLayoutIntersection(outputRect, area)) {
        // A conservative SafeArea is supplied by OutputTopology when clientArea
        // is unavailable. Never silently substitute the full output over a panel.
        area = options.fallbackRect;
        diagnostics.push("working-area-fallback");
    }
    if (!scrollLayoutValidRect(area)) throw new RangeError("no safe V2 WorkingArea");
    const officialArea = scrollLayoutIntersection(outputRect, area);
    let workingArea = officialArea && reserveV2EdgePanels(outputRect, officialArea, options.panelRects);
    if (officialArea && ["x", "y", "width", "height"].some(key => workingArea[key] !== officialArea[key])) {
        diagnostics.push("visible-edge-panel-reserved");
    }
    if (!scrollLayoutValidRect(workingArea)) throw new RangeError("WorkingArea outside output");
    if (["x", "y", "width", "height"].some(key => area[key] !== officialArea[key])) {
        diagnostics.push("working-area-clipped-to-output");
    }
    // A client can report its integer buffer extent divided by fractional scale.
    // Keep vertical bounds on the shared integer logical/device grid so strict
    // configure ACKs remain exact (e.g. 51px panel at 150% must not yield an odd
    // logical client height). Round inward; never enlarge into a panel.
    const gap = effectiveScrollLayoutGap(workingArea.width, workingArea.height, options.gap);
    const requestedTop = Number.isFinite(options.topGap) && options.topGap >= 0 ? Math.floor(options.topGap) : gap;
    const topGap = Math.min(requestedTop, Math.max(0, workingArea.height - gap - 1));
    let step = 1;
    while (step < 16 && Math.abs(step * physicalScale - Math.round(step * physicalScale)) > 0.000001) step++;
    if (Math.abs(step * physicalScale - Math.round(step * physicalScale)) < 0.000001) {
        const y = outputRect.y + Math.ceil((workingArea.y + topGap - outputRect.y) / step) * step - topGap;
        const bottom = outputRect.y + Math.floor((workingArea.y + workingArea.height - gap - outputRect.y) / step) * step + gap;
        if (bottom - y > topGap + gap && (y !== workingArea.y || bottom - y !== workingArea.height)) {
            workingArea = { x: workingArea.x, y, width: workingArea.width, height: bottom - y };
            diagnostics.push("working-area-client-grid");
        }
    }

    if (gap !== options.gap) diagnostics.push("gap-clamped");

    return { outputRect, workingArea, gap, topGap, physicalScale, diagnostics };
}

function computeV2ColumnWidth(mode, workWidth, gap) {
    if (!Number.isFinite(workWidth) || workWidth < 1 || workWidth > Number.MAX_SAFE_INTEGER ||
            !Number.isFinite(gap) || gap < 0) throw new RangeError("invalid V2 width inputs");
    const proportion = mode === "full" ? 1 : mode === "twoThirds" ? 2 / 3 : 1 / 2;
    return Math.max(1, Math.floor((workWidth - gap) * proportion - gap));
}

function clampV2Camera(camera, maxCamera) {
    const upper = Number.isFinite(maxCamera) ? Math.max(0, maxCamera) : 0;
    return Math.max(0, Math.min(Number.isFinite(camera) ? camera : 0, upper));
}

function centeredCamera(column, workWidth, maxCamera) {
    return clampV2Camera(column.logicalX - (workWidth - column.pixelWidth) / 2, maxCamera);
}

function fittedCamera(current, column, workWidth, gap, maxCamera) {
    let target = clampV2Camera(current, maxCamera);
    const left = column.logicalX - gap;
    const right = column.logicalX + column.pixelWidth + gap;
    // An oversize client gets a stable left-aligned fallback; normal presets
    // always fit after gap clamping. Neither case creates a negative wire offset.
    if (right - left > workWidth || left < target) target = left;
    else if (right > target + workWidth) target = right - workWidth;
    return clampV2Camera(target, maxCamera);
}

function focusV2Camera(layout, index, currentCamera) {
    const column = layout.columns[index];
    if (!column) return clampV2Camera(currentCamera, layout.maxCamera);
    const width = layout.geometry.workingArea.width;
    return layout.columns.length === 1 || column.widthMode === "twoThirds"
        ? centeredCamera(column, width, layout.maxCamera)
        : fittedCamera(currentCamera, column, width, layout.geometry.gap, layout.maxCamera);
}

function deriveV2Layout(columns, geometry, options = {}) {
    if (!scrollLayoutValidRect(geometry.workingArea) || !scrollLayoutValidRect(geometry.outputRect) ||
            geometry.gap !== effectiveScrollLayoutGap(geometry.workingArea.width,
                geometry.workingArea.height, geometry.gap)) throw new RangeError("invalid V2 layout geometry");
    const { workingArea, gap } = geometry;
    const halfWidth = computeV2ColumnWidth("half", workingArea.width, gap);
    const leadingInset = Math.max(0, Math.floor((workingArea.width - halfWidth) / 2));
    const trailingInset = leadingInset;
    let nextX = leadingInset;
    const derived = columns.map(column => {
        const widthMode = normalizeColumnWidthMode(column.widthMode, true);
        const pixelWidth = computeV2ColumnWidth(widthMode, workingArea.width, gap);
        const logicalX = nextX;
        nextX += pixelWidth + gap;
        if (!Number.isFinite(nextX) || nextX > Number.MAX_SAFE_INTEGER) {
            throw new RangeError("V2 column strip overflow");
        }
        return { widthMode, logicalX, pixelWidth };
    });
    const last = derived[derived.length - 1];
    const stripEnd = last ? last.logicalX + last.pixelWidth + trailingInset : 0;
    if (stripEnd > Number.MAX_SAFE_INTEGER) throw new RangeError("V2 padded strip overflow");
    const layout = { geometry, columns: derived, leadingInset, trailingInset, stripEnd,
        maxCamera: Math.max(0, stripEnd - workingArea.width) };
    layout.cameraX = focusV2Camera(layout, options.focusedIndex, options.cameraX);
    return layout;
}

function v2ColumnLayoutRect(geometry) {
    const { workingArea, gap } = geometry;
    const topGap = geometry.topGap === undefined ? gap : geometry.topGap;
    return { x: workingArea.x, y: workingArea.y + topGap, width: workingArea.width,
        height: Math.max(1, workingArea.height - topGap - gap) };
}

function projectV2Column(column, geometry, cameraX) {
    const { workingArea, gap, outputRect } = geometry;
    const vertical = v2ColumnLayoutRect(geometry);
    const visualRect = { x: workingArea.x + column.logicalX - cameraX,
        y: vertical.y, width: column.pixelWidth, height: vertical.height };
    const visibleRect = scrollLayoutIntersection(visualRect, outputRect);
    const partiallyVisible = Boolean(visibleRect && ["x", "y", "width", "height"]
        .some(key => visibleRect[key] !== visualRect[key]));
    return { visualRect, visibleRect, partiallyVisible };
}

// Round shared edges, not widths independently. Origin is output-local; logical
// column widths/camera are never multiplied by scale in the model itself.
function v2DeviceRect(rect, geometry) {
    const scale = geometry.physicalScale;
    const x = Math.round((rect.x - geometry.outputRect.x) * scale);
    const y = Math.round((rect.y - geometry.outputRect.y) * scale);
    const right = Math.round((rect.x + rect.width - geometry.outputRect.x) * scale);
    const bottom = Math.round((rect.y + rect.height - geometry.outputRect.y) * scale);
    return { x, y, width: right - x, height: bottom - y };
}

// Generated from src/kwin/layout/ViewportPolicy.js
// JS target policy only. Painted facts are observations, never a second clock.
function resolveV2Viewport(layout, options) {
    let camera = options.currentTarget;
    const focused = layout.columns[options.focusedIndex];
    if (options.anchor && focused) {
        const anchor = layout.columns[options.anchor.index];
        if (anchor && Number.isFinite(options.anchor.delta)) camera = anchor.logicalX + options.anchor.delta;
    } else if (options.painted) {
        camera = options.painted.cameraX;
        if (options.structural && focused && options.paintedFocusRect) {
            camera = layout.geometry.workingArea.x + focused.logicalX - options.paintedFocusRect.x;
        }
    }
    return focusV2Camera(layout, options.focusedIndex, clampV2Camera(camera, layout.maxCamera));
}

// Generated from src/kwin/layout/ContinuousViewportController.js
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

// Generated from src/kwin/layout/SingleColumnTransition.js
// Short-lived metadata at membership changes only, never a second window model.
// Rust retains the last painted camera sample when the coordinate origin agrees.
function captureSingleColumnLayout(state, enabled) {
    if (!enabled || state.columns.length > 2 || !state.safeRect) return null;
    return {
        workspaceId: state.activeWorkspaceId, output: state.targetOutput,
        safeRect: Object.assign({}, state.safeRect),
        scrollOffsetX: state.scrollOffsetX,
        pair: state.viewport.mode === "pair" && state.presentation.mode === "normal",
        columns: state.columns.map(column => ({ window: column.window,
            logicalX: column.logicalX, pixelWidth: column.pixelWidth, widthMode: column.widthMode })),
    };
}

function prepareSingleColumnReindexPlan(plan, previous, offset) {
    if (!previous || plan.viewportMotion || !Number.isFinite(previous.scrollOffsetX)) return null;
    const survivors = plan.windows.filter(item => previous.columns.some(old => old.window === item.column.window));
    if (survivors.length !== 1) return null;
    const source = survivors[0], old = previous.columns.find(c => c.window === source.column.window);
    const sourceX = old.logicalX - previous.scrollOffsetX;
    // Hidden/partial sources have no continuous fully visible half-column pose.
    // Keep the existing static fallback for these and safe-area/width changes.
    if (source.placement !== "visible" || sourceX < 0 ||
            sourceX + old.pixelWidth > previous.safeRect.width ||
            old.pixelWidth !== source.column.pixelWidth || old.logicalX === source.column.logicalX) return null;
    const windows = plan.windows.map(item => Object.assign({}, item, {
        transitionRole: item === source ? "continuing" : item.placement === "visible" ? "incoming" : "static",
        oldPlacement: item === source ? "visible" : "parked", newPlacement: item.placement,
    }));
    const entries = windows.filter(item => item.transitionRole !== "static").map(item => ({
        windowId: String(item.column.window.internalId), columnId: item.columnId,
        logicalX: item.column.logicalX, pixelWidth: item.column.pixelWidth,
        oldPlacement: item.oldPlacement, newPlacement: item.newPlacement,
    }));
    return Object.assign({}, plan, { windows,
        commitOrder: plan.commitOrder.map(item => windows.find(w => w.columnId === item.columnId)),
        scrollTransaction: { id: plan.epoch, epoch: plan.epoch, type: "COLUMN_REINDEX",
            sourceWindowId: String(source.column.window.internalId), sourceLogicalX: old.logicalX,
            direction: "reindex", deltaX: offset - previous.scrollOffsetX,
            oldScrollOffsetX: previous.scrollOffsetX, newScrollOffsetX: offset,
            viewport: Object.assign({}, previous.safeRect), entries },
    });
}

function classifySingleColumnTransition(previous, state) {
    if (!previous || !previous.pair || !state.enabled || state.workspaceSwitching ||
            previous.workspaceId !== state.activeWorkspaceId || previous.output !== state.targetOutput ||
            !state.safeRect || state.viewport.mode !== "pair" || state.presentation.mode !== "normal") return null;
    const before = previous.columns, after = state.columns;
    if (!((before.length === 1 && after.length === 2) ||
            (before.length === 2 && after.length === 1))) return null;
    if (before.some(column => column.widthMode !== "half") ||
            after.some(column => column.widthMode !== "half")) return null;
    if (["x", "y", "width", "height"].some(key => previous.safeRect[key] !== state.safeRect[key])) return "rebase";
    const surviving = after.filter(column => before.some(old => old.window === column.window));
    if (surviving.length !== 1) return null;
    const column = surviving[0], old = before.find(candidate => candidate.window === column.window);
    return old.logicalX === column.logicalX && old.pixelWidth === column.pixelWidth ? "scroll" : "reindex";
}

// Generated from src/kwin/layout/ColumnWidthController.js
class ColumnWidthController {
    constructor(options) {
        Object.assign(this, options);
        this.scrollLayoutV2Enabled = options.scrollLayoutV2Enabled === true;
    }

    activeColumn() {
        const state = this.getAppState();
        const window = this.getActiveWindow();
        if (!state.enabled || state.workspaceSwitching || !window || window.fullScreen ||
                window.output !== state.targetOutput) return null;
        return state.columns.find(column => column.window === window) || null;
    }

    apply(column, widthMode, reason) {
        widthMode = normalizeColumnWidthMode(widthMode, this.scrollLayoutV2Enabled);
        if (this.scrollLayoutV2Enabled && this.applyV2Width) {
            return this.applyV2Width(column, widthMode, reason);
        }
        // Capture the real pair before changing strip widths. The existing
        // presentation transaction owns only the paint/parking handoff.
        const transition = this.captureLayout(column);
        this.cancelPending(reason);
        this.clearPresentation();
        const previous = column.widthMode === "full"
            ? column.previousNonFullWidthMode : column.widthMode;
        column.widthMode = widthMode;
        column.previousNonFullWidthMode = normalizePreviousNonFullWidthMode(
            previous, widthMode, this.scrollLayoutV2Enabled);
        this.focusColumn(column);
        this.recomputeLogicalLayout();
        this.ensureColumnVisible(column);
        this.relayout(reason, undefined, transition);
        this.commitState(reason);
        return true;
    }

    cycle() {
        const column = this.activeColumn();
        if (!column) return false;
        const widthMode = this.scrollLayoutV2Enabled
            ? ({ half: "twoThirds", twoThirds: "full", full: "half" })[column.widthMode] || "half"
            : column.widthMode === "full" ? "half" : "full";
        return this.apply(column, widthMode, "cycle-column-width");
    }

    toggleFull() {
        const column = this.activeColumn();
        if (!column) return false;
        const widthMode = column.widthMode === "full"
            ? normalizePreviousNonFullWidthMode(column.previousNonFullWidthMode,
                "full", this.scrollLayoutV2Enabled) : "full";
        return this.apply(column, widthMode, "toggle-column-full");
    }
}

// Generated from src/kwin/layout/Projection.js
function projectColumnRect(column, safeRect, scrollOffsetX) {
    return {
        x: safeRect.x + column.logicalX - scrollOffsetX,
        y: safeRect.y,
        width: column.pixelWidth,
        height: safeRect.height,
    };
}

function isRectFullyVisible(rect, viewport) {
    return Boolean(viewport && rect.x >= viewport.x && rect.y >= viewport.y &&
        rect.x + rect.width <= viewport.x + viewport.width &&
        rect.y + rect.height <= viewport.y + viewport.height);
}

function isRectVisible(rect, viewport) {
    return Boolean(viewport && rect.width > 0 && rect.height > 0 &&
        rect.x < viewport.x + viewport.width && rect.x + rect.width > viewport.x &&
        rect.y < viewport.y + viewport.height && rect.y + rect.height > viewport.y);
}

// Generated from src/kwin/layout/Parking.js
function computeParkingBaseX(columns, virtualLeft, parkingMargin) {
    const maximumColumnWidth = columns.reduce(
        (maximum, column) => Math.max(maximum, column.pixelWidth),
        0
    );
    return virtualLeft - parkingMargin - maximumColumnWidth;
}

function computeParkingRect(column, parkingIndex, options) {
    return {
        x: options.baseX - parkingIndex * (column.pixelWidth + options.innerGap),
        y: options.safeRect.y,
        width: column.pixelWidth,
        height: options.safeRect.height,
    };
}

// Generated from src/kwin/layout/LayoutSnapshot.js
function snapshotEntry(columnId, windowId, role, visualRect, realRect, placement) {
    return {
        columnId,
        windowId,
        role,
        visualRect: copyRect(visualRect),
        realRect: copyRect(realRect),
        placement,
    };
}

function buildWidePairSnapshots(motion, target, neighbor, options) {
    if (!motion || !target) return null;
    const entering = motion.type === "PAIR_TO_WIDE";
    const targetId = options.windowId(target);
    const neighborId = neighbor && options.windowId(neighbor);
    const oldNeighborReal = !neighbor ? null : entering
        ? motion.neighbor.oldVisualRect
        : (neighbor.column.window.frameGeometry || options.neighborParkingRect);
    const newNeighborReal = !neighbor ? null : entering
        ? options.neighborParkingRect
        : motion.neighbor.newVisualRect;
    const from = {
        viewportMode: entering ? "pair" : "wide-focus",
        entries: [
            snapshotEntry(target.columnId, targetId, "target",
                motion.target.oldVisualRect, motion.target.oldVisualRect, "visible"),
        ].concat(neighbor ? [snapshotEntry(neighbor.columnId, neighborId, "neighbor",
            motion.neighbor.oldVisualRect, oldNeighborReal,
            entering ? "visible" : "isolated-hidden")] : []),
    };
    const to = {
        viewportMode: entering ? "wide-focus" : "pair",
        entries: [
            snapshotEntry(target.columnId, targetId, "target",
                motion.target.newVisualRect, motion.target.newVisualRect, "visible"),
        ].concat(neighbor ? [snapshotEntry(neighbor.columnId, neighborId, "neighbor",
            motion.neighbor.newVisualRect, newNeighborReal,
            entering ? "isolated-hidden" : "visible")] : []),
    };
    return { from, to };
}

// Generated from src/kwin/layout/MotionPlanCommitGate.js
class MotionPlanCommitGate {
    constructor(options) {
        this.publish = options.publish;
        this.currentEpoch = options.currentEpoch;
        this.commit = options.commit;
        this.warn = options.warn;
        this.timeoutMs = options.timeoutMs === undefined ? 150 : options.timeoutMs;
        this.setTimer = options.setTimer;
        this.clearTimer = options.clearTimer;
        this.pending = null;
    }

    schedule(plan, envelope, context) {
        this.cancel();
        const pending = { plan, context, activationWindow: null, timer: null };
        this.pending = pending;
        pending.timer = this.setTimer(() => {
            if (this.pending !== pending) return;
            this.clearTimer(pending.timer);
            this.pending = null;
            if (this.currentEpoch() !== plan.epoch) return;
            this.warn(`[MOTION_TX] handoff timeout epoch=${plan.epoch}`);
            this.commit(plan, Object.assign({}, context, {
                motionFallback: true,
            }), pending.activationWindow);
        }, this.timeoutMs);
        this.publish(envelope, accepted => {
            if (this.pending !== pending) return;
            this.clearTimer(pending.timer);
            this.pending = null;
            if (this.currentEpoch() !== plan.epoch) return;
            if (!accepted) {
                this.warn(`[MOTION_TX] plan handoff unavailable epoch=${plan.epoch}`);
            }
            this.commit(plan, accepted ? context : Object.assign({}, context, {
                motionFallback: true,
            }), pending.activationWindow);
        });
        return pending;
    }

    deferActivation(window) {
        if (!this.pending) return false;
        this.pending.activationWindow = window;
        return true;
    }

    cancel() {
        const pending = this.pending;
        this.pending = null;
        if (pending) this.clearTimer(pending.timer);
        return pending;
    }
}

// Generated from src/kwin/layout/ScrollPlanCommitGate.js
// Native ACK means continuing/incoming ownership is installed before geometry changes.
// Each callback is scoped to a layout epoch; a timeout also disarms that epoch.
class ScrollPlanCommitGate {
    constructor(options) {
        Object.assign(this, options);
        this.pending = null; this.activeEpoch = null;
        this.disarming = new Set(); this.idleCallbacks = [];
        this.retainedEpochs = new Set();
    }
    abort(epoch, callback = () => {}) {
        const request = { epoch, timer: null };
        this.disarming.add(request);
        const finish = confirmed => {
            if (!this.disarming.delete(request)) return;
            this.clearTimer(request.timer);
            try { callback(confirmed === true); } finally {
                if (!this.disarming.size) this.idleCallbacks.splice(0).forEach(fn => fn());
            }
        };
        // A disconnected endpoint must not retain historical requests forever.
        // This is the same finite ACK deadline used by visible fallback commits.
        request.timer = this.setTimer(() => finish(false), this.timeoutMs);
        try { this.disarm(epoch, finish); } catch (error) {
            this.warn(`[SCROLL_PLAN] disarm unavailable ${error}`); finish(false);
        }
    }
    whenIdle(callback) {
        if (!this.disarming.size) { callback(); return () => {}; }
        this.idleCallbacks.push(callback);
        return () => {
            const index = this.idleCallbacks.indexOf(callback);
            if (index >= 0) this.idleCallbacks.splice(index, 1);
        };
    }
    commitWhenDisarmed(plan, context, offset) {
        // Reindexing cannot share the old strip projection. Wait for its cancel
        // ACK, with the existing protocol timeout as a visible geometry fallback.
        // This timer gates a commit; it never samples or interpolates motion.
        const pending = { plan, context, envelope: { oldScrollOffsetX: offset },
            activationWindow: null, staticFallback: true, timer: null, cancelIdle: null };
        this.pending = pending;
        const finish = () => {
            if (this.pending !== pending) return;
            this.pending = null;
            this.clearTimer(pending.timer);
            if (pending.cancelIdle) pending.cancelIdle();
            if (this.currentEpoch() === plan.epoch)
                this.commit(plan, context, pending.activationWindow);
        };
        pending.timer = this.setTimer(finish, this.timeoutMs);
        pending.cancelIdle = this.whenIdle(finish);
    }
    releaseForWorkspace() {
        if (this.pending) {
            if (this.pending.cancelGeometry) this.pending.cancelGeometry();
            this.clearTimer(this.pending.timer);
            if (this.pending.cancelIdle) this.pending.cancelIdle();
            this.pending = null;
        }
        this.activeEpoch = null;
        this.retainedEpochs.clear();
        if (this.releaseDeferred) this.releaseDeferred();
    }
    retainForLegacy() {
        // Keep the old viewport until Native has observed the replacement
        // Pair/Wide plan. Retire its epochs only after that publish ACK.
        if (this.releaseDeferred) this.releaseDeferred();
        if (this.pending) {
            if (this.pending.cancelGeometry) this.pending.cancelGeometry();
            this.clearTimer(this.pending.timer);
            if (this.pending.cancelIdle) this.pending.cancelIdle();
            this.retainedEpochs.add(this.pending.plan.epoch);
            this.pending = null;
        }
    }
    cancel() {
        if (this.cancelDeferred) this.cancelDeferred();
        const pending = this.pending;
        this.pending = null;
        if (pending) {
            if (pending.cancelGeometry) pending.cancelGeometry();
            this.clearTimer(pending.timer);
            if (pending.cancelIdle) pending.cancelIdle();
            this.retainedEpochs.add(pending.plan.epoch);
        }
        if (this.activeEpoch !== null) this.retainedEpochs.add(this.activeEpoch);
        this.activeEpoch = null;
        const epochs = [...this.retainedEpochs];
        this.retainedEpochs.clear();
        epochs.forEach(epoch => this.abort(epoch));
    }
    supersede() {
        const pending=this.pending;this.pending=null;
        if (pending) {
            if (pending.cancelGeometry) pending.cancelGeometry();
            this.clearTimer(pending.timer);
            if (pending.cancelIdle) pending.cancelIdle();
        }
    }
    schedule(plan, envelope, context) {
        if (this.pending) {
            if (this.pending.cancelGeometry) this.pending.cancelGeometry();
            this.clearTimer(this.pending.timer);
            if (this.pending.cancelIdle) this.pending.cancelIdle();
            // The newer arm supersedes ownership. Do not cancel an in-flight
            // arm here: its last painted sample is the next Spring origin.
        }
        const columnGeometry = envelope.type === "COLUMN_GEOMETRY";
        const pending = { plan, envelope, context, activationWindow: columnGeometry && context.activationWindow || null, timer: null, phase: "membership" };
        this.pending = pending;
        const commit = () => {
            if (this.pending !== pending) return;
            this.pending = null;
            this.clearTimer(pending.timer);
            if (this.currentEpoch() !== plan.epoch) { this.abort(plan.epoch); return; }
            this.commit(plan, Object.assign({}, context, { nativeScroll: Boolean(pending.nativeAccepted) }), pending.activationWindow);
        };
        const finish = accepted => {
            if (this.pending !== pending || pending.fallback) return;
            if (columnGeometry) accepted = accepted === true;
            this.clearTimer(pending.timer);
            if (this.currentEpoch() !== plan.epoch) {
                if (pending.cancelGeometry) pending.cancelGeometry();
                if (columnGeometry && this.activeEpoch === plan.epoch) this.activeEpoch = null;
                this.pending = null; this.abort(plan.epoch); return;
            }
            if (accepted) {
                pending.nativeAccepted = true; this.activeEpoch = plan.epoch;
                if (!columnGeometry) { commit(); return; }
                const deadline = Number.isInteger(this.geometryTimeoutMs) && this.geometryTimeoutMs > 0 &&
                    this.geometryTimeoutMs <= 4000 ? this.geometryTimeoutMs : 3500;
                // A one-shot lifetime deadline, never an animation/completion clock.
                pending.timer = this.setTimer(() => finish(false), deadline);
                try {
                    const cancel = this.columnGeometry.begin(envelope, mayCommit => {
                        if (this.pending !== pending || this.currentEpoch() !== plan.epoch || !mayCommit())
                            throw new Error("obsolete geometry commit");
                        this.commitColumnGeometry(plan, Object.assign({}, context, { nativeScroll: true, deferActivation: true }), mayCommit);
                    }, ready => {
                        if (this.pending !== pending || pending.fallback) return;
                        if (ready !== true || this.currentEpoch() !== plan.epoch ||
                                (pending.activationWindow && typeof this.activateColumnGeometry !== "function")) {
                            finish(false); return;
                        }
                        this.clearTimer(pending.timer);
                        this.pending = null;
                        try {
                            if (pending.activationWindow && this.activateColumnGeometry)
                                this.activateColumnGeometry(pending.activationWindow, plan, context);
                            if (this.currentEpoch() === plan.epoch && this.completeColumnGeometry)
                                this.completeColumnGeometry(plan, context);
                        } catch (error) {
                            this.warn(`[SCROLL_PLAN] geometry completion failed ${error}`);
                            if (this.activeEpoch === plan.epoch) this.activeEpoch = null;
                            this.abort(plan.epoch);
                        }
                    });
                    if (typeof cancel !== "function") throw new Error("missing geometry cancellation");
                    if (this.pending === pending && !pending.fallback) pending.cancelGeometry = cancel;
                    else if (typeof cancel === "function") cancel();
                } catch (_error) { finish(false); }
                return;
            }
            if (pending.cancelGeometry) pending.cancelGeometry();
            this.activeEpoch = null;
            pending.fallback = true;
            this.warn(`[SCROLL_PLAN] native fallback epoch=${plan.epoch}`);
            if (envelope.type === "PARTIAL_SCROLL" || columnGeometry) {
                // A timeout is not proof that partial paint ownership ended.
                // Keep safe frames unchanged; JS recovery decides the next plan.
                this.abort(plan.epoch, cancelled => {
                    if (this.pending !== pending) return;
                    this.pending = null;
                    const failure = columnGeometry ? this.onColumnGeometryFailure : this.onPartialFailure;
                    if (this.currentEpoch() === plan.epoch && failure)
                        failure(plan, context, { cancelled });
                });
                return;
            }
            // Normally wait for native ownership removal before legacy geometry
            // signals fire. An unavailable endpoint cannot block layout forever.
            pending.timer = this.setTimer(commit, this.timeoutMs);
            this.abort(plan.epoch, commit);
        };
        pending.timer = this.setTimer(() => {
            if (!columnGeometry || pending.phase !== "geometry") finish(false);
        }, this.timeoutMs);
        const prepared = accepted => {
            if (this.pending !== pending || pending.fallback) return;
            if (columnGeometry && pending.phase !== "membership") return;
            if (columnGeometry) { accepted = accepted === true; pending.phase = "publish"; }
            if (!accepted) { finish(false); return; }
            try { this.publish(envelope, published => {
                if (this.pending !== pending || pending.fallback) return;
                if (columnGeometry && pending.phase !== "publish") return;
                if (columnGeometry) { published = published === true; pending.phase = "arm"; }
                if (!published || this.currentEpoch() !== plan.epoch) { finish(false); return; }
                try { this.arm(envelope, armed => {
                    if (columnGeometry && pending.phase !== "arm") return;
                    if (columnGeometry) pending.phase = "geometry";
                    finish(armed);
                }); } catch (error) { finish(false); }
            }); } catch (error) { finish(false); }
        };
        if (columnGeometry && (!this.columnGeometry || typeof this.columnGeometry.begin !== "function" ||
                typeof this.commitColumnGeometry !== "function")) {
            finish(false); return;
        }
        try {
            if (this.prepare) this.prepare(context, prepared);
            else prepared(true);
        } catch (error) { finish(false); }
    }
    baseOffset(offset) {
        if (!this.pending) return offset;
        return this.pending.envelope.type === "COLUMN_REINDEX"
            ? this.pending.envelope.newScrollOffsetX : this.pending.envelope.oldScrollOffsetX;
    }
    deferActivation(window) {
        if (!this.pending) return false;
        this.pending.activationWindow = window;
        return true;
    }
}

// Generated from src/kwin/layout/LayoutEngine.js
function transitionRole(oldPlacement, newPlacement) {
    if (oldPlacement === "visible" && newPlacement === "visible") {
        return "continuing";
    }
    if (oldPlacement === "parked" && newPlacement === "visible") {
        return "incoming";
    }
    if (oldPlacement === "visible" && newPlacement === "parked") {
        return "outgoing";
    }
    return "static";
}

function transitionRank(role) {
    return ({ continuing: 0, incoming: 1, outgoing: 2, static: 3 })[role];
}

function motionWindowId(item) {
    const internalId = item.column.window.internalId;
    return String(internalId === undefined || internalId === null
        ? item.column.window.id || item.columnId
        : internalId);
}

function adjacentPairWindow(windows, target, gap) {
    return windows.find(item => item !== target &&
        item.placement === "visible" &&
        (Math.abs(item.rect.x - target.newProjectedRect.x -
            target.newProjectedRect.width - gap) < 3 ||
         Math.abs(item.rect.x + item.rect.width + gap -
            target.newProjectedRect.x) < 3)) || null;
}

function captureColumnWidthTransition(column, columns, safeRect, gap) {
    const oldRect = copyRect(column.window.frameGeometry);
    const neighbor = columns.find(candidate => {
        if (candidate === column || candidate.window.minimized) return false;
        const rect = candidate.window.frameGeometry;
        return isRectVisible(rect, safeRect) &&
            Math.abs(rect.y - oldRect.y) < 2 &&
            Math.abs(rect.height - oldRect.height) < 2 &&
            (Math.abs(rect.x - oldRect.x - oldRect.width - gap) < 3 ||
             Math.abs(rect.x + rect.width + gap - oldRect.x) < 3);
    }) || null;
    return { column, oldRect, neighbor,
        neighborRect: neighbor ? copyRect(neighbor.window.frameGeometry) : null };
}

function columnWidthMotionSnapshot(transition, windows, safeRect, gap) {
    if (!transition || !isRectFullyVisible(transition.oldRect, safeRect)) return null;
    const target = windows.find(item => item.column === transition.column);
    if (!target || target.placement !== "visible") return null;
    const entering = target.column.widthMode === "full";
    const neighbor = entering
        ? windows.find(item => item.column === transition.neighbor) || null
        : adjacentPairWindow(windows, target, gap);
    const pairRect = entering ? transition.oldRect : target.rect;
    const wideRect = entering ? target.rect : transition.oldRect;
    const pairNeighbor = neighbor && (entering
        ? transition.neighborRect : neighbor.newProjectedRect);
    const side = pairNeighbor
        ? (pairNeighbor.x < pairRect.x ? "right" : "left")
        : (pairRect.x + pairRect.width / 2 < safeRect.x + safeRect.width / 2
            ? "left" : "right");
    const virtualNeighbor = pairNeighbor && Object.assign({}, pairNeighbor, {
        x: side === "right" ? wideRect.x - gap - pairNeighbor.width
            : wideRect.x + wideRect.width + gap,
    });
    return {
        target, neighbor,
        motion: {
            type: entering ? "PAIR_TO_WIDE" : "WIDE_TO_PAIR",
            targetColumnId: target.columnId,
            neighborColumnId: neighbor ? neighbor.columnId : null,
            side, viewport: copyRect(safeRect),
            target: { oldVisualRect: copyRect(transition.oldRect),
                newVisualRect: copyRect(target.rect) },
            neighbor: neighbor ? {
                oldVisualRect: copyRect(entering ? pairNeighbor : virtualNeighbor),
                newVisualRect: copyRect(entering ? virtualNeighbor : pairNeighbor),
            } : null,
        },
    };
}

function viewportMotionSnapshot(type, target, neighbor, wideRect, gap) {
    if (!target || !neighbor || !wideRect) return null;
    const pairTarget = target.newProjectedRect;
    const pairNeighbor = neighbor.newProjectedRect;
    const neighborSide = pairNeighbor.x < pairTarget.x ? "left" : "right";
    const side = neighborSide === "left" ? "right" : "left";
    const virtualNeighbor = copyRect(pairNeighbor);
    virtualNeighbor.x = neighborSide === "left"
        ? wideRect.x - gap - pairNeighbor.width
        : wideRect.x + wideRect.width + gap;
    return {
        type,
        targetColumnId: target.columnId,
        neighborColumnId: neighbor.columnId,
        side,
        target: {
            oldVisualRect: copyRect(type === "PAIR_TO_WIDE"
                ? pairTarget : wideRect),
            newVisualRect: copyRect(type === "PAIR_TO_WIDE"
                ? wideRect : pairTarget),
        },
        neighbor: {
            oldVisualRect: copyRect(type === "PAIR_TO_WIDE"
                ? pairNeighbor : virtualNeighbor),
            newVisualRect: copyRect(type === "PAIR_TO_WIDE"
                ? virtualNeighbor : pairNeighbor),
        },
    };
}

function computeLayoutPlan(options) {
    const {
        reason,
        epoch,
        columns,
        safeRect,
        innerGap,
        parkingBaseX,
        scrollOffsetX,
        scrollOffsets,
        presentedColumn,
        presentedRect,
        retainedColumn,
        wideExitColumn,
        wideRect,
        widthTransition,
    } = options;
    const partialLayout = Boolean(options.clipPartial && !presentedColumn &&
        columns.some(column => column.widthMode === "full"));
    const visibility = partialLayout ? isRectVisible : isRectFullyVisible;
    const offsetChanged = Boolean(!presentedColumn && scrollOffsets &&
        scrollOffsets.oldScrollOffsetX !== scrollOffsets.newScrollOffsetX);
    const oldScrollOffsetX = offsetChanged
        ? scrollOffsets.oldScrollOffsetX
        : scrollOffsetX;
    const newScrollOffsetX = offsetChanged
        ? scrollOffsets.newScrollOffsetX
        : scrollOffsetX;
    const hasPartialTarget = partialLayout && columns.some(column => {
        const rect = projectColumnRect(column, safeRect, newScrollOffsetX);
        return isRectVisible(rect, safeRect) && !isRectFullyVisible(rect, safeRect);
    });
    const hasScrollTransaction = offsetChanged || hasPartialTarget;
    let parkingIndex = 0;

    const windows = columns.map((column, index) => {
        const oldProjectedRect = projectColumnRect(column, safeRect, oldScrollOffsetX);
        const newProjectedRect = projectColumnRect(column, safeRect, newScrollOffsetX);
        const oldPlacement = visibility(oldProjectedRect, safeRect)
            ? "visible"
            : "parked";
        const projectedPlacement = visibility(newProjectedRect, safeRect)
            ? "visible"
            : "parked";
        const isPresented = presentedColumn === column;
        const retainedForWidth = !presentedColumn && retainedColumn === column;
        const newPlacement = retainedForWidth ? "visible" : presentedColumn
            ? (isPresented || (retainedColumn === column &&
                projectedPlacement === "visible") ? "visible" : "parked")
            : projectedPlacement;
        const visibleRect = retainedForWidth ? copyRect(column.window.frameGeometry)
            : isPresented ? copyRect(presentedRect) : newProjectedRect;
        const parkingRect = computeParkingRect(column, newPlacement === "parked" ? parkingIndex++ : index, {
                baseX: parkingBaseX,
                innerGap,
                safeRect,
            });
        const rect = newPlacement === "visible" ? visibleRect : parkingRect;
        const role = hasScrollTransaction
            ? transitionRole(oldPlacement, newPlacement)
            : "static";
        return {
            column,
            columnId: column.id,
            placement: newPlacement,
            partial: partialLayout && newPlacement === "visible" && !isRectFullyVisible(visibleRect, safeRect),
            parkingRect,
            rect,
            projectedRect: newPlacement === "visible" ? visibleRect : newProjectedRect,
            oldProjectedRect: hasScrollTransaction ? oldProjectedRect : null,
            newProjectedRect,
            oldPlacement: hasScrollTransaction ? oldPlacement : null,
            newPlacement: hasScrollTransaction ? newPlacement : null,
            transitionRole: role,
        };
    });

    const deltaX = newScrollOffsetX - oldScrollOffsetX;
    const scrollTransaction = hasScrollTransaction ? Object.assign({
        id: epoch,
        epoch,
        type: "SCROLL",
        direction: deltaX > 0 ? "left" : "right",
        deltaX,
        oldScrollOffsetX,
        newScrollOffsetX,
        viewport: copyRect(safeRect),
        entries: windows.filter(item => item.transitionRole !== "static").map(item => ({
            windowId: motionWindowId(item),
            columnId: item.columnId,
            logicalX: item.column.logicalX,
            pixelWidth: item.column.pixelWidth,
            oldPlacement: item.oldPlacement,
            newPlacement: item.newPlacement,
        })),
        continuing: windows.filter(item => item.transitionRole === "continuing")
            .map(motionWindowId),
        incoming: windows.filter(item => item.transitionRole === "incoming")
            .map(motionWindowId),
        outgoing: windows.filter(item => item.transitionRole === "outgoing")
            .map(motionWindowId),
    }, partialLayout ? { clipPartial: true } : {},
    oldScrollOffsetX === newScrollOffsetX ? { retargetOnly: true } : {}) : null;

    const widthMotion = columnWidthMotionSnapshot(widthTransition, windows, safeRect, innerGap);
    const motionTargetColumn = wideExitColumn ||
        (retainedColumn ? presentedColumn : null);
    const motionTarget = widthMotion ? widthMotion.target : windows.find(item =>
        item.column === motionTargetColumn) || null;
    const motionNeighbor = widthMotion ? widthMotion.neighbor : motionTarget
        ? adjacentPairWindow(windows, motionTarget, innerGap) : null;
    const viewportMotion = widthMotion ? widthMotion.motion : motionTarget && motionNeighbor
        ? viewportMotionSnapshot(wideExitColumn ? "WIDE_TO_PAIR" :
            "PAIR_TO_WIDE", motionTarget, motionNeighbor,
            wideExitColumn
                ? (wideExitColumn.window.frameGeometry || wideRect)
                : presentedRect, innerGap)
        : null;
    const neighborIndex = motionNeighbor ? windows.indexOf(motionNeighbor) : -1;
    const targetIndex = motionTarget ? windows.indexOf(motionTarget) : -1;
    const neighborParkingIndex = neighborIndex -
        Number(targetIndex >= 0 && targetIndex < neighborIndex);
    const layoutSnapshots = viewportMotion ? buildWidePairSnapshots(
        viewportMotion, motionTarget, motionNeighbor, {
            windowId: motionWindowId,
            neighborParkingRect: motionNeighbor && computeParkingRect(motionNeighbor.column,
                neighborParkingIndex, {
                    baseX: parkingBaseX,
                    innerGap,
                    safeRect,
                }),
        }) : null;
    if (viewportMotion) {
        viewportMotion.id = epoch;
        viewportMotion.epoch = epoch;
        viewportMotion.oldViewportMode = layoutSnapshots.from.viewportMode;
        viewportMotion.newViewportMode = layoutSnapshots.to.viewportMode;
        viewportMotion.entries = layoutSnapshots.from.entries.map((entry, index) => ({
            windowId: entry.windowId,
            columnId: entry.columnId,
            role: entry.role,
            oldVisualRect: copyRect(entry.visualRect),
            newVisualRect: copyRect(layoutSnapshots.to.entries[index].visualRect),
            oldOpacity: entry.placement === "isolated-hidden" ? 0 : 1,
            newOpacity: layoutSnapshots.to.entries[index].placement ===
                "isolated-hidden" ? 0 : 1,
        }));
        viewportMotion.parkAfterComplete = motionNeighbor && viewportMotion.type === "PAIR_TO_WIDE"
            ? [motionWindowId(motionNeighbor)] : [];
    }

    return {
        reason,
        epoch,
        scrollTransaction,
        viewportMotion: viewportMotion
            ? Object.assign({ viewport: copyRect(safeRect) }, viewportMotion) : null,
        layoutSnapshots,
        wideExitColumn: wideExitColumn || null,
        windows,
        commitOrder: wideExitColumn
            ? windows.slice().sort((a, b) =>
                Number(b.column === wideExitColumn) -
                Number(a.column === wideExitColumn))
            : hasScrollTransaction
            ? windows.slice().sort((a, b) =>
                transitionRank(a.transitionRole) - transitionRank(b.transitionRole))
            : windows,
    };
}

// Generated from src/kwin/layout/ScrollMotionPlan.js
// Pure geometry/protocol preparation, including return to the last committed
// offset while an earlier target is armed but its geometry is not committed.
function createViewportScrollPlan(transaction, context) {
    if (!transaction || !context.workspaceId || !context.targetOutput) return null;
    return Object.assign(transaction.retargetOnly ? { retargetOnly: true } : {},
        transaction.clipPartial ? { clipPartial: true } : {}, {
        protocol: 2,
        type: "SCROLL",
        epoch: transaction.epoch,
        issuedAt: context.issuedAt,
        workspaceId: context.workspaceId,
        targetOutput: context.targetOutput,
        oldScrollOffsetX: transaction.oldScrollOffsetX,
        newScrollOffsetX: transaction.newScrollOffsetX,
        viewport: Object.assign({}, transaction.viewport),
        entries: transaction.entries.map(entry => Object.assign({}, entry, {
            windowId: context.normalizeUuid(entry.windowId),
        })),
    });
}

function createViewportReindexPlan(transaction, context) {
    const plan = createViewportScrollPlan(transaction, context);
    return plan && Object.assign(plan, { type: "COLUMN_REINDEX",
        sourceWindowId: context.normalizeUuid(transaction.sourceWindowId),
        sourceLogicalX: transaction.sourceLogicalX });
}

function prepareViewportReturnPlan(plan, offset, viewport) {
    if (plan.viewportMotion || plan.scrollTransaction) return plan;
    const windows = plan.windows.map(item => item.placement === "visible"
        ? Object.assign({}, item, { transitionRole: "continuing", oldPlacement: "visible", newPlacement: "visible" })
        : item);
    const entries = windows.filter(item => item.placement === "visible").map(item => ({
        windowId: String(item.column.window.internalId), columnId: item.columnId,
        logicalX: item.column.logicalX, pixelWidth: item.column.pixelWidth,
        oldPlacement: "visible", newPlacement: "visible",
    }));
    return Object.assign({}, plan, { windows,
        commitOrder: plan.commitOrder.map(item => windows.find(window => window.columnId === item.columnId)),
        scrollTransaction: { id: plan.epoch, epoch: plan.epoch, type: "SCROLL", retargetOnly: true,
            direction: "none", deltaX: 0, oldScrollOffsetX: offset, newScrollOffsetX: offset,
            viewport: Object.assign({}, viewport), entries },
    });
}

// Width animation retains a neighbor's real frame while painting it toward a
// virtual edge. Protect those planned real frames with a stationary clip;
// the existing Pair/Wide effect continues to supply every paint transform.
function createWidthViewportClipPlan(plan, context) {
    if (!plan.viewportMotion || !plan.windows.some(item => item.partial)) return null;
    const viewport = plan.viewportMotion.viewport;
    const visible = plan.windows.filter(item => item.placement === "visible");
    const offset = Math.max(0, ...visible.map(item => viewport.x - item.rect.x));
    return createViewportScrollPlan({ epoch: plan.epoch, retargetOnly: true, clipPartial: true,
        oldScrollOffsetX: offset, newScrollOffsetX: offset, viewport,
        entries: visible.map(item => ({ windowId: String(item.column.window.internalId),
            columnId: item.columnId, logicalX: item.rect.x - viewport.x + offset,
            pixelWidth: item.rect.width, oldPlacement: "visible", newPlacement: "visible" })),
    }, context);
}

// Generated from src/kwin/layout/PartialScrollPlan.js
// P3 is camera-only, with unchanged logical positions and client sizes.
// Width, membership and basis changes require the P4 geometry transaction.
function createPartialScrollPlan(intent, options) {
    const sameRect = (a, b) => a && b && ["x", "y", "width", "height"].every(k => a[k] === b[k]);
    const validId = value => typeof value === "string" && value.length > 0 && value.length <= 256 &&
        value.trim() === value && value.toLowerCase() === value && !/[{}]/u.test(value);
    const validText = value => typeof value === "string" && value.length <= 256 && Boolean(value.trim());
    const capability = options && options.capability;
    if (!intent || !options || !capability || capability.protocol !== 3 ||
            capability.type !== "PARTIAL_SCROLL" || capability.enabled !== true ||
            capability.inputPolicy !== "two-click" || intent.kind !== "scroll-layout-v2-intent" ||
            !validText(intent.sessionId) || !validText(intent.workspaceId) || !validText(intent.targetOutput) ||
            !Number.isSafeInteger(intent.epoch) || intent.epoch < 0 ||
            !Number.isSafeInteger(intent.scopeRevision) || intent.scopeRevision <= 0 ||
            !Number.isSafeInteger(options.issuedAt) || options.issuedAt < 0 ||
            !Number.isFinite(intent.maxCamera) || intent.maxCamera < 0 || intent.maxCamera > Number.MAX_SAFE_INTEGER ||
            !Number.isFinite(intent.cameraTargetX) || intent.cameraTargetX < 0 ||
            intent.cameraTargetX > intent.maxCamera || !Array.isArray(intent.entries) || !intent.entries.length) return null;
    const initial = intent.continuity === "initial" && !intent.source;
    if (!initial && (intent.requiredCapability !== "v2-scroll" || intent.continuity !== "observed" || !intent.source)) return null;
    let geometry;
    try { geometry = createScrollLayoutGeometry(intent.geometry); } catch (_error) { return null; }
    if (!sameRect(geometry.outputRect, intent.geometry.outputRect) ||
            !sameRect(geometry.workingArea, intent.geometry.workingArea) || geometry.gap !== intent.geometry.gap || geometry.topGap !== (intent.geometry.topGap ?? intent.geometry.gap)) return null;
    const from = initial ? intent.cameraTargetX : intent.source.cameraX;
    if (!Number.isFinite(from) || from < 0 || from > intent.maxCamera) return null;
    if (!initial && (!intent.source.geometry || !sameRect(intent.source.geometry.outputRect, geometry.outputRect) ||
            !sameRect(intent.source.geometry.workingArea, geometry.workingArea) ||
            intent.source.geometry.gap !== geometry.gap || (intent.source.geometry.topGap ?? intent.source.geometry.gap) !== geometry.topGap || !Array.isArray(intent.source.entries))) return null;
    const source = new Map();
    if (!initial) for (const row of intent.source.entries) {
        if (!row || source.has(row.uuid)) return null;
        source.set(row.uuid, row.visualRect);
    }
    const ids = new Set(), columns = new Set(), intervals = [], entries = [];
    for (const row of intent.entries) {
        if (!row || !validId(row.uuid) || ids.has(row.uuid) || columns.has(row.columnId) ||
                !Number.isSafeInteger(row.columnId) || row.columnId < 0 ||
                !Number.isFinite(row.logicalX) || row.logicalX < 0 ||
                !Number.isFinite(row.pixelWidth) || row.pixelWidth < 1 || row.pixelWidth > geometry.workingArea.width ||
                row.logicalX + row.pixelWidth > Number.MAX_SAFE_INTEGER ||
                intervals.some(r => row.logicalX < r[1] && row.logicalX + row.pixelWidth > r[0])) return null;
        ids.add(row.uuid); columns.add(row.columnId); intervals.push([row.logicalX, row.logicalX + row.pixelWidth]);
        const oldPose = projectV2Column(row, geometry, from);
        const newPose = projectV2Column(row, geometry, intent.cameraTargetX);
        if (!sameRect(newPose.visualRect, row.visualRect)) return null;
        if (!oldPose.visibleRect && !newPose.visibleRect &&
                geometry.workingArea.x + row.logicalX + row.pixelWidth - Math.min(from, intent.cameraTargetX) > geometry.outputRect.x &&
                geometry.workingArea.x + row.logicalX - Math.max(from, intent.cameraTargetX) < geometry.outputRect.x + geometry.outputRect.width) return null;
        if (!initial && oldPose.visibleRect) {
            const observed = source.get(row.uuid);
            if (!observed || !["x", "y", "width", "height"].every(k =>
                    Number.isFinite(observed[k]) && Math.abs(observed[k] - oldPose.visualRect[k]) <= 0.000001)) return null;
        }
        if (oldPose.visibleRect || newPose.visibleRect) entries.push({ windowId: row.uuid,
            columnId: row.columnId, logicalX: row.logicalX, pixelWidth: row.pixelWidth,
            oldPlacement: oldPose.visibleRect ? "visible" : "parked",
            newPlacement: newPose.visibleRect ? "visible" : "parked" });
    }
    if (!entries.length || entries.length > 256 || [...source.keys()].some(id => !ids.has(id))) return null;
    return { protocol: 3, type: "PARTIAL_SCROLL", sessionId: intent.sessionId,
        workspaceId: intent.workspaceId, targetOutput: intent.targetOutput, epoch: intent.epoch,
        issuedAt: options.issuedAt, scopeRevision: intent.scopeRevision, maxCamera: intent.maxCamera,
        oldScrollOffsetX: from, newScrollOffsetX: intent.cameraTargetX,
        retargetOnly: from === intent.cameraTargetX, clipPartial: true,
        viewport: geometry.outputRect,
        layoutRect: v2ColumnLayoutRect(geometry), entries };
}

// JS plans real frames; Native verifies these safe anchors against KWin facts.
// Only new-visible rows are committed here. Outgoing retirement stays ACK gated.
function partialScrollSafeTargets(plan) {
    if (!plan || plan.type !== "PARTIAL_SCROLL") return [];
    const output = plan.viewport, layout = plan.layoutRect;
    return plan.entries.filter(e => e.newPlacement === "visible").map(e => ({ windowId: e.windowId,
        rect: { x: Math.max(output.x, Math.min(output.x + output.width - e.pixelWidth,
            layout.x + e.logicalX - plan.newScrollOffsetX)), y: layout.y,
        width: e.pixelWidth, height: layout.height } }));
}

// Generated from src/kwin/layout/ColumnGeometryPlan.js
function columnGeometryRect(rect) {
    return Boolean(rect && [rect.x, rect.y, rect.width, rect.height,
        rect.x + rect.width, rect.y + rect.height].every(v =>
        Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) && rect.width >= 1 && rect.height >= 1);
}
function columnGeometrySameRect(a, b) {
    return columnGeometryRect(a) && columnGeometryRect(b) &&
        ["x", "y", "width", "height"].every(k => a[k] === b[k]);
}
function columnGeometryCopyRect(r) { return { x: r.x, y: r.y, width: r.width, height: r.height }; }
function columnGeometryInside(a, b) {
    return columnGeometryRect(a) && columnGeometryRect(b) && a.x >= b.x && a.y >= b.y &&
        a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
}
function columnGeometryVisible(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function columnGeometryLayout(geometry) {
    let normalized;
    try { normalized = createScrollLayoutGeometry(geometry); } catch (_error) { return null; }
    if (!columnGeometrySameRect(normalized.outputRect, geometry.outputRect) ||
            !columnGeometrySameRect(normalized.workingArea, geometry.workingArea) ||
            normalized.gap !== geometry.gap || normalized.topGap !== (geometry.topGap ?? geometry.gap) || normalized.physicalScale !== geometry.physicalScale) return null;
    return v2ColumnLayoutRect(normalized);
}

// A proposed P4 wire contract, deliberately distinct from camera-only protocol3.
// Only a future Native capability with per-client paint/configure facts can
// authorize it. P3's shared camera projection is insufficient evidence.
function createColumnGeometryPlan(intent, options) {
    const capability = options && options.capability, source = options && options.observation;
    const integer = v => Number.isSafeInteger(v) && v >= 0;
    const scalar = v => Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
    const text = v => typeof v === "string" && v.length <= 256 && Boolean(v.trim());
    const id = v => text(v) && v.trim() === v && v.toLowerCase() === v && !/[{}]/u.test(v);
    if (!capability || capability.protocol !== 4 || capability.type !== "COLUMN_GEOMETRY" ||
            capability.enabled !== true || capability.inputPolicy !== "two-click" ||
            capability.sourcePolicy !== "painted-client-frames" || !intent ||
            intent.kind !== "scroll-layout-v2-intent" || intent.continuity !== "observed" ||
            !["v2-scroll", "v2-column-geometry"].includes(intent.requiredCapability) ||
            !text(intent.sessionId) || !text(intent.workspaceId) || !text(intent.targetOutput) ||
            !integer(intent.epoch) || !integer(intent.scopeRevision) || intent.scopeRevision === 0 ||
            !integer(options.issuedAt) || !scalar(intent.maxCamera) || !scalar(intent.cameraTargetX) ||
            intent.cameraTargetX > intent.maxCamera || !Array.isArray(intent.entries) ||
            !intent.entries.length || intent.entries.length > 256 || !intent.source ||
            !source || source.protocol !== 4 || source.type !== "COLUMN_GEOMETRY_SOURCE" ||
            !["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => source[k] === intent[k]) ||
            !integer(source.epoch) || source.epoch < 1 || source.epoch >= intent.epoch ||
            !integer(source.sampleSerial) || source.epoch !== intent.source.epoch ||
            source.sampleSerial !== intent.source.sampleSerial || !scalar(source.maxCamera) ||
            !scalar(source.cameraX) || source.cameraX > source.maxCamera || source.cameraX !== intent.source.cameraX ||
            !Array.isArray(source.entries) || source.entries.length !== intent.entries.length ||
            !Array.isArray(intent.source.entries) || intent.source.entries.length > 256) return null;
    const layout = columnGeometryLayout(intent.geometry), oldLayout = columnGeometryLayout(intent.source.geometry);
    if (!layout || !oldLayout || !columnGeometrySameRect(source.layoutRect, oldLayout) ||
            !columnGeometrySameRect(source.viewport, intent.source.geometry.outputRect) ||
            !columnGeometrySameRect(source.viewport, intent.geometry.outputRect)) return null;
    const observed = new Map(), painted = new Map(), seenColumns = new Set(), ids = new Set(), intervals = [];
    for (const row of intent.source.entries) {
        if (!row || !id(row.uuid) || painted.has(row.uuid) || !columnGeometryRect(row.visualRect)) return null;
        painted.set(row.uuid, row.visualRect);
    }
    for (const row of source.entries) {
        if (!row || !id(row.windowId) || observed.has(row.windowId) || !integer(row.columnId) ||
                !columnGeometryRect(row.frameRect) || row.frameRect.width > source.viewport.width ||
                row.frameRect.height > source.viewport.height || row.acknowledged !== true) return null;
        if (row.owned === true) {
            if (!((row.painted === true && row.culled !== true) ||
                    (row.painted === false && row.culled === true && columnGeometryRect(row.visualRect) && !columnGeometryVisible(row.visualRect, source.viewport))) || !columnGeometryInside(row.frameRect, source.viewport) ||
                    !columnGeometryRect(row.visualRect) || (!Number.isFinite(row.logicalX) || Math.abs(row.logicalX) > Number.MAX_SAFE_INTEGER) ||
                    row.frameRect.width > oldLayout.width ||
                    row.logicalX + row.frameRect.width > Number.MAX_SAFE_INTEGER ||
                    Math.abs(row.visualRect.x - (oldLayout.x + row.logicalX - source.cameraX)) > 0.000001 ||
                    row.visualRect.y !== oldLayout.y || row.visualRect.height !== oldLayout.height ||
                    row.visualRect.width !== row.frameRect.width || row.visualRect.height !== row.frameRect.height ||
                    row.visualRect.y !== row.frameRect.y || !columnGeometrySameRect(painted.get(row.windowId), row.visualRect)) return null;
        } else if (row.owned !== false || row.painted !== false || row.hidden !== true ||
                row.visualRect !== null || painted.has(row.windowId)) return null;
        observed.set(row.windowId, row);
    }
    const entries = [];
    for (const row of intent.entries) {
        if (!row || !id(row.uuid) || ids.has(row.uuid) || !integer(row.columnId) || seenColumns.has(row.columnId) ||
                (!Number.isFinite(row.logicalX) || Math.abs(row.logicalX) > Number.MAX_SAFE_INTEGER) || !scalar(row.pixelWidth) || row.pixelWidth < 1 || row.pixelWidth > layout.width ||
                row.logicalX + row.pixelWidth > Number.MAX_SAFE_INTEGER || intervals.some(r =>
                    row.logicalX < r[1] && row.logicalX + row.pixelWidth > r[0])) return null;
        const previous = observed.get(row.uuid);
        if (!previous || previous.columnId !== row.columnId) return null;
        const target = projectV2Column(row, intent.geometry, intent.cameraTargetX);
        if (!columnGeometrySameRect(target.visualRect, row.visualRect)) return null;
        const frame = columnGeometryCopyRect(target.visualRect);
        frame.x = Math.max(source.viewport.x, Math.min(source.viewport.x + source.viewport.width - frame.width, frame.x));
        if (!columnGeometryInside(frame, source.viewport)) return null;
        ids.add(row.uuid); seenColumns.add(row.columnId); intervals.push([row.logicalX, row.logicalX + row.pixelWidth]);
        entries.push({ windowId: row.uuid, columnId: row.columnId,
            sourceKind: previous.culled === true ? "culled" : previous.owned ? "painted" : "parked",
            oldLogicalX: previous.owned ? previous.logicalX : null, newLogicalX: row.logicalX,
            oldPixelWidth: previous.frameRect.width, newPixelWidth: row.pixelWidth,
            oldFrameRect: columnGeometryCopyRect(previous.frameRect),
            oldVisualRect: previous.owned ? columnGeometryCopyRect(previous.visualRect) : null,
            committedTargetRect: frame,
            oldPlacement: previous.owned && columnGeometryVisible(previous.visualRect, source.viewport) ? "visible" : "parked",
            newPlacement: target.visibleRect ? "visible" : "parked" });
    }
    if ([...painted.keys()].some(key => !ids.has(key))) return null;
    return { protocol: 4, type: "COLUMN_GEOMETRY", sessionId: intent.sessionId,
        workspaceId: intent.workspaceId, targetOutput: intent.targetOutput, epoch: intent.epoch,
        issuedAt: options.issuedAt, scopeRevision: intent.scopeRevision,
        sourceEpoch: source.epoch, sourceSampleSerial: source.sampleSerial,
        oldScrollOffsetX: source.cameraX, newScrollOffsetX: intent.cameraTargetX,
        oldMaxCamera: source.maxCamera, maxCamera: intent.maxCamera, clipPartial: true,
        viewport: columnGeometryCopyRect(source.viewport), oldLayoutRect: oldLayout, layoutRect: layout, entries };
}

// Generated from src/kwin/layout/ColumnGeometryClientGate.js
// Event-driven configure/paint barrier, called only AFTER Native Arm ACK.
// No animation clock, interpolation, activation or parking authority here.
class ColumnGeometryClientGate {
    constructor(options) { Object.assign(this, options); }

    begin(envelope, commit, done) {
        const disposers = [], clients = [];
        let live = true, committing = true, painted = false;
        const dispose = () => {
            if (!live) return;
            live = false;
            disposers.splice(0).reverse().forEach(fn => { try { fn(); } catch (_error) { /* continue releasing */ } });
            clients.length = 0;
        };
        const finish = accepted => { if (live) { dispose(); done(accepted === true); } };
        const retain = unsubscribe => {
            if (typeof unsubscribe !== "function") throw new Error("missing geometry subscription disposer");
            if (live) disposers.push(unsubscribe); else unsubscribe();
        };
        const check = () => {
            if (!live || committing) return;
            try {
                if (!this.isCurrent(envelope)) { finish(false); return; }
                for (const client of clients) {
                    if (!this.eligible(client.window, envelope)) { finish(false); return; }
                    if (!columnGeometrySameRect(this.readFrame(client.window), client.target)) { painted = false; return; }
                }
                if (painted) finish(true);
            } catch (_error) { finish(false); }
        };
        try {
            if (!envelope || envelope.type !== "COLUMN_GEOMETRY" || envelope.protocol !== 4 ||
                    !Array.isArray(envelope.entries) || !envelope.entries.length || envelope.entries.length > 256 ||
                    !this.isCurrent(envelope)) throw new Error("invalid geometry request");
            const ids = new Set();
            // Resolve all clients and observe before writing any frame. This
            // catches synchronous ACK/close callbacks without a configure race.
            for (const entry of envelope.entries) {
                const window = this.resolve(entry.windowId);
                if (ids.has(entry.windowId) || !window || !this.eligible(window, envelope) ||
                        !columnGeometrySameRect(entry.committedTargetRect, entry.committedTargetRect) ||
                        !columnGeometrySameRect(this.readFrame(window), entry.oldFrameRect)) throw new Error("client source changed");
                ids.add(entry.windowId);
                clients.push({ window, source: entry.oldFrameRect, target: entry.committedTargetRect });
                retain(this.observeClient(window, () => check(), () => finish(false)));
                if (!live) break;
            }
            if (live) retain(this.observeCompletion(envelope, sample => {
                if (!live || !sample || sample.protocol !== 4 || sample.type !== "COLUMN_GEOMETRY_COMPLETION" ||
                        !["sessionId", "workspaceId", "targetOutput", "scopeRevision", "epoch"].every(k => sample[k] === envelope[k]) ||
                        sample.completed !== true || sample.painted !== true || !Number.isSafeInteger(sample.sampleSerial) ||
                        sample.sampleSerial <= envelope.sourceSampleSerial) return;
                painted = true;
                check();
            }));
            if (live) {
                // Revalidate after subscriptions: a reentrant close or scope
                // change during hookup must not write a newer transaction's frame.
                if (!this.isCurrent(envelope) || clients.some(c => !this.eligible(c.window, envelope) ||
                        !columnGeometrySameRect(this.readFrame(c.window), c.source))) {
                    finish(false);
                } else {
                    // The batch writer must check this before each client
                    // write: a configure callback can synchronously close a
                    // window or start a newer layout in the middle of a batch.
                    commit(() => live && this.isCurrent(envelope));
                    committing = false;
                    check();
                }
            }
        } catch (_error) { finish(false); }
        return dispose;
    }
}

// Generated from src/kwin/layout/ColumnGeometryCoordinator.js
// Event-driven P4 composition. Layout/epochs remain in the existing controller;
// this owner only sequences its targets through the existing ACK/cancel gate.
// No presentation sampling, animation timer, frame polling or second model.
class ColumnGeometryCoordinator {
    constructor(options) {
        Object.assign(this, options);
        this.serial = 0;
        this.intent = null;
        this.geometry = null;
        this.observed = null;
        this.bootstrap = null;
        this.sourceWait = null;
        this.listener = null;
        this.stopped = false;
        this.quarantined = false;
        this.recovering = false;
        const publishState = options.prepare;
        this.preparedEpoch = null;
        this.prepare = (intent, done) => {
            if (this.preparedEpoch === intent.epoch) { done(true); return; }
            publishState(intent, accepted => {
                if (!this.isCurrent(intent)) return;
                if (accepted === true) this.preparedEpoch = intent.epoch;
                done(accepted === true);
            });
        };
        this.capability = null;
        this.partialCapability = null;
        this.clear = handle => { if (handle) this.clearTimer(handle); };
        this.clients = new ColumnGeometryClientGate({
            resolve: id => { const c = this.columnFor(id); return c && c.window; },
            eligible: (w, e) => this.isCurrent(e) && this.eligible(w, e),
            readFrame: w => w.frameGeometry,
            isCurrent: e => this.isCurrent(e),
            observeClient: (w, change, close) => this.watch(w, change, close),
            observeCompletion: (e, callback) => this.observeCompletion(e, callback),
        });
        this.gate = new ScrollPlanCommitGate({
            currentEpoch: () => this.currentEpoch(),
            prepare: (context, done) => this.prepare(context.intent, done),
            publish: (e, done) => this.bridge.publishMotionPlan(e, done),
            arm: (e, done) => this.bridge.armScrollPlan(e, done),
            disarm: (epoch, done) => this.bridge.disarmColumnGeometry(epoch, done),
            columnGeometry: this.clients,
            commitColumnGeometry: (plan, _context, guard) => this.writeGeometry(plan, guard),
            activateColumnGeometry: (w, plan) => { if (this.isCurrent(plan)) this.activate(w, plan); },
            completeColumnGeometry: plan => this.settle(plan),
            onColumnGeometryFailure: (plan, _context, proof) => this.failed(plan, proof),
            setTimer: this.setTimer, clearTimer: this.clear,
            warn: this.warn, timeoutMs: this.ackTimeoutMs || 150,
            geometryTimeoutMs: this.deadlineMs || 3500,
        });
        this.wakeHandler = command => this.completionWake(command);
        this.bridge.handlers["scroll-frame-ready"] = this.wakeHandler;
        this.bridge.generationAgnosticTypes.add("scroll-frame-ready");
    }
    parse(raw) { try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_error) { return null; } }
    isCurrent(plan) {
        return Boolean(!this.stopped && !this.quarantined && this.intent && plan &&
            plan.epoch === this.currentEpoch() && plan.epoch === this.intent.epoch &&
            ["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => plan[k] === this.intent[k]) &&
            this.isScope(this.intent));
    }
    watch(window, change, close) {
        if (this.observeClient) return this.observeClient(window, change, close);
        window.frameGeometryChanged.connect(change); window.closed.connect(close);
        let live = true;
        return () => { if (!live) return; live = false;
            try { window.frameGeometryChanged.disconnect(change); } catch (_error) { /* destroyed */ }
            try { window.closed.disconnect(close); } catch (_error) { /* destroyed */ }
        };
    }
    cancelLease() {
        this.clear(this.flight); this.flight = null;
        if (this.bootstrap) this.bootstrap.dispose();
        this.bootstrap = null;
        if (this.sourceWait) this.clear(this.sourceWait.timer);
        this.sourceWait = null; this.listener = null;
    }
    submit(intent) {
        if (this.stopped || this.quarantined) return false;
        this.serial++; this.cancelLease(); this.gate.supersede(); this.intent = intent;
        if (!this.isCurrent(intent)) return false;
        if (!intent.entries.length) {
            this.prepare(intent, accepted => {
                if (!this.isCurrent(intent)) return;
                if (accepted !== true) {this.failed(intent,{cancelled:false,reason:"empty-membership"});return;}
                this.gate.abort(intent.epoch, cancelled => {
                    if (!this.isCurrent(intent)) return;
                    if (cancelled !== true) {this.failed(intent,{cancelled:false,reason:"empty-disarm"});return;}
                    this.geometry=null;this.observed=null;
                    if(this.onComplete)this.onComplete(intent,{empty:true});
                });
            });
            return true;
        }
        const token = this.serial;
        const guard = () => token === this.serial && this.isCurrent(intent);
        this.flight = this.setTimer(() => { if (guard()) this.cancelThenRecover(intent, "request-deadline"); }, this.deadlineMs || 3500);
        const ready = () => {
            if (!guard()) return;
            if (!this.capability || this.capability.protocol !== 4 || this.capability.type !== "COLUMN_GEOMETRY" ||
                    this.capability.enabled !== true || this.capability.inputPolicy !== "two-click" ||
                    this.capability.sourcePolicy !== "painted-client-frames" || !this.partialCapability ||
                    this.partialCapability.protocol !== 3 || this.partialCapability.enabled !== true) {
                this.failed(intent, { cancelled: false, reason: "missing-capability" }); return;
            }
            if (this.recovering || (this.geometry && !this.sameGeometry(this.geometry, intent.geometry))) {
                this.hydrate(intent, guard); return;
            }
            this.querySource(intent, guard);
        };
        const prepare = () => this.prepare(intent, accepted => {
            if (!guard()) return;
            if (accepted !== true) { this.cancelThenRecover(intent, "membership"); return; }
            ready();
        });
        if (this.capability && this.partialCapability) prepare();
        else this.bridge.columnGeometryCapability(raw => {
            if (!guard()) return; this.capability = this.parse(raw);
            this.bridge.partialScrollCapability(p => { if (guard()) { this.partialCapability = this.parse(p); prepare(); } });
        });
        return true;
    }
    sameGeometry(a, b) {
        return Boolean(a && b && a.gap === b.gap && a.physicalScale === b.physicalScale &&
            ["outputRect", "workingArea"].every(r => columnGeometrySameRect(a[r], b[r])));
    }
    entries(plan) { return plan.entries.map(e => ({ windowId: e.uuid, columnId: e.columnId })); }
    remember(source, geometry) {
        this.observed = Object.assign({}, source, { entries: source.entries.filter(e => e.owned === true)
            .map(e => ({ uuid: e.windowId, visualRect: e.visualRect })) });
        this.geometry = geometry;
    }
    getPainted() { return this.observed; }
    querySource(intent, guard) {
        this.bridge.columnGeometrySource(this.entries(intent), raw => {
            if (!guard()) return;
            const source = this.parse(raw);
            if (source && source.valid === true && ["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => source[k] === intent[k])) {
                const oldGeometry = this.geometry || intent.geometry;
                const rebased = Object.assign({}, intent, { continuity: "observed", source: {
                    epoch: source.epoch, sampleSerial: source.sampleSerial, cameraX: source.cameraX, geometry: oldGeometry,
                    entries: source.entries.filter(e => e.owned === true).map(e => ({ uuid: e.windowId, visualRect: e.visualRect })) } });
                const envelope = createColumnGeometryPlan(rebased, { observation: source, capability: this.capability, issuedAt: this.now() });
                if (envelope) {
                    this.clear(this.flight); this.flight = null;
                    if (this.sourceWait) this.clear(this.sourceWait.timer); this.sourceWait = null;
                    this.remember(source, oldGeometry);
                    const focus = this.columnFor(intent.focusedUuid);
                    this.gate.schedule(Object.assign({}, intent, { envelope }), envelope,
                        { intent, activationWindow: focus && focus.window });
                    return;
                }
            }
            // A configure ACK can precede that client's first actual draw.
            // Native arranges one source-ready wakeup after the next real pass.
            if (this.geometry && this.sameGeometry(this.geometry, intent.geometry)) {
                if (!this.sourceWait) {
                    this.clear(this.flight); this.flight = null;
                    const waiting = { intent, guard, timer: null }; this.sourceWait = waiting;
                    waiting.timer = this.setTimer(() => {
                        if (this.sourceWait !== waiting || !guard()) return;
                        this.sourceWait = null;
                        this.cancelThenRecover(intent, "source-deadline");
                    }, this.deadlineMs || 3500);
                }
            } else this.hydrate(intent, guard);
        });
    }
    observeCompletion(envelope, callback) {
        const listener = { envelope, callback }; this.listener = listener;
        this.readCompletion(listener);
        return () => { if (this.listener === listener) this.listener = null; };
    }
    readCompletion(listener) {
        this.bridge.columnGeometryCompletion(raw => {
            if (this.listener !== listener || !this.isCurrent(listener.envelope)) return;
            const proof = this.parse(raw);
            if (proof && proof.completed === true && proof.painted === true) {
                this.lastCompletion = proof; listener.callback(proof);
            }
        });
    }
    completionWake(command) {
        if (!command || !this.intent || !["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => command[k] === this.intent[k])) return false;
        if (this.sourceWait) { const w = this.sourceWait; this.querySource(w.intent, w.guard); return true; }
        if (this.bootstrap && this.bootstrap.phase === "paint") { this.bootstrap.readSource(); return true; }
        if (this.listener) { this.readCompletion(this.listener); return true; }
        return false;
    }
    writeGeometry(plan, guard) {
        for (const entry of plan.envelope.entries) {
            if (!guard() || !this.isCurrent(plan)) return;
            const column = this.columnFor(entry.windowId);
            if (!column || !this.eligible(column.window, plan)) throw new Error("geometry client left scope");
            if (this.prepareClient) this.prepareClient(column.window);
            this.committer.commitGeometry(column, entry.committedTargetRect, plan.reason, guard);
            // Ownership already covers exact source and target frames, including
            // hidden incoming/transit. No legacy fade/scale or pending park here.
            if (guard()) this.setVisibility(column.window, true);
        }
    }
    settle(plan) {
        if (!this.isCurrent(plan)) return;
        for (const entry of plan.envelope.entries) {
            if (!this.isCurrent(plan)) return;
            const column = this.columnFor(entry.windowId);
            if (column && entry.newPlacement === "parked") this.setVisibility(column.window, false);
        }
        this.geometry = plan.geometry; this.recovering = false;
        this.bridge.columnGeometrySource(this.entries(plan), raw => {
            if (!this.isCurrent(plan)) return;
            const source=this.parse(raw);
            if(source && source.valid===true && source.epoch===plan.epoch) this.remember(source,plan.geometry);
            if (this.onComplete) this.onComplete(plan, this.lastCompletion);
        });
    }
    hydrate(intent, guard) {
        // Unknown/different basis is a static bootstrap, after confirmed disarm.
        // Keep the fully fitting focused client visible throughout preparation.
        this.clear(this.flight); this.flight = null;
        const initial = Object.assign({}, intent, { continuity: "initial", source: null });
        const envelope = createPartialScrollPlan(initial, { capability: this.partialCapability, issuedAt: this.now() });
        if (!envelope) { this.failed(intent, { cancelled: false, reason: "invalid-bootstrap" }); return; }
        envelope.geometryBootstrap = true;
        const targets = partialScrollSafeTargets(envelope), disposers = [];
        const lease = { intent, phase: "cancel", timer: null, live: true, committing: false };
        lease.dispose = () => {
            if (!lease.live) return; lease.live = false; this.clear(lease.timer);
            disposers.splice(0).reverse().forEach(fn => { try { fn(); } catch (_error) { /* release all */ } });
        };
        const fail = reason => {
            if (!lease.live || !guard()) return; lease.dispose(); this.bootstrap = null;
            this.cancelThenRecover(intent, reason);
        };
        this.bootstrap = lease;
        lease.timer = this.setTimer(() => fail("bootstrap-deadline"), this.deadlineMs || 3500);
        lease.readSource = () => this.bridge.columnGeometrySource(this.entries(intent), raw => {
            if (!lease.live || !guard()) return;
            const source = this.parse(raw);
            if (!source || source.valid !== true || source.epoch !== intent.epoch ||
                    !["sessionId", "workspaceId", "targetOutput", "scopeRevision"].every(k => source[k] === intent[k])) return;
            this.remember(source, intent.geometry);
            lease.dispose(); this.bootstrap = null; this.recovering = false; this.gate.activeEpoch = intent.epoch;
            const focus = this.columnFor(intent.focusedUuid);
            if (focus) this.activate(focus.window, intent);
            if (guard() && this.onComplete) this.onComplete(intent, { bootstrap: true, sampleSerial: source.sampleSerial });
        });
        const check = () => {
            if (!lease.live || !guard() || lease.committing || lease.phase !== "configure") return;
            if (!targets.every(t => { const c = this.columnFor(t.windowId); return c && this.eligible(c.window, intent) && columnGeometrySameRect(c.window.frameGeometry, t.rect); })) return;
            lease.phase = "publish";
            this.bridge.publishMotionPlan(envelope, accepted => {
                if (!lease.live || !guard()) return;
                if (accepted !== true) { fail("bootstrap-publish"); return; }
                this.bridge.armScrollPlan(envelope, armed => {
                    if (!lease.live || !guard()) return;
                    if (armed !== true) { fail("bootstrap-arm"); return; }
                    lease.phase = "paint";
                    targets.forEach(t => { const c = this.columnFor(t.windowId); if (c && guard()) this.setVisibility(c.window, true); });
                    lease.readSource();
                });
            });
        };
        this.bridge.scrollMotionStatus(raw => {
            if (!lease.live || !guard()) return;
            const status = this.parse(raw);
            if (!status || status.sessionId !== intent.sessionId || !Number.isSafeInteger(status.epoch) || status.epoch >= intent.epoch) { fail("bootstrap-scope"); return; }
            this.bridge.disarmColumnGeometry(Math.max(0, status.epoch), confirmed => {
                if (!lease.live || !guard()) return;
                if (confirmed !== true) { fail("bootstrap-disarm"); return; }
                this.prepare(intent, accepted => {
                    if (!lease.live || !guard()) return;
                    if (accepted !== true) { fail("bootstrap-membership"); return; }
                    lease.phase = "configure"; lease.committing = true;
                    try {
                        targets.forEach(t => { const c = this.columnFor(t.windowId); if (!c || !this.eligible(c.window, intent)) throw new Error("bootstrap client missing");
                            disposers.push(this.watch(c.window, check, () => fail("bootstrap-close"))); });
                        for (const entry of intent.entries) {
                            if (!guard() || !lease.live) return;
                            const c = this.columnFor(entry.uuid); if (!c) continue;
                            if (entry.uuid !== intent.focusedUuid) this.setVisibility(c.window, false);
                        }
                        targets.forEach(t => {
                            if (!guard() || !lease.live) return;
                            const c = this.columnFor(t.windowId);
                            if (this.prepareClient) this.prepareClient(c.window);
                            this.committer.commitGeometry(c, t.rect, intent.reason, () => guard() && lease.live);
                            if (t.windowId === intent.focusedUuid && columnGeometrySameRect(c.window.frameGeometry, t.rect)) this.setVisibility(c.window, true);
                        });
                        lease.committing = false; check();
                    } catch (_error) { fail("bootstrap-write"); }
                });
            });
        });
    }
    cancelThenRecover(intent, reason) {
        this.gate.abort(intent.epoch, cancelled => { if (this.isCurrent(intent)) this.failed(intent, { cancelled, reason }); });
    }
    failed(intent, proof) {
        if (!this.isCurrent(intent)) return;
        this.cancelLease(); this.gate.supersede();
        if (proof.cancelled === true && !this.recovering && this.reissue) {
            this.recovering = true;
            if (this.reissue(intent) !== false) return;
        }
        // Global restoration is JS authority. It may only write after a proven
        // disarm; an unknown ownership result quarantines further geometry.
        this.quarantined = true;
        this.recover(intent, proof);
    }
    releaseForWorkspace() {
        this.serial++; this.cancelLease(); this.gate.releaseForWorkspace();
        this.geometry = null; this.observed = null; this.intent = null;
    }
    suspend(done = () => {}) {
        // Retire callbacks before waiting; no static host write until Native has
        // confirmed both motion and retained handoff ownership are gone.
        const epoch = this.intent && this.intent.epoch;
        this.serial++; this.cancelLease(); this.gate.supersede();
        this.intent = null; this.geometry = null; this.observed = null;
        this.lastCompletion = null; this.preparedEpoch = null;
        if (epoch === null || epoch === undefined) { done(true); return; }
        this.gate.activeEpoch = null;
        this.gate.abort(epoch, confirmed => done(confirmed === true));
    }
    stop(done = () => {}) {
        const epoch = this.intent && this.intent.epoch;
        this.serial++; this.cancelLease(); this.gate.supersede(); this.stopped = true;
        if (this.bridge.handlers["scroll-frame-ready"] === this.wakeHandler) {
            delete this.bridge.handlers["scroll-frame-ready"];
            this.bridge.generationAgnosticTypes.delete("scroll-frame-ready");
        }
        this.intent = null; this.geometry = null; this.observed = null;
        this.lastCompletion = null; this.preparedEpoch = null;
        if (epoch === null || epoch === undefined) { done(true); return; }
        this.gate.activeEpoch=null;
        this.gate.abort(epoch, confirmed => done(confirmed === true));
    }
}

// Generated from src/kwin/layout/GeometryCommitter.js
class GeometryCommitter {
    constructor(dependencies) {
        this.stateFor = dependencies.stateFor;
        this.sameRect = dependencies.sameRect;
        this.sameRectNear = dependencies.sameRectNear || dependencies.sameRect;
        this.rectCopy = dependencies.rectCopy;
        this.rectText = dependencies.rectText;
        this.isTileMode = dependencies.isTileMode;
        this.isRectInsideAnyOutput = dependencies.isRectInsideAnyOutput;
        this.debug = dependencies.debug;
        this.warn = dependencies.warn;
        this.setWindowVisibility = dependencies.setWindowVisibility;
        this.isWindowHidden = dependencies.isWindowHidden;
        this.rememberVisibleGeometry = dependencies.rememberVisibleGeometry;
    }

    commitGeometry(column, target, reason, isCurrent = null) {
        if (isCurrent && !isCurrent()) return;
        const window = column.window;
        const windowState = this.stateFor(window);
        if (windowState.floating || window.fullScreen ||
                this.isTileMode(windowState.layoutMode)) {
            return;
        }
        // A Wayland client may still report the old frame while a different
        // configure is pending. Returning to that frame must supersede the
        // outstanding request, even though the current geometry already fits.
        const requested = windowState.scrollLastRequestedGeometry;
        if (this.sameRect(window.frameGeometry, target) &&
                (!requested || this.sameRect(requested, target))) return;
        windowState.internalChange = true;
        try {
            window.frameGeometry = target;
            windowState.scrollLastRequestedGeometry = this.rectCopy(target);
        } finally {
            windowState.internalChange = false;
        }
        this.debug(`[cc-scroll] LAYOUT reason=${reason} column=${column.id}` +
            ` physicalX=${target.x} width=${target.width}` +
            ` actual=${this.rectText(window.frameGeometry)}`);
    }

    commit(plan, options = {}) {
        const transaction = plan.scrollTransaction;
        const wideExitTarget = plan.wideExitColumn
            ? plan.windows.find(item => item.column === plan.wideExitColumn)
            : null;
        const heldIncoming = [];
        const pendingPark = [];
        if (plan.viewportMotion) {
            const motion = plan.viewportMotion;
            this.debug(`[MOTION_TX] BEGIN epoch=${plan.epoch}` +
                ` type=${motion.type} target=${motion.targetColumnId}` +
                ` neighbor=${motion.neighborColumnId} side=${motion.side}` +
                (motion.neighbor
                    ? ` neighborVisualStart=${this.rectText(motion.neighbor.oldVisualRect)}` +
                        ` neighborVisualEnd=${this.rectText(motion.neighbor.newVisualRect)}`
                    : ""));
        }
        if (transaction) {
            this.debug(`[MOTION_TX] BEGIN id=${transaction.id}` +
                ` epoch=${transaction.epoch} type=${transaction.type}` +
                ` direction=${transaction.direction} delta=${transaction.deltaX}` +
                ` viewport=${this.rectText(transaction.viewport)}`);
        }
        plan.commitOrder.forEach(original => {
            // A partial physical surface requires Native paint AND input clipping.
            const item = original.partial && !options.nativeScroll
                ? Object.assign({}, original, { placement: "parked", rect: original.parkingRect }) : original;
            const column = item.column;
            if (options.nativeScroll && item.placement === "parked" &&
                    (item.transitionRole === "outgoing" || this.stateFor(column.window).scrollPendingParkEpoch != null)) {
                this.rememberVisibleGeometry(column.window, this.rectCopy(column.window.frameGeometry));
                pendingPark.push(item);
                return;
            }
            if (item.placement === "visible") this.stateFor(column.window).scrollPendingParkEpoch = null;
            if (wideExitTarget && item.placement === "visible" &&
                    column !== plan.wideExitColumn &&
                    !this.sameRectNear(
                        plan.wideExitColumn.window.frameGeometry,
                        wideExitTarget.rect)) {
                heldIncoming.push(column);
                this.debug(`[MOTION_TX] HOLD_WIDE_EXIT_NEIGHBOR` +
                    ` column=${column.id} target=${plan.wideExitColumn.id}`);
                return;
            }
            if (transaction && item.transitionRole !== "static") {
                this.debug(`[MOTION_TX] ROLE id=${transaction.id}` +
                    ` column=${column.id} role=${item.transitionRole}`);
            }
            if (item.placement === "parked" &&
                    this.isRectInsideAnyOutput(item.rect)) {
                this.warn(`[cc-scroll] invalid parking rect column=${column.id}` +
                    ` rect=${this.rectText(item.rect)}`);
            }
            if (item.placement === "parked" &&
                    !this.isWindowHidden(column.window) &&
                    this.isRectInsideAnyOutput(column.window.frameGeometry)) {
                this.rememberVisibleGeometry(
                    column.window,
                    this.rectCopy(column.window.frameGeometry)
                );
            }
            if (item.placement === "visible" &&
                    this.isWindowHidden(column.window)) {
                if (options.nativeScroll && item.transitionRole === "incoming") {
                    // Native ownership is armed before this batch. Unhide while
                    // still parked, then commit the real target; its first paint
                    // uses strip projection and native clipping, never a fade.
                    this.setWindowVisibility(column.window, true);
                    this.commitGeometry(column, item.rect, plan.reason);
                } else {
                    this.commitGeometry(column, item.rect, plan.reason);
                    this.setWindowVisibility(column.window, true);
                }
            } else {
                if (item.placement === "visible") {
                    this.setWindowVisibility(column.window, true);
                }
                this.commitGeometry(column, item.rect, plan.reason);
            }
            if (item.placement === "parked") {
                this.setWindowVisibility(column.window, false);
            }
            else {
                this.rememberVisibleGeometry(column.window, this.rectCopy(item.rect));
            }

            const outputName = column.window.output
                ? column.window.output.name
                : "<none>";
            if (item.placement === "visible") {
                this.debug(`[cc-scroll] PROJECT column=${column.id}` +
                    ` logicalX=${column.logicalX}` +
                    ` oldProjectedX=${item.oldProjectedRect
                        ? item.oldProjectedRect.x : "<none>"}` +
                    ` projectedX=${item.newProjectedRect.x}` +
                    ` kind=visible output=${outputName}`);
            } else {
                this.debug(`[cc-scroll] PARK column=${column.id}` +
                    ` logicalX=${column.logicalX}` +
                    ` oldProjectedX=${item.oldProjectedRect
                        ? item.oldProjectedRect.x : "<none>"}` +
                    ` projectedX=${item.newProjectedRect.x}` +
                    ` parkingX=${item.rect.x} output=${outputName}`);
            }
        });
        if (transaction) {
            this.debug(`[MOTION_TX] COMPLETE id=${transaction.id}`);
        }
        return { heldIncoming, pendingPark };
    }
}

// Generated from src/kwin/layout/DeferredScrollParking.js
// Completion is polled from the native owner, never inferred from animation time.
// Timers and replies belong to one session/workspace/output/epoch. A watchdog
// disarms before parking if the owner or endpoint disappears.
class DeferredScrollParking {
    constructor(options) { Object.assign(this, options); this.pending = null; }
    sameContext(context) {
        const current = this.context();
        return ["sessionId", "workspaceId", "targetOutput"].every(key => current[key] === context[key]);
    }
    pause() {
        const pending = this.pending;
        if (!pending) return;
        for (const key of ["timer", "watchdog", "rescue"]) {
            if (pending[key]) this.clearTimer(pending[key]);
            pending[key] = null;
        }
        pending.paused = true;
    }
    release() {
        const pending = this.pending;
        this.pause(); this.pending = null;
        if (pending) pending.items.forEach(item => {
            const state = this.getState ? this.getState(item.column.window) : this.stateFor(item.column.window);
            if (state && state.scrollPendingParkEpoch === pending.epoch) state.scrollPendingParkEpoch = null;
        });
    }
    start(epoch, items, partialItems = []) {
        // GeometryCommitter already transferred retained outgoing items and
        // released any incoming owner. Do not park the previous visual batch.
        this.pause();
        this.pending = null;
        const pending = { epoch, items, partialItems, context: this.context(), timer: null, watchdog: null, rescue: null };
        this.pending = pending;
        items.forEach(item => { this.stateFor(item.column.window).scrollPendingParkEpoch = epoch; });
        const poll = () => {
            if (this.pending !== pending || pending.paused) return;
            if (!this.sameContext(pending.context)) { this.cancel(); return; }
            try {
                this.status(json => {
                    if (this.pending !== pending || pending.paused) return;
                    let status;
                    try { status = JSON.parse(String(json)); } catch (_) { status = null; }
                    if (status && this.sameContext(pending.context) &&
                            ["sessionId", "workspaceId", "targetOutput"].every(key => status[key] === pending.context[key]) &&
                            status.epoch === epoch && status.completed === true && status.active === true) {
                        if (status.clipPartial === true && partialItems.length) {
                            // Settled clips retain their Native owner without a timer or repaint loop.
                            this.pause();
                            this.finalizeItems(pending, pending.items);
                            pending.items = [];
                        } else this.cancel();
                    } else {
                        pending.timer = this.setTimer(poll, 32);
                    }
                });
            } catch (_) { pending.timer = this.setTimer(poll, 32); }
        };
        pending.timer = this.setTimer(poll, 32);
        pending.watchdog = this.setTimer(() => {
            if (this.pending !== pending || pending.paused) return;
            this.warn(`[SCROLL_PLAN] completion timeout epoch=${epoch}`);
            // Cancel ACK clears projection before a fallback parks real windows.
            pending.rescue = this.setTimer(() => { if (this.pending === pending && !pending.paused) this.cancel(); }, 150);
            try { this.disarm(epoch, () => { if (this.pending === pending && !pending.paused) this.cancel(); }); }
            catch (_) { /* The bounded rescue handles an unavailable endpoint. */ }
        }, 3500);
    }
    cancel(disarm = true) {
        const pending = this.pending;
        if (!pending) return;
        this.pending = null;
        if (pending.timer) this.clearTimer(pending.timer);
        if (pending.watchdog) this.clearTimer(pending.watchdog);
        if (pending.rescue) this.clearTimer(pending.rescue);
        this.finalizeItems(pending, pending.items);
        if (this.sameContext(pending.context)) pending.partialItems.forEach(item => {
            const state = this.getState ? this.getState(item.column.window) : this.stateFor(item.column.window);
            if (state && this.isCurrent(item.column) && state.managedByScrollLayout && !state.floating && !item.column.window.fullScreen)
                this.finalize(Object.assign({}, item, { rect: item.parkingRect }));
        });
        if (disarm) {
            try { this.disarm(pending.epoch, () => {}); } catch (_) { /* Layout can continue. */ }
        }
    }
    finalizeItems(pending, items) {
        items.forEach(item => {
            const state = this.getState ? this.getState(item.column.window) : this.stateFor(item.column.window);
            if (!state) return;
            if (state.scrollPendingParkEpoch !== pending.epoch) return;
            state.scrollPendingParkEpoch = null;
            if (this.sameContext(pending.context) && this.isCurrent(item.column) &&
                    state.managedByScrollLayout && !state.floating && !item.column.window.fullScreen) {
                this.finalize(item);
            }
        });
    }
}

// Generated from src/kwin/runtime/RuntimeConfig.js
function loadRuntimeConfig(readValue) {
    const number = (key, fallback) =>
        Math.max(0, Number(readValue(key, fallback)) || 0);
    const requestedScrollGap = Number(readValue("ScrollLayoutGap", 16));
    const requestedTopGap = Number(readValue("ScrollLayoutTopGap", -1));
    return {
        targetOutputName: String(readValue("TargetOutputName", "")).trim(),
        dockIntegration: Boolean(readValue("EnableDockIntegration", false)),
        alwaysCenterSingleColumn: Boolean(readValue("AlwaysCenterSingleColumn", false)),
        scrollLayoutV2Enabled: Boolean(readValue("ScrollLayoutV2Enabled", false)),
        scrollLayoutTopGap: Number.isFinite(requestedTopGap)
            ? Math.min(1000, Math.max(-1, Math.floor(requestedTopGap))) : -1,
        scrollLayoutGap: Number.isFinite(requestedScrollGap)
            ? Math.min(1000, Math.max(0, Math.floor(requestedScrollGap))) : 16,
        dynamicTrailingWorkspace: Boolean(readValue("DynamicTrailingWorkspace", false)),
        autoRecycleWorkspaces: Boolean(readValue("AutoRecycleWorkspaces", false)),
        primary: {
            top: number("GapTop", 50),
            bottom: number("GapBottom", 8),
            left: number("GapLeft", 24),
            right: number("GapRight", 24),
            inner: number("InnerGap", 8),
        },
        manageSecondaryOutput: Boolean(
            readValue("ManageSecondaryOutput", true)
        ),
        secondaryOutputName: String(
            readValue("SecondaryOutputName", "HDMI-A-1")
        ).trim(),
        secondary: {
            top: number("SecondaryGapTop", 24),
            bottom: number("SecondaryGapBottom", 24),
            left: number("SecondaryGapLeft", 24),
            right: number("SecondaryGapRight", 24),
            inner: number("SecondaryInnerGap", 8),
        },
        debugLogging: Boolean(readValue("DebugLogging", false)),
    };
}

// Generated from src/kwin/runtime/ContinuousLayoutRuntime.js
// Host glue only: the existing store/transaction, P2 policy, P4 ACK coordinator
// and global Recovery remain the respective authorities. No second layout cache.
class ContinuousLayoutRuntime {
    constructor(options) {
        Object.assign(this, options);
        this.blocked = false;
        this.inExclusive = false;
        this.stopped = false;
        this.actions = new Map();
        this.anchor = null;
        this.controller = new ContinuousViewportController({
            state: this.state, columnStore: this.columnStore, transaction: this.transaction,
            enabled: true, sessionId: this.bridge.sessionId(), dockEnabled: options.dockEnabled,
            getPrimaryOutput: this.getPrimaryOutput, getCurrentWorkspaceId: this.getCurrentWorkspaceId,
            getUuid: this.getUuid, canJoin: (window, scope) => this.canJoin(window, scope),
            getPainted: () => this.coordinator.getPainted(),
            onTarget: intent => {
                if (!this.blocked && !this.stopped) this.coordinator.submit(intent);
            },
        });
        this.coordinator = new ColumnGeometryCoordinator({
            bridge: this.bridge, currentEpoch: () => this.transaction.currentEpoch(),
            isScope: intent => this.controller.ready() && !this.blocked && !this.stopped &&
                !this.presentationSuspended() && intent.scopeRevision === this.controller.scopeRevision &&
                intent.workspaceId === this.state.activeWorkspaceId &&
                intent.targetOutput === this.state.targetOutput.name,
            columnFor: uuid => this.state.columns.find(column => this.getUuid(column.window) === uuid),
            eligible: (window, intent) => !window.fullScreen && this.canJoin(window, {
                workspaceId: intent.workspaceId, output: this.state.targetOutput }),
            prepare: (intent, done) => this.commitState(intent.reason, done),
            committer: this.committer, setVisibility: this.setVisibility, prepareClient: this.prepareClient,
            activate: (window, intent) => {
                if (!this.blocked && !this.stopped && this.state.enabled && !this.state.workspaceSwitching &&
                        intent.epoch === this.transaction.currentEpoch() &&
                        (this.columnStore.focusedColumn() || {}).window === window) this.activate(window);
            },
            recover: (_intent, proof) => this.fail(proof.reason, proof.cancelled),
            reissue: () => this.controller.reflow("v2-confirmed-recovery"),
            setTimer: this.setTimer, clearTimer: this.clearTimer, now: this.now, warn: this.warn,
            onComplete: () => this.onSettled(),
        });
        this.bridge.handlers["focus-partial-column"] = command => !this.blocked &&
            !this.presentationSuspended() && this.controller.focusPartialRequest(command);
    }

    presentationSuspended() {
        return this.state.presentation.mode === "maximized" || this.state.columns.some(c => c.window.fullScreen);
    }

    ready() { return !this.blocked && !this.stopped && !this.presentationSuspended() && this.controller.ready(); }

    restoreView(anchor, preserve) { this.anchor = preserve ? anchor : null; }

    captureView() {
        const column = this.columnStore.focusedColumn(), geometry = this.getGeometry();
        if (!column || !geometry) return null;
        return { version: 1, uuid: this.getUuid(column.window),
            delta: this.state.scrollOffsetX - column.logicalX,
            basis: { outputRect: geometry.outputRect, workingArea: geometry.workingArea,
                gap: geometry.gap, physicalScale: geometry.physicalScale } };
    }

    sync(reason = "v2-layout") {
        if (this.blocked || this.stopped || !this.state.enabled || this.state.workspaceSwitching ||
                !this.state.activeWorkspaceId || this.presentationSuspended()) return false;
        const geometry = this.getGeometry();
        if (!geometry) { this.fail("missing-working-area", false); return false; }
        const focused = this.columnStore.focusedColumn();
        const anchor = this.anchor; this.anchor = null;
        const basisMatches = anchor && anchor.basis && geometry.gap === anchor.basis.gap &&
            geometry.physicalScale === anchor.basis.physicalScale &&
            ["outputRect", "workingArea"].every(key => ["x", "y", "width", "height"]
                .every(field => geometry[key][field] === anchor.basis[key][field]));
        const mounted = this.controller.mount({ workspaceId: this.state.activeWorkspaceId,
            output: this.state.targetOutput, geometry }, this.state.columns.map(column => ({
            window: column.window, widthMode: column.widthMode,
            previousNonFullWidthMode: column.previousNonFullWidthMode, persistentWide: column.persistentWide,
        })), { focusedUuid: focused ? this.getUuid(focused.window) : null,
            anchor: basisMatches ? anchor : null });
        return mounted || this.controller.reflow(reason);
    }

    exclusive(key, action) {
        if (this.stopped) return false;
        if (this.inExclusive) return action();
        // Coalesce repeated signals from one live window, bounded by membership.
        if (this.actions.size >= 512 && !this.actions.has(key)) { this.fail("departure-overflow", false); return false; }
        this.actions.set(key, action);
        if (this.blocked) return true;
        this.blocked = true;
        this.coordinator.suspend(confirmed => {
            if (this.stopped) return;
            if (!confirmed) { this.actions.clear(); this.fail("departure-disarm", false); return; }
            this.inExclusive = true;
            try {
                const actions = Array.from(this.actions.values()); this.actions.clear();
                actions.forEach(callback => callback());
            } catch (error) { this.fail(`departure:${error}`, true); }
            finally { this.inExclusive = false; this.blocked = false; }
            if (!this.stopped) this.sync(key);
        });
        return true;
    }

    releaseForWorkspace() {
        this.coordinator.releaseForWorkspace();
        this.controller.geometry = null; this.controller.lastTarget = null;
        this.controller.lastSample = null; this.anchor = null;
    }

    stop(done) {
        if (this.stopped) { done(this.stopConfirmed === true); return; }
        this.stopped = true; this.blocked = true; this.actions.clear(); this.anchor = null;
        delete this.bridge.handlers["focus-partial-column"];
        this.coordinator.stop(confirmed => {
            this.stopConfirmed = confirmed;
            this.controller.geometry = null; this.controller.lastTarget = null; this.controller.lastSample = null;
            done(confirmed);
        });
    }
}

// Generated from src/kwin/runtime/RuntimeLogger.js
class RuntimeLogger {
    constructor(options) {
        this.tag = options.tag;
        this.enabled = Boolean(options.enabled);
        this.infoSink = options.infoSink;
        this.warnSink = options.warnSink;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
    }

    resolve(value) {
        return typeof value === "function" ? value() : String(value);
    }

    classify(message, requestedCategory) {
        if (requestedCategory) return requestedCategory;
        if (/^\[cc-adoption\]/.test(message)) return "adoption";
        if (/^\[cc-bridge\]/.test(message)) return "bridge";
        if (/^\[cc-dock\]/.test(message)) return "dock";
        if (/^\[cc-presentation\]/.test(message)) return "presentation";
        if (/^\[cc-stability\].*EMERGENCY_RESTORE/.test(message)) return "recovery";
        if (/^\[cc-stability\]/.test(message)) return "stability";
        if (/^\[cc-scroll\].*(FLOAT|MANAGE|REMEMBER_FLOAT)/.test(message)) {
            return "floating";
        }
        if (/^\[cc-scroll\]/.test(message)) return "layout";
        if (/^(FULLSCREEN|NATIVE-TRANSFER)/.test(message)) return "lifecycle";
        if (/^(INVARIANT|RECOVERY|TIMEOUT|SCHEMA REJECT|QUEUE FULL)/.test(message)) {
            return "stability";
        }
        return "runtime";
    }

    stripLegacyPrefix(message) {
        return message.replace(/^\[cc-[^\]]+\]\s*/u, "");
    }

    format(category, message) {
        return `${this.tag} [${category}] ${this.stripLegacyPrefix(message)}`;
    }

    debug(value, category = "") {
        if (!this.enabled) return false;
        const message = this.resolve(value);
        this.infoSink(this.format(this.classify(message, category), message));
        return true;
    }

    warn(value, category = "") {
        const message = this.resolve(value);
        this.warnSink(this.format(this.classify(message, category), message));
        return true;
    }
}

// Generated from src/kwin/runtime/OutputTopology.js
class OutputTopology {
    constructor(options) {
        this.getScreens = options.getScreens;
        this.getWindows = options.getWindows || (() => []);
        this.config = options.config;
        this.computeSafeRect = options.computeSafeRect;
        this.getWorkingArea = options.getWorkingArea;
        this.warn = options.warn;
        this.warnedMissingPrimary = false;
        this.warnedMissingSecondary = false;
    }

    ordered() {
        return this.getScreens().slice().sort((a, b) =>
            a.geometry.x === b.geometry.x
                ? a.geometry.y - b.geometry.y
                : a.geometry.x - b.geometry.x
        );
    }

    primary() {
        const outputs = this.ordered();
        if (!outputs.length) return null;
        if (this.config.targetOutputName) {
            const configured = outputs.find(output =>
                output.name === this.config.targetOutputName);
            if (configured) {
                this.warnedMissingPrimary = false;
                return configured;
            }
            if (!this.warnedMissingPrimary) {
                this.warn(`configured output ${this.config.targetOutputName}` +
                    " not found; using leftmost output");
                this.warnedMissingPrimary = true;
            }
        }
        return outputs[0];
    }

    secondary() {
        if (!this.config.manageSecondaryOutput) return null;
        const primary = this.primary();
        const candidates = this.ordered().filter(output => output !== primary);
        if (!candidates.length) return null;
        if (this.config.secondaryOutputName) {
            const configured = candidates.find(output =>
                output.name === this.config.secondaryOutputName);
            if (configured) {
                this.warnedMissingSecondary = false;
                return configured;
            }
            if (!this.warnedMissingSecondary) {
                this.warn(`configured secondary output ${this.config.secondaryOutputName}` +
                    " not found; using rightmost non-primary output");
                this.warnedMissingSecondary = true;
            }
        }
        return candidates[candidates.length - 1];
    }

    profile(output) {
        if (!output) return null;
        const primary = this.primary();
        if (output === primary) {
            const gaps = this.config.primary;
            return {
                role: "primary", output,
                top: gaps.top, bottom: gaps.bottom,
                left: gaps.left, right: gaps.right, inner: gaps.inner,
            };
        }
        const secondary = this.secondary();
        if (output === secondary) {
            const gaps = this.config.secondary;
            return {
                role: "secondary", output,
                top: gaps.top, bottom: gaps.bottom,
                left: gaps.left, right: gaps.right, inner: gaps.inner,
            };
        }
        return null;
    }

    managed() {
        const outputs = [this.primary(), this.secondary()].filter(Boolean);
        return outputs.filter((output, index) => outputs.indexOf(output) === index);
    }

    safeRect(output) {
        const profile = this.profile(output);
        return profile ? this.computeSafeRect(output.geometry, profile) : null;
    }

    panelRects(output, desktop) {
        return this.getWindows().filter(window => window.dock && !window.deleted && !window.hidden &&
            !window.minimized && window.opacity !== 0 && (!window.output || window.output === output) &&
            (!desktop || window.onAllDesktops || !window.desktops || !window.desktops.length ||
                Array.from(window.desktops).some(owner => String(owner.id) === String(desktop.id))))
            .map(window => window.frameGeometry);
    }

    // Keep official struts and visible full-edge overlay bars separate from gap.
    v2Geometry(output, desktop) {
        if (!this.config.scrollLayoutV2Enabled || !output || output !== this.primary()) return null;
        let workingArea;
        if (this.getWorkingArea) {
            try { workingArea = this.getWorkingArea(output, desktop); }
            catch (_error) { /* Use the conservative, panel-safe profile below. */ }
        }
        try {
            return createScrollLayoutGeometry({ outputRect: output.geometry, workingArea,
                fallbackRect: this.safeRect(output), panelRects: this.panelRects(output, desktop), gap: this.config.scrollLayoutGap,
                topGap: this.config.scrollLayoutTopGap,
                physicalScale: output.devicePixelRatio || output.scale });
        } catch (_error) {
            return null; // No trustworthy output/area means no V2 layout.
        }
    }
}

// Generated from src/kwin/runtime/StartupLayout.js
class StartupLayout {
    constructor(options) {
        this.normalizeUuid = options.normalizeUuid;
        this.targetOutput = options.targetOutput;
        this.savedOrder = [];
        this.anchor = null;
    }

    load(json) {
        this.savedOrder = [];
        this.anchor = null;
        let snapshot;
        try {
            snapshot = JSON.parse(String(json || ""));
        } catch (_error) {
            return false;
        }
        if (!snapshot || snapshot.protocol !== 1 ||
                snapshot.targetOutput !== this.targetOutput() ||
                !Array.isArray(snapshot.columns)) return false;

        const order = snapshot.columns.map(column =>
            this.normalizeUuid(column && column.uuid));
        if (order.some(uuid => !uuid) || new Set(order).size !== order.length) {
            return false;
        }
        this.savedOrder = order;
        const anchor = snapshot.viewportAnchor;
        if (anchor && typeof anchor === "object") {
            const uuid = this.normalizeUuid(anchor.uuid);
            const delta = Number(anchor.delta);
            if (order.includes(uuid) && Number.isFinite(delta) && delta >= 0) {
                this.anchor = { uuid, delta };
            }
        }
        return true;
    }

    orderWindows(windows) {
        const ranks = new Map(this.savedOrder.map((uuid, index) => [uuid, index]));
        return windows.map((window, index) => ({ window, index }))
            .sort((a, b) => {
                const aRank = ranks.get(this.normalizeUuid(a.window.internalId));
                const bRank = ranks.get(this.normalizeUuid(b.window.internalId));
                if (aRank === undefined && bRank === undefined) return a.index - b.index;
                if (aRank === undefined) return 1;
                if (bRank === undefined) return -1;
                return aRank - bRank;
            })
            .map(entry => entry.window);
    }

    insertionIndex(window, columns) {
        const rank = this.savedOrder.indexOf(this.normalizeUuid(window.internalId));
        if (rank < 0) return -1;
        for (let index = 0; index < columns.length; index += 1) {
            const nextRank = this.savedOrder.indexOf(
                this.normalizeUuid(columns[index].window.internalId));
            if (nextRank >= 0 && nextRank > rank) return index;
        }
        let lastSaved = -1;
        columns.forEach((column, index) => {
            if (this.savedOrder.includes(
                this.normalizeUuid(column.window.internalId))) lastSaved = index;
        });
        return lastSaved + 1;
    }

    restoreOffset(columns, fallbackOffset, bound) {
        if (!this.anchor) return fallbackOffset;
        const column = columns.find(item =>
            this.normalizeUuid(item.window.internalId) === this.anchor.uuid);
        if (!column) return fallbackOffset;
        return bound(column.logicalX + this.anchor.delta);
    }
}

// Generated from src/kwin/runtime/RuntimeLifecycle.js
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

    connect(signal, handler, owner = null) {
        if (!signal || typeof signal.connect !== "function") return;
        signal.connect(handler);
        this.connections.push({ signal, handler, owner });
    }

    disconnectOwner(owner) {
        const retained = [];
        this.connections.forEach(connection => {
            if (connection.owner !== owner) { retained.push(connection); return; }
            try { connection.signal.disconnect(connection.handler); } catch (_error) { /* destroyed QObject */ }
        });
        this.connections = retained;
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

// Generated from src/kwin/runtime/ShortcutCatalog.js
// Persistent action IDs and user bindings stay stable. Canonical IPC actions
// have no default key; the legacy queue action keeps its existing F11 binding.
function createShortcutCatalog(actions) {
    const entry = (group, name, description, defaultSequence, handler) =>
        ({ group, name, description, defaultSequence, handler });
    const workspace = [
        entry("Workspace", "CCScrollWorkspacePrevious", "CC Scroll: Previous Workspace", "Meta+K", actions.workspacePrevious),
        entry("Workspace", "CCScrollWorkspaceNext", "CC Scroll: Next Workspace", "Meta+J", actions.workspaceNext),
        ...Array.from({ length: 9 }, (_, index) => {
            const number = index + 1;
            return entry("Workspace", `CCScrollWorkspace${number}`, `CC Scroll: Workspace ${number}`,
                `Meta+${number}`, () => actions.workspaceFocus(number));
        }),
    ];
    const workspaceMove = [
        entry("Column Move", "CCScrollMoveColumnPreviousWorkspace", "CC Scroll: Move Column to Previous Workspace", "Meta+Shift+K", actions.moveWorkspacePrevious),
        entry("Column Move", "CCScrollMoveColumnNextWorkspace", "CC Scroll: Move Column to Next Workspace", "Meta+Shift+J", actions.moveWorkspaceNext),
        ...Array.from({ length: 9 }, (_, index) => {
            const number = index + 1;
            return entry("Column Move", `CCScrollMoveColumnWorkspace${number}`, `CC Scroll: Move Column to Workspace ${number}`,
                `Meta+Ctrl+${number}`, () => actions.moveWorkspaceNumber(number));
        }),
    ];
    const focus = [
        entry("Column Focus", "CCScrollFocusPreviousColumn", "CC Scroll: Focus Previous Column", "Meta+H", actions.focusPrevious),
        entry("Column Focus", "CCScrollFocusNextColumn", "CC Scroll: Focus Next Column", "Meta+L", actions.focusNext),
    ];
    const width = [
        entry("Column Width", "CCScrollCycleColumnWidth", "CC Scroll: Cycle Column Width", "Meta+R", actions.cycleWidth),
        entry("Column Width", "CCScrollToggleColumnFull", "CC Scroll: Toggle Column Full Width", "Meta+F", actions.toggleFull),
    ];
    const presentation = [
        entry("Presentation", "CCScrollToggleFocusWide", "CC Scroll: Toggle Focus Wide", "Meta+Z", actions.toggleWide),
    ];
    const reorder = [
        entry("Column Move", "CCScrollMoveColumnLeft", "CC Scroll: Move Column Left", "Meta+Shift+H", actions.moveLeft),
        entry("Column Move", "CCScrollMoveColumnRight", "CC Scroll: Move Column Right", "Meta+Shift+L", actions.moveRight),
    ];
    const floating = [
        entry("Floating", "CCScrollToggleFloating", "CC Scroll: Toggle Floating", "Meta+Shift+Return", actions.toggleFloating),
        entry("Floating", "CCScrollToggleFloatingKeypad", "CC Scroll: Toggle Floating Keypad Enter", "Meta+Shift+Enter", actions.toggleFloating),
    ];
    const runtime = [
        entry("Debug", "CCScrollPublishFocusRingState", "CC Scroll: Publish Focus Ring Eligibility", "", actions.publishFocusRingState),
        entry("Debug", "CCScrollPublishRuntimeState", "CC Scroll: Publish Runtime State", "", actions.publishRuntimeState),
        entry("Debug", "CCScrollApplyRuntimeCommand", "CC Scroll: Apply Runtime Command", "", actions.applyRuntimeCommand),
    ];
    const compatibility = [
        entry("Compatibility", "CCScrollPublishDockState", "CC Scroll: Publish Dock State", "", actions.publishRuntimeState),
        entry("Compatibility", "CCScrollApplyDockCommand", "CC Scroll: Apply Dock Command", "Meta+Ctrl+Alt+Shift+F11", actions.applyRuntimeCommand),
    ];
    const recovery = [
        entry("Debug", "CCScrollEmergencyRestore", "CC Scroll: Emergency Restore Parked Windows", "Meta+Ctrl+Alt+Shift+F12", actions.emergencyRestore),
    ];
    return [].concat(workspace, workspaceMove, focus, width, presentation, reorder,
        floating, runtime, compatibility, recovery);
}

// Generated from src/kwin/runtime/ControllerComposition.js
class ControllerComposition {
    constructor(controllers, requiredNames) {
        const missing = requiredNames.filter(name => !controllers[name]);
        if (missing.length) {
            throw new Error(`missing runtime controllers: ${missing.join(",")}`);
        }
        this.controllers = Object.freeze(Object.assign({}, controllers));
    }

    get(name) {
        const controller = this.controllers[name];
        if (!controller) throw new Error(`unknown runtime controller: ${name}`);
        return controller;
    }

    names() {
        return Object.keys(this.controllers);
    }
}

// Generated from src/kwin/runtime/CCNiri.js
class CCNiri {
    constructor(options) {
        this.controllers = options.controllers;
        this.lifecycle = new RuntimeLifecycle(options.lifecycle);
        this.onStarted = options.onStarted || (() => {});
        this.onStopping = options.onStopping || (() => {});
    }

    start() {
        if (!this.lifecycle.start()) return false;
        this.onStarted();
        return true;
    }

    stop() {
        if (!this.lifecycle.started) return false;
        this.onStopping();
        return this.lifecycle.stop();
    }
}

// Generated from src/kwin/policy/WindowPolicy.js
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

// Generated from src/kwin/policy/LayoutEligibility.js
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

// Generated from src/kwin/stability/LayoutTransaction.js
class LayoutTransaction {
    constructor(options) {
        this.audit = options.audit;
        this.debug = options.debug;
        this.depth = 0;
        this.epoch = 0;
        this.activeReason = "";
    }

    begin(reason) {
        if (this.depth === 0) {
            this.epoch += 1;
            this.activeReason = reason;
            this.debug(`[cc-stability] BEGIN epoch=${this.epoch} reason=${reason}`);
        }
        this.depth += 1;
        return this.epoch;
    }

    end(reason, epoch) {
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth !== 0) return;
        this.audit(reason, epoch);
        this.debug(`[cc-stability] END epoch=${epoch} reason=${this.activeReason}`);
        this.activeReason = "";
    }

    run(reason, callback) {
        const epoch = this.begin(reason);
        try {
            return callback(epoch);
        } finally {
            this.end(reason, epoch);
        }
    }

    // Native ACK continues the already published epoch. Geometry/visibility
    // signals need the same re-entry guard as a synchronous relayout.
    resume(reason, epoch, callback) {
        if (epoch !== this.epoch) return false;
        if (this.depth === 0) {
            this.activeReason = reason;
            this.debug(`[cc-stability] COMMIT epoch=${epoch} reason=${reason}`);
        }
        this.depth += 1;
        try {
            return callback();
        } finally {
            this.end(reason, epoch);
        }
    }

    isActive() {
        return this.depth > 0;
    }

    currentEpoch() {
        return this.epoch;
    }
}

// Generated from src/kwin/stability/InvariantChecker.js
class InvariantChecker {
    constructor(options) {
        this.appState = options.appState;
        this.getV2Geometry = options.getV2Geometry;
        this.alwaysCenterSingleColumn = options.alwaysCenterSingleColumn === true;
        this.workspaceMembership = options.workspaceMembership || null;
        this.workspaceSnapshots = options.workspaceSnapshots || null;
        this.windowStates = options.windowStates;
        this.normalizeUuid = options.normalizeUuid;
        this.stripWidth = options.stripWidth;
        this.managedPhases = new Set(options.managedPhases);
        this.normalPresentationMode = options.normalPresentationMode;
        this.debug = options.debug;
        this.warn = options.warn;
        this.lastWarning = "";
    }

    errors() {
        const errors = [];
        const columns = this.appState.columns;
        const windows = new Set();
        const uuids = new Set();
        let expectedLogicalX = virtualLeadingInset(
            this.appState.safeRect ? this.appState.safeRect.width : 0,
            this.appState.innerGap, this.alwaysCenterSingleColumn);
        const v2 = this.getV2Geometry && this.getV2Geometry();
        if (v2) expectedLogicalX = (deriveV2Layout(columns, v2).columns[0] || {}).logicalX || 0;

        columns.forEach((column, index) => {
            const uuid = this.normalizeUuid(column.window.internalId);
            if (windows.has(column.window)) errors.push(`duplicate-window:${index}`);
            windows.add(column.window);
            if (!uuid || uuids.has(uuid)) errors.push(`duplicate-uuid:${uuid || index}`);
            uuids.add(uuid);
            if (this.workspaceMembership &&
                    !this.workspaceMembership.isSingleDesktop(column.window)) {
                errors.push(`sticky-managed:${uuid}`);
            }
            if (this.workspaceMembership && this.appState.activeWorkspaceId &&
                    !this.workspaceMembership.belongsTo(column.window, this.appState.activeWorkspaceId)) {
                errors.push(`wrong-workspace:${uuid}`);
            }
            if (column.logicalX !== expectedLogicalX) {
                errors.push(`logical-x:${column.id}:${column.logicalX}:${expectedLogicalX}`);
            }
            if (!Number.isFinite(column.pixelWidth) || column.pixelWidth < 1) {
                errors.push(`invalid-width:${column.id}:${column.pixelWidth}`);
            }
            const windowState = this.windowStates.get(column.window);
            const adoptionOwnsColumn = windowState &&
                this.managedPhases.has(windowState.adoptionPhase);
            if (!windowState || !windowState.managedByScrollLayout ||
                    windowState.columnId !== column.id || windowState.floating ||
                    !adoptionOwnsColumn) {
                errors.push(`state-ownership:${column.id}`);
            }
            if (windowState && this.appState.activeWorkspaceId &&
                    windowState.workspaceOwnerId !== this.appState.activeWorkspaceId) {
                errors.push(`mounted-workspace-owner:${uuid}`);
            }
            if (this.appState.targetOutput &&
                    column.window.output !== this.appState.targetOutput) {
                errors.push(`wrong-output:${column.id}`);
            }
            expectedLogicalX += column.pixelWidth + (v2 ? v2.gap : this.appState.innerGap);
        });

        if (this.appState.activeWorkspaceId) {
            this.windowStates.forEach((state, window) => {
                if (state.workspaceOwnerId !== this.appState.activeWorkspaceId &&
                        (state.managedByScrollLayout || state.columnId !== null)) {
                    errors.push(`inactive-mounted:${this.normalizeUuid(window.internalId)}`);
                }
            });
        }
        if (this.workspaceSnapshots) {
            const owners = new Set();
            this.workspaceSnapshots.all().forEach(snapshot => snapshot.columns.forEach(column => {
                if (owners.has(column.uuid)) errors.push(`duplicate-workspace-owner:${column.uuid}`);
                owners.add(column.uuid);
            }));
        }

        if (!columns.length) {
            if (this.appState.focusedColumnIndex !== -1) errors.push("empty-focus");
        } else if (this.appState.focusedColumnIndex < 0 ||
                this.appState.focusedColumnIndex >= columns.length) {
            errors.push(`focus-index:${this.appState.focusedColumnIndex}`);
        }

        const maximumOffset = v2 ? deriveV2Layout(columns, v2).maxCamera : Math.max(0, this.stripWidth() -
            (this.appState.safeRect ? this.appState.safeRect.width : 0));
        if (this.appState.scrollOffsetX < 0 ||
                this.appState.scrollOffsetX > maximumOffset) {
            errors.push(`scroll-offset:${this.appState.scrollOffsetX}:${maximumOffset}`);
        }

        const presentation = this.appState.presentation;
        const viewport = this.appState.viewport;
        if (viewport) {
            if (viewport.mode === "pair") {
                if (viewport.wideColumnId !== null) {
                    errors.push("pair-with-wide-target");
                }
            } else if (viewport.mode === "wide-focus") {
                const wideIndex = columns.findIndex(column =>
                    column.id === viewport.wideColumnId && column.persistentWide);
                if (wideIndex < 0) errors.push("missing-wide-viewport-target");
                else if (wideIndex !== this.appState.focusedColumnIndex) {
                    errors.push(`wide-viewport-focus:${wideIndex}:` +
                        `${this.appState.focusedColumnIndex}`);
                }
            } else {
                errors.push(`invalid-viewport-mode:${viewport.mode}`);
            }
        }
        if (presentation.mode === this.normalPresentationMode) {
            if (presentation.windowUuid) errors.push("normal-with-target");
        } else {
            const presentedIndex = columns.findIndex(column =>
                this.normalizeUuid(column.window.internalId) === presentation.windowUuid);
            if (presentedIndex < 0) {
                errors.push(`missing-presentation:${presentation.windowUuid}`);
            }
            if (presentedIndex >= 0 &&
                    presentedIndex !== this.appState.focusedColumnIndex) {
                errors.push(`presentation-focus:${presentedIndex}:` +
                    `${this.appState.focusedColumnIndex}`);
            }
        }
        return errors;
    }

    check(reason, epoch) {
        const errors = this.errors();
        if (!errors.length) {
            if (this.lastWarning) {
                this.debug(`[cc-stability] RECOVERED epoch=${epoch} reason=${reason}`);
            }
            this.lastWarning = "";
            return true;
        }
        const signature = errors.join(",");
        if (signature !== this.lastWarning) {
            this.warn(`[cc-stability] INVARIANT epoch=${epoch} reason=${reason}` +
                ` errors=${signature}`);
            this.lastWarning = signature;
        }
        return false;
    }
}

// Generated from src/kwin/stability/StabilitySupervisor.js
class StabilitySupervisor {
    constructor(options) {
        this.checker = options.checker;
        this.setTimer = options.setTimer;
        this.clearTimer = options.clearTimer;
        this.relayout = options.relayout;
        this.recovery = options.recovery;
        this.disableLayout = options.disableLayout;
        this.isEnabled = options.isEnabled;
        this.warn = options.warn;
        this.debug = options.debug;
        this.verifyDelayMs = options.verifyDelayMs || 250;
        this.settleDelayMs = options.settleDelayMs || 250;
        this.phase = "normal";
        this.pending = null;
        this.failureEpoch = 0;
    }

    clearPending() {
        if (this.pending) this.clearTimer(this.pending);
        this.pending = null;
        this.failureEpoch += 1;
    }

    schedule(callback, delayMs) {
        const token = ++this.failureEpoch;
        this.pending = this.setTimer(() => {
            if (token !== this.failureEpoch || this.phase === "disabled") return;
            this.pending = null;
            callback();
        }, delayMs);
    }

    audit(reason, epoch) {
        if (this.phase === "disabled" || !this.isEnabled()) return true;
        const passed = this.checker.check(reason, epoch);
        if (this.phase === "healing" || this.phase === "recovering") return passed;
        if (passed) {
            if (this.phase === "verify") {
                this.clearPending();
                this.phase = "normal";
            }
            return true;
        }
        if (this.phase !== "verify") {
            this.phase = "verify";
            this.warn(`[cc-stability] INVARIANT_FAIL epoch=${epoch}` +
                ` errors=${this.checker.errors().join(",")}`);
            this.debug(`[cc-stability] VERIFY_PENDING epoch=${epoch}`);
            this.schedule(() => this.verify(epoch), this.verifyDelayMs);
        }
        return false;
    }

    verify(epoch) {
        if (!this.isEnabled()) return this.stop();
        const errors = this.checker.errors();
        if (!errors.length) {
            this.checker.check("delayed-verification", epoch);
            this.phase = "normal";
            return;
        }
        if (errors.some(error => this.isCritical(error))) {
            this.failSafe(epoch, errors);
            return;
        }
        this.phase = "healing";
        this.warn(`[cc-stability] SELF_HEAL epoch=${epoch} errors=${errors.join(",")}`);
        try {
            this.relayout("invariant-self-heal");
        } catch (error) {
            this.failSafe(epoch, [`relayout-error:${error}`]);
            return;
        }
        if (this.phase !== "healing") return;
        this.schedule(() => {
            if (!this.isEnabled()) return this.stop();
            const remaining = this.checker.errors();
            if (remaining.length) {
                this.failSafe(epoch, remaining);
                return;
            }
            this.checker.check("self-heal", epoch);
            this.phase = "normal";
            this.warn(`[cc-stability] SELF_HEAL_RECOVERED epoch=${epoch}`);
        }, this.settleDelayMs);
    }

    isCritical(error) {
        return /^(duplicate-window|duplicate-uuid|state-ownership|wrong-output|invalid-width|invalid-viewport-mode|sticky-managed|wrong-workspace|mounted-workspace-owner|inactive-mounted|duplicate-workspace-owner):/.test(error);
    }

    failSafe(epoch, errors) {
        if (this.phase === "recovering" || this.phase === "disabled") return;
        this.phase = "recovering";
        this.clearPending();
        this.warn(`[cc-stability] FAIL_SAFE epoch=${epoch} errors=${errors.join(",")}`);
        this.disableLayout();
        try {
            this.recovery.restoreAll("invariant-failure");
        } finally {
            this.phase = "disabled";
        }
    }

    stop() {
        if (this.phase === "disabled") return;
        this.clearPending();
        this.phase = "disabled";
    }
}

// Generated from src/kwin/stability/ParkingManager.js
class ParkingManager {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.getState = options.getState;
        this.refreshSafeArea = options.refreshSafeArea;
        this.getSafeRect = options.getSafeRect;
        this.debug = options.debug;
        this.trackUserMinimized = options.trackUserMinimized === true;
    }

    owns(window) {
        const state = this.getState(window);
        return Boolean(state && (state.scrollParkedByScript ||
            state.scrollVisuallyHidden || state.scrollParkingMinimized || state.scrollUserMinimized));
    }

    isHidden(window) {
        const state = this.getState(window);
        return Boolean(state && state.scrollVisuallyHidden);
    }

    rememberVisibleGeometry(window, rect) {
        const state = this.stateFor(window);
        state.scrollLastVisibleGeometry = rect;
    }

    prepareGeometry(window) {
        // Minimized Wayland clients can withhold resized buffers indefinitely.
        // Keep the frame invisible while allowing its configure ACK to arrive.
        if (!window.minimized) return;
        const state = this.stateFor(window);
        if (!state.scrollParkingMinimized) state.scrollUserMinimized = true;
        this.setVisibility(window, false);
        window.minimized = false;
        state.scrollParkingMinimized = true;
    }

    setVisibility(window, visible) {
        const state = this.stateFor(window);
        if (state.scrollOriginalOpacity === null) {
            const currentOpacity = Number(window.opacity);
            state.scrollOriginalOpacity = currentOpacity > 0 ? currentOpacity : 1;
        }
        if (visible) {
            window.opacity = state.scrollOriginalOpacity;
            if (state.scrollParkingMinimized && window.minimized) {
                window.minimized = false;
            }
            state.scrollParkedByScript = false;
            state.scrollParkingMinimized = false;
            state.scrollVisuallyHidden = false;
            return;
        }
        if (this.trackUserMinimized && window.minimized && !state.scrollParkingMinimized && !state.scrollVisuallyHidden)
            state.scrollUserMinimized = true;
        window.opacity = 0;
        if (!window.minimized) {
            window.minimized = true;
            state.scrollParkingMinimized = true;
        }
        state.scrollParkedByScript = true;
        state.scrollVisuallyHidden = true;
    }

    recoveryRect(windowState, fallbackIndex) {
        this.refreshSafeArea();
        const safeRect = this.getSafeRect();
        if (!safeRect) return null;
        const source = windowState.scrollLastVisibleGeometry;
        if (source) {
            const width = Math.max(1, Math.min(Number(source.width), safeRect.width));
            const height = Math.max(1, Math.min(Number(source.height), safeRect.height));
            return {
                x: Math.max(safeRect.x, Math.min(Number(source.x),
                    safeRect.x + safeRect.width - width)),
                y: Math.max(safeRect.y, Math.min(Number(source.y),
                    safeRect.y + safeRect.height - height)),
                width,
                height,
            };
        }
        const cascade = Math.max(0, Number(fallbackIndex) || 0) * 24;
        const width = Math.max(1, Math.floor(safeRect.width * 0.72));
        const height = Math.max(1, Math.floor(safeRect.height * 0.82));
        return {
            x: safeRect.x + Math.min(cascade, Math.max(0, safeRect.width - width)),
            y: safeRect.y + Math.min(cascade, Math.max(0, safeRect.height - height)),
            width,
            height,
        };
    }

    release(window, reason, ensureAccessible = false, fallbackIndex = 0, observe = null) {
        const state = this.getState(window);
        if (!this.owns(window)) return false;
        let target = null;
        if (ensureAccessible && !window.fullScreen && !state.scrollUserMinimized) {
            target = this.recoveryRect(state, fallbackIndex);
            if (target) {
                state.internalChange = true;
                try {
                    window.frameGeometry = target;
                } finally {
                    state.internalChange = false;
                }
            }
        }
        window.opacity = state.scrollOriginalOpacity;
        if (state.scrollUserMinimized) window.minimized = true;
        else if (state.scrollParkingMinimized && window.minimized) {
            window.minimized = false;
        }
        state.scrollUserMinimized = false;
        state.scrollParkedByScript = false;
        state.scrollParkingMinimized = false;
        state.scrollVisuallyHidden = false;
        if (observe) observe({ window, target, opacity: Number(window.opacity), minimized: window.minimized });
        this.debug(`[cc-stability] RELEASE_PARKING caption=${window.caption}` +
            ` accessible=${ensureAccessible} reason=${reason}`);
        return true;
    }
}

// Generated from src/kwin/stability/Recovery.js
class Recovery {
    constructor(options) {
        this.appState = options.appState;
        this.windowStates = options.windowStates;
        this.parking = options.parking;
        this.indexOfWindow = options.indexOfWindow;
        this.beforeRestore = options.beforeRestore;
        this.retire = options.retire || null;
        this.retiring = false;
        this.waitForRestored = options.waitForRestored || null;
        this.onStatus = options.onStatus || (() => {});
        this.status = { state: "running", requestId: null, restoredCount: 0 };
        this.waiting = false;
        this.blocked = false;
        this.debug = options.debug;
        this.warn = options.warn || options.debug;
    }

    report(state, restoredCount = 0) {
        this.status = Object.assign({}, this.status, { state, restoredCount });
        this.onStatus(this.status);
    }

    restoreAll(reason, requestId = null) {
        if (this.retiring || this.waiting) return 0;
        this.status = { state: "pending", requestId, restoredCount: 0 };
        this.onStatus(this.status);
        if (this.blocked) { this.report("blocked"); return 0; }
        if (this.retire) {
            if (this.retiring) return 0;
            this.retiring = true;
            this.retire(confirmed => {
                this.retiring = false;
                if (confirmed === true) this.restoreReleased(reason);
                else { this.blocked = true; this.report("blocked"); this.warn(`[cc-stability] RESTORE_BLOCKED native ownership unconfirmed reason=${reason}`); }
            });
            return 0;
        }
        return this.restoreReleased(reason);
    }

    restoreReleased(reason) {
        this.beforeRestore(reason);
        let restored = 0;
        const requests = [];
        this.appState.columns.slice().forEach((column, index) => {
            if (this.parking.release(column.window, reason, true, index, row => requests.push(row))) restored += 1;
        });
        this.windowStates.forEach((_windowState, window) => {
            if (this.indexOfWindow(window) >= 0) return;
            if (this.parking.release(window, reason, true, restored, row => requests.push(row))) restored += 1;
        });
        if (this.waitForRestored) {
            this.waiting = true;
            this.waitForRestored(requests, accepted => { this.waiting = false; this.blocked = accepted !== true;
                this.report(accepted ? "restored" : "blocked", restored); });
        } else this.report("restored", restored);
        this.warn(`[cc-stability] EMERGENCY_RESTORE count=${restored} reason=${reason}`);
        return restored;
    }
}

// Generated from src/kwin/stability/RecoveryCompletionGate.js
// Event-driven proof of restored KWin frames/visibility. No paint sampling,
// geometry authority or persistent window references after completion/timeout.
class RecoveryCompletionGate {
    constructor(options) { Object.assign(this, options); this.pending = null; }

    wait(requests, done) {
        if (this.pending) { done(false); return; }
        const pending = { rows: new Set(requests), disposers: [], timer: null };
        this.pending = pending;
        const finish = accepted => {
            if (this.pending !== pending) return;
            this.pending = null;
            if (pending.timer) this.clearTimer(pending.timer);
            pending.disposers.splice(0).forEach(dispose => { try { dispose(); } catch (_error) { /* destroyed */ } });
            pending.rows.clear();
            done(accepted);
        };
        const check = () => {
            if (this.pending !== pending) return;
            const windows = this.getWindows();
            for (const row of pending.rows) {
                if (!windows.includes(row.window)) continue;
                try {
                    if (row.target && !this.sameRect(row.window.frameGeometry, row.target)) return;
                    if (Math.abs(Number(row.window.opacity) - row.opacity) > 0.000001 ||
                            row.window.minimized !== row.minimized) return;
                } catch (_error) { finish(false); return; }
            }
            finish(true);
        };
        try {
            for (const row of requests) {
                const window = row.window;
                if (!this.getWindows().includes(window)) continue;
                for (const signal of [window.frameGeometryChanged, window.opacityChanged, window.minimizedChanged]) {
                    if (!signal || !signal.connect) continue;
                    signal.connect(check); pending.disposers.push(() => signal.disconnect(check));
                }
                const closed = () => { pending.rows.delete(row); check(); };
                window.closed.connect(closed); pending.disposers.push(() => window.closed.disconnect(closed));
            }
            pending.timer = this.setTimer(() => finish(false), this.timeoutMs || 3500);
            check();
        } catch (_error) { finish(false); }
    }
}

// Generated from src/kwin/lifecycle/AdoptionController.js
class AdoptionController {
    constructor(options) {
        this.phases = options.phases;
        this.stateFor = options.stateFor;
        this.hasState = options.hasState;
        this.indexOfWindow = options.indexOfWindow;
        this.getAppState = options.getAppState;
        this.refreshAppState = options.refreshAppState;
        this.windowPolicy = options.windowPolicy;
        this.workspaceMembership = options.workspaceMembership || null;
        this.workspaceReady = options.workspaceReady || (() => true);
        this.dispositions = options.dispositions;
        this.removeManagedWindow = options.removeManagedWindow;
        this.isLayoutMode = options.isLayoutMode;
        this.isTileMode = options.isTileMode;
        this.detectQuickTileMode = options.detectQuickTileMode;
        this.fullMaximizeMode = options.fullMaximizeMode;
        this.adoptWindow = options.adoptWindow;
        this.settleLayout = options.settleLayout;
        this.rectText = options.rectText;
        this.debug = options.debug;
    }

    transition(window, windowState, phase, reason) {
        const previous = windowState.adoptionPhase;
        windowState.adoptionPhase = phase;
        windowState.adoptionLastEvent = reason;
        if (previous !== phase) {
            this.debug(`[cc-adoption] PHASE ${previous}->${phase}` +
                ` caption=${window.caption} reason=${reason}`);
            if (phase === this.phases.policyFloating ||
                    phase === this.phases.ignored) {
                const decision = this.windowPolicy.classify(window);
                this.debug(`[cc-policy] ${decision.kind} reason=${decision.reason}` +
                    ` caption=${window.caption}`);
            }
        }
    }

    waitPhase(window, windowState) {
        const state = this.getAppState();
        const decision = this.windowPolicy.classify(window);
        if (decision.kind === this.dispositions.NATIVE_ONLY) {
            return this.phases.ignored;
        }
        if (decision.kind === this.dispositions.POLICY_FLOATING) {
            return this.phases.policyFloating;
        }
        if (windowState.floating) return this.phases.floating;
        const membershipPhase = this.membershipPhase(window, windowState);
        if (membershipPhase) return membershipPhase;
        if (!state.enabled || !state.targetOutput ||
                window.output !== state.targetOutput) {
            return this.phases.waitingPrimary;
        }
        if (window.fullScreen || this.isLayoutMode(windowState.layoutMode) ||
                Number(window.maximizeMode) === this.fullMaximizeMode ||
                this.isTileMode(this.detectQuickTileMode(window))) {
            return this.phases.waitingNormal;
        }
        if (!window.active) return this.phases.waitingActivation;
        return null;
    }

    membershipPhase(window, windowState) {
        if (!this.workspaceMembership) return null;
        windowState.workspaceOwnerId = this.workspaceMembership.ownerId(window);
        if (!this.workspaceMembership.isSingleDesktop(window)) return this.phases.ignored;
        if (!this.workspaceMembership.belongsToActive(window, this.getAppState().targetOutput)) {
            return this.phases.waitingWorkspace;
        }
        if (!this.workspaceReady()) return this.phases.waitingWorkspace;
        return null;
    }

    settle(window, windowState, reason) {
        const index = this.indexOfWindow(window);
        if (index < 0) {
            this.transition(window, windowState, this.phases.waitingEligible,
                `${reason}-missing-column`);
            return false;
        }
        if (!window.active) {
            this.transition(window, windowState, this.phases.managed,
                `${reason}-inactive-after-adopt`);
            return true;
        }
        const result = this.settleLayout(window, index, reason);
        if (result.settled) {
            this.transition(window, windowState, this.phases.managed, reason);
            this.debug(`[cc-scroll] ADOPT_SETTLED column=${result.column.id}` +
                ` caption=${window.caption} geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }
        this.transition(window, windowState, this.phases.settling, reason);
        this.debug(`[cc-scroll] ADOPT_PENDING column=${result.column.id}` +
            ` caption=${window.caption} actual=${this.rectText(window.frameGeometry)}` +
            ` expected=${this.rectText(result.expected)} reason=${reason}`);
        return false;
    }

    advance(window, reason) {
        if (!window || !this.hasState(window)) return false;
        const windowState = this.stateFor(window);
        if (!this.workspaceReady()) {
            if (this.indexOfWindow(window) < 0 && !windowState.floating &&
                    this.windowPolicy.canJoinColumn(window)) {
                this.transition(window, windowState, this.phases.waitingWorkspace, reason);
            }
            return false;
        }
        if (windowState.adoptionPhase === this.phases.managed) {
            return this.indexOfWindow(window) >= 0;
        }
        if (windowState.adoptionPhase === this.phases.floating ||
                windowState.adoptionPhase === this.phases.policyFloating ||
                windowState.adoptionPhase === this.phases.ignored) return false;
        if (windowState.adoptionPhase === this.phases.settling &&
                this.indexOfWindow(window) >= 0) {
            return this.settle(window, windowState, reason);
        }
        if (windowState.adoptionPhase === this.phases.untracked) return false;

        this.refreshAppState();
        const waitPhase = this.waitPhase(window, windowState);
        if (waitPhase) {
            this.transition(window, windowState, waitPhase, reason);
            return false;
        }

        this.transition(window, windowState, this.phases.adopting, reason);
        windowState.adoptionAttempts += 1;
        this.transition(window, windowState, this.phases.settling, reason);
        if (!this.adoptWindow(window, reason, true)) {
            this.transition(window, windowState, this.phases.waitingEligible,
                `${reason}-adopt-rejected`);
            return false;
        }
        return this.settle(window, windowState, reason);
    }

    begin(window, origin) {
        if (!window) return false;
        const windowState = this.stateFor(window);
        if (this.workspaceMembership) {
            windowState.workspaceOwnerId = this.workspaceMembership.ownerId(window);
        }
        const decision = this.windowPolicy.classify(window);
        if (decision.kind !== this.dispositions.MANAGED_ELIGIBLE) {
            this.transition(window, windowState,
                decision.kind === this.dispositions.POLICY_FLOATING
                    ? this.phases.policyFloating : this.phases.ignored,
                origin);
            return false;
        }
        if (windowState.floating) {
            this.transition(window, windowState, this.phases.floating, origin);
            return false;
        }
        const membershipPhase = this.membershipPhase(window, windowState);
        if (membershipPhase) {
            this.transition(window, windowState, membershipPhase, origin);
            return false;
        }
        if (windowState.managedByScrollLayout || this.indexOfWindow(window) >= 0) {
            this.transition(window, windowState, this.phases.managed, origin);
            return true;
        }
        windowState.adoptionOrigin = origin;
        this.transition(window, windowState, this.phases.waitingEligible, origin);
        return this.advance(window, origin);
    }

    onWindowAdded(window) {
        return this.begin(window, "window-added");
    }

    onActivated(window, reason = "window-activated-after-add") {
        return this.advance(window, reason);
    }

    onReady(window, reason = "ready-for-painting") {
        return this.advance(window, reason);
    }

    onGeometryChanged(window, reason = "pending-geometry-changed") {
        return this.advance(window, reason);
    }

    onOutputChanged(window, reason = "output-entered-primary") {
        return this.advance(window, reason);
    }

    onFullscreenChanged(window, reason = "fullscreen-exit") {
        return this.advance(window, reason);
    }

    onMembershipChanged(window, reason = "window-desktops-changed") {
        if (!window || !this.hasState(window)) return false;
        this.refreshAppState();
        return this.onPolicyChanged(window, reason);
    }

    onPolicyChanged(window, reason) {
        if (!window || !this.hasState(window)) return false;
        const decision = this.windowPolicy.classify(window);
        const windowState = this.stateFor(window);
        if (this.workspaceMembership) {
            windowState.workspaceOwnerId = this.workspaceMembership.ownerId(window);
        }
        if (!this.workspaceReady()) return false;
        if (decision.kind !== this.dispositions.MANAGED_ELIGIBLE &&
                this.indexOfWindow(window) >= 0) {
            this.removeManagedWindow(window, `policy-${decision.reason}`, false);
        }
        if (decision.kind === this.dispositions.POLICY_FLOATING) {
            this.transition(window, windowState, this.phases.policyFloating, reason);
            return false;
        }
        if (decision.kind === this.dispositions.NATIVE_ONLY) {
            this.transition(window, windowState, this.phases.ignored, reason);
            return false;
        }
        if (windowState.floating) {
            this.transition(window, windowState, this.phases.floating, reason);
            return false;
        }
        const membershipPhase = this.membershipPhase(window, windowState);
        if (membershipPhase) {
            if (this.indexOfWindow(window) >= 0) {
                // Policy/membership fallback only. Workspace transfer removes
                // the column before adoption; Workspace unmount uses its own path.
                this.removeManagedWindow(window, "window-desktops-changed", false);
            }
            this.transition(window, windowState, membershipPhase, reason);
            return false;
        }
        if (this.indexOfWindow(window) >= 0) {
            this.transition(window, windowState, this.phases.managed, reason);
            return true;
        }
        this.transition(window, windowState, this.phases.waitingEligible, reason);
        return this.advance(window, reason);
    }
}

// Generated from src/kwin/lifecycle/FloatingController.js
class FloatingController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.hasState = options.hasState;
        this.indexOfWindow = options.indexOfWindow;
        this.getAppState = options.getAppState;
        this.refreshAppState = options.refreshAppState;
        this.windowPolicy = options.windowPolicy;
        this.workspaceMembership = options.workspaceMembership || null;
        this.dispositions = options.dispositions;
        this.prepareWindow = options.prepareWindow;
        this.adoptWindow = options.adoptWindow;
        this.removeColumn = options.removeColumn;
        this.transitionAdoption = options.transitionAdoption;
        this.floatingPhase = options.floatingPhase;
        this.settlingPhase = options.settlingPhase;
        this.managedPhase = options.managedPhase;
        this.getActiveWindow = options.getActiveWindow;
        this.setActiveWindow = options.setActiveWindow;
        this.rectText = options.rectText;
        this.debug = options.debug;
        this.warn = options.warn;
        this.now = options.now;
        this.focusGuardMs = options.focusGuardMs;
        this.rememberedWindow = null;
        this.detachedAt = 0;
        this.focusGuardUntil = 0;
    }

    detach(window, reason) {
        const index = this.indexOfWindow(window);
        if (!window || index < 0) return false;
        const windowState = this.stateFor(window);
        windowState.floating = true;
        this.transitionAdoption(window, windowState, this.floatingPhase, reason);
        this.removeColumn(window, reason, false);
        if (window.minimized) window.minimized = false;
        if (this.getActiveWindow() !== window) this.setActiveWindow(window);
        this.debug(`[cc-scroll] FLOAT caption=${window.caption}` +
            ` geometry=${this.rectText(window.frameGeometry)} reason=${reason}`);
        return true;
    }

    attach(window, reason) {
        if (!window || !this.windowPolicy.canJoinColumn(window) ||
                window.fullScreen) return false;
        this.refreshAppState();
        const appState = this.getAppState();
        if (this.workspaceMembership &&
                !this.workspaceMembership.belongsToActive(window, appState.targetOutput)) return false;
        if (!appState.enabled || !appState.targetOutput ||
                window.output !== appState.targetOutput ||
                this.indexOfWindow(window) >= 0) {
            return false;
        }
        const windowState = this.stateFor(window);
        if (!this.prepareWindow(window)) {
            this.warn(`[cc-scroll] MANAGE rejected caption=${window.caption}` +
                ` reason=layout-detach-failed`);
            return false;
        }
        windowState.floating = false;
        this.transitionAdoption(window, windowState, this.settlingPhase, reason);
        if (!this.adoptWindow(window, reason, true)) {
            windowState.floating = true;
            this.transitionAdoption(
                window,
                windowState,
                this.floatingPhase,
                `${reason}-rollback`
            );
            return false;
        }
        this.transitionAdoption(window, windowState, this.managedPhase, reason);
        this.debug(`[cc-scroll] MANAGE caption=${window.caption}` +
            ` geometry=${this.rectText(window.frameGeometry)} reason=${reason}`);
        return true;
    }

    remember(window, guardFocus) {
        this.rememberedWindow = window;
        this.detachedAt = this.now();
        this.focusGuardUntil = guardFocus
            ? this.detachedAt + this.focusGuardMs
            : 0;
        this.debug(`[cc-scroll] REMEMBER_FLOAT caption=${window.caption}` +
            ` guard=${guardFocus}`);
    }

    hasRememberedFloating() {
        if (this.rememberedWindow &&
                !this.windowPolicy.canJoinColumn(this.rememberedWindow)) {
            this.clearRemembered();
            return false;
        }
        return Boolean(this.rememberedWindow &&
            (!this.workspaceMembership || this.workspaceMembership.belongsToActive(
                this.rememberedWindow, this.getAppState().targetOutput)) &&
            this.hasState(this.rememberedWindow) &&
            this.stateFor(this.rememberedWindow).floating &&
            this.indexOfWindow(this.rememberedWindow) < 0);
    }

    toggle(window) {
        if (window && this.windowPolicy.classify(window).kind ===
                this.dispositions.POLICY_FLOATING) {
            this.debug(`[cc-scroll] FLOAT_TOGGLE_BLOCKED reason=policy-floating` +
                ` caption=${window.caption}`);
            return false;
        }
        const rememberedFloating = this.hasRememberedFloating();
        let target = window;
        if (rememberedFloating && target !== this.rememberedWindow) {
            target = this.rememberedWindow;
        }
        if (!target) return false;
        if (this.indexOfWindow(target) >= 0) {
            if (this.detach(target, "shortcut-toggle-floating")) {
                this.remember(target, true);
                this.setActiveWindow(target);
                return true;
            }
            return false;
        }
        if (this.attach(target, "shortcut-toggle-managed") &&
                target === this.rememberedWindow) {
            this.clearRemembered();
            return true;
        }
        return false;
    }

    redirectActivation(window) {
        if (this.rememberedWindow && this.now() <= this.focusGuardUntil &&
                (!this.workspaceMembership || this.workspaceMembership.belongsToActive(
                    this.rememberedWindow, this.getAppState().targetOutput)) &&
                this.hasState(this.rememberedWindow) &&
                this.stateFor(this.rememberedWindow).floating &&
                window !== this.rememberedWindow) {
            this.setActiveWindow(this.rememberedWindow);
            return true;
        }
        if (this.now() > this.focusGuardUntil) this.focusGuardUntil = 0;
        return false;
    }

    onInteractiveMoveResize(window) {
        if (this.indexOfWindow(window) < 0) return false;
        const state = this.stateFor(window);
        state.interactiveMoveResize = true;
        if (this.detach(window, "interactive-move-resize")) {
            this.remember(window, false);
        }
        return true;
    }

    onWindowClosed(window) {
        if (window === this.rememberedWindow) this.clearRemembered();
    }

    clearRemembered() {
        this.rememberedWindow = null;
        this.detachedAt = 0;
        this.focusGuardUntil = 0;
    }
}

// Generated from src/kwin/lifecycle/OutputController.js
class OutputController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.indexOfWindow = options.indexOfWindow;
        this.resolvePrimaryOutput = options.resolvePrimaryOutput;
        this.clearPresentationForWindow = options.clearPresentationForWindow;
        this.removeColumn = options.removeColumn;
        this.transitionAdoption = options.transitionAdoption;
        this.phases = options.phases;
        this.profileForOutput = options.profileForOutput;
        this.translateRestoreGeometry = options.translateRestoreGeometry;
        this.fullMaximizeMode = options.fullMaximizeMode;
        this.maximizeMode = options.maximizeMode;
        this.applyLayoutGeometry = options.applyLayoutGeometry;
        this.detectQuickTileMode = options.detectQuickTileMode;
        this.isTileMode = options.isTileMode;
        this.applyDetectedTile = options.applyDetectedTile;
        this.beginAdoption = options.beginAdoption;
        this.advanceAdoption = options.advanceAdoption;
        this.setLayoutMode = options.setLayoutMode;
        this.rectText = options.rectText;
        this.debug = options.debug;
    }

    onOutputChanged(window) {
        const state = this.stateFor(window);
        if (state.internalChange || state.interactiveMoveResize || window.fullScreen) {
            return false;
        }

        const primary = this.resolvePrimaryOutput();
        if (this.indexOfWindow(window) >= 0 && window.output !== primary) {
            this.clearPresentationForWindow(window);
            this.removeColumn(window, "output-left-primary", false);
            this.transitionAdoption(
                window,
                state,
                this.phases.waitingPrimary,
                "output-left-primary"
            );
            this.debug(`[cc-scroll] LEAVE_PRIMARY caption=${window.caption}` +
                ` output=${this.outputName(window.output)}`);
            return true;
        }

        if (window.output !== primary &&
                state.adoptionPhase !== this.phases.untracked &&
                state.adoptionPhase !== this.phases.floating &&
                state.adoptionPhase !== this.phases.ignored) {
            this.transitionAdoption(
                window,
                state,
                this.phases.waitingPrimary,
                "output-wait-primary"
            );
        }

        const profile = this.profileForOutput(window.output);
        this.translateRestoreGeometry(state, window.output);
        if (profile) {
            if (Number(window.maximizeMode) === this.fullMaximizeMode ||
                    state.layoutMode === this.maximizeMode) {
                this.applyLayoutGeometry(
                    window,
                    state,
                    this.maximizeMode,
                    "output-adopt-maximize"
                );
            } else if (this.isTileMode(this.detectQuickTileMode(window))) {
                this.applyDetectedTile(window, "output-adopt-tile");
            } else if (window.output === primary) {
                if (state.adoptionPhase === this.phases.untracked) {
                    this.beginAdoption(window, "output-entered-primary");
                } else {
                    this.advanceAdoption(window, "output-entered-primary");
                }
            }
            return true;
        }

        if (state.layoutMode === this.maximizeMode &&
                Number(window.maximizeMode) !== this.fullMaximizeMode) {
            state.internalChange = true;
            try {
                window.setMaximize(true, true);
            } finally {
                state.internalChange = false;
            }
            this.debug(`NATIVE-TRANSFER ${window.caption} mode=maximize` +
                ` output=${this.outputName(window.output)}` +
                ` geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }

        const tileMode = this.detectQuickTileMode(window);
        if (this.isTileMode(tileMode)) {
            this.setLayoutMode(state, tileMode);
            this.debug(`NATIVE-TRANSFER ${window.caption} mode=${tileMode}` +
                ` output=${this.outputName(window.output)}` +
                ` geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }
        return false;
    }

    outputName(output) {
        return output ? output.name : "<none>";
    }
}

// Generated from src/kwin/lifecycle/FullscreenController.js
class FullscreenController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.getAppState = options.getAppState;
        this.viewport = options.viewport;
        this.indexOfWindow = options.indexOfWindow;
        this.relayout = options.relayout;
        this.onManagedOutput = options.onManagedOutput;
        this.isLayoutMode = options.isLayoutMode;
        this.applyLayoutGeometry = options.applyLayoutGeometry;
        this.advanceAdoption = options.advanceAdoption;
        this.normalMode = options.normalMode;
        this.debug = options.debug;
    }

    onFullscreenChanged(window) {
        const state = this.stateFor(window);
        if (state.internalChange) return false;

        if (window.fullScreen) {
            this.viewport.cancelReveal();
            state.layoutModeBeforeFullscreen = state.layoutMode;
            const appState = this.getAppState ? this.getAppState() : null;
            state.viewportBeforeFullscreen = appState && appState.viewport
                ? Object.assign({}, appState.viewport) : null;
            this.debug(`FULLSCREEN enter ${window.caption} prior=${state.layoutMode}`);
            return true;
        }

        const prior = state.layoutModeBeforeFullscreen;
        state.layoutModeBeforeFullscreen = this.normalMode;
        if (this.indexOfWindow(window) >= 0) {
            const previous = state.viewportBeforeFullscreen;
            if (previous) this.viewport.restore(previous);
            state.viewportBeforeFullscreen = null;
            this.relayout("fullscreen-exit");
        } else if (this.onManagedOutput(window) && this.isLayoutMode(prior)) {
            state.viewportBeforeFullscreen = null;
            this.applyLayoutGeometry(window, state, prior, "fullscreen-exit");
        } else {
            state.viewportBeforeFullscreen = null;
            this.advanceAdoption(window, "fullscreen-exit");
        }
        return true;
    }
}

// Generated from src/kwin/integration/RuntimeBridge.js
class RuntimeBridge {
    constructor(options) {
        this.invoke = options.invoke;
        this.service = options.service;
        this.path = options.path;
        this.interfaceName = options.interfaceName;
        this.snapshotProvider = options.snapshotProvider;
        this.handlers = options.handlers;
        if (options.partialController) this.handlers = Object.assign({}, this.handlers, {
            "focus-partial-column": command => options.partialController.focusPartialRequest(command),
        });
        this.generationAgnosticTypes = new Set(
            options.generationAgnosticTypes || []
        );
        this.debug = options.debug;
        this.warn = options.warn;
        this.protocol = options.protocol || 1;
        this.snapshotProtocol = options.snapshotProtocol || this.protocol;
        this.sessionIdValue = options.sessionId ||
            `${options.now().toString(16)}-` +
            `${Math.floor(options.random() * 0x100000000).toString(16)}`;
        this.generationValue = 0;
    }

    sessionId() {
        return this.sessionIdValue;
    }

    generation() {
        return this.generationValue;
    }

    readPreviousState(callback) {
        this.invoke(this.service, this.path, this.interfaceName,
            "GetState", callback);
    }

    reportRecoveryStatus(status, callback = () => {}) {
        this.invoke(this.service, this.path, this.interfaceName, "ReportRecoveryStatus",
            JSON.stringify(Object.assign({}, status, { protocol: 1, type: "recovery-status", sessionId: this.sessionIdValue })), callback);
    }

    ensureVerticalDesktopLayout(count, callback) {
        this.invoke(this.service, this.path, this.interfaceName,
            "EnsureVerticalDesktopLayout", count, callback);
    }

    envelopeSnapshot(snapshot) {
        return Object.assign({}, snapshot, {
            protocol: this.snapshotProtocol,
            sessionId: this.sessionIdValue,
            generation: this.generationValue,
        });
    }

    publish(snapshot, reason, callback = () => {}) {
        const envelope = this.envelopeSnapshot(snapshot);
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "PublishState",
            JSON.stringify(envelope),
            accepted => {
                this.debug(`[cc-bridge] PUBLISH reason=${reason}` +
                    ` generation=${this.generationValue}` +
                    ` columns=${envelope.columns.length} accepted=${accepted}`);
                callback(accepted);
            }
        );
        return envelope;
    }

    commit(snapshot, reason, callback = () => {}) {
        this.generationValue += 1;
        return this.publish(snapshot, reason, callback);
    }

    publishMotionPlan(plan, callback) {
        if (plan.type === "COLUMN_GEOMETRY" && plan.protocol !== 4) { callback(false); return null; }
        const envelope = Object.assign({}, plan, {
            protocol: plan.type === "COLUMN_GEOMETRY" ? 4 : plan.type === "PARTIAL_SCROLL" ? 3 :
                plan.type === "SCROLL" || plan.type === "COLUMN_REINDEX" ? 2 : this.protocol,
            sessionId: this.sessionIdValue,
        });
        this.invoke(this.service, this.path, this.interfaceName,
            "PublishMotionPlan", JSON.stringify(envelope), callback);
        return envelope;
    }

    armScrollPlan(plan, callback) {
        if (plan.type === "COLUMN_GEOMETRY" && plan.protocol !== 4) { callback(false); return; }
        const envelope = Object.assign({}, plan, { sessionId: this.sessionIdValue });
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1",
            "ArmScrollPlan", JSON.stringify(envelope), callback);
    }

    disarmScrollPlan(epoch, callback = () => {}) {
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1",
            "CancelScrollPlan", JSON.stringify({ sessionId: this.sessionIdValue, epoch }), callback);
    }

    scrollMotionStatus(callback) {
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1",
            "GetScrollMotionStatus", callback);
    }

    partialScrollCapability(callback) {
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1",
            "GetPartialScrollCapability", callback);
    }

    partialPaintedState(callback) {
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1",
            "GetPartialPaintedState", callback);
    }

    columnGeometryCapability(callback) {
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1", "GetColumnGeometryCapability", callback);
    }
    columnGeometrySource(entries, callback) {
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1", "GetColumnGeometrySourceFor", JSON.stringify({entries}), callback);
    }
    columnGeometryCompletion(callback) {
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1", "GetColumnGeometryCompletion", callback);
    }
    disarmColumnGeometry(epoch, callback) {
        this.disarmScrollPlan(epoch, () => this.scrollMotionStatus(raw => {
            let proof;try {proof=typeof raw === "string" ? JSON.parse(raw) : raw;} catch (_error) {callback(false);return;}
            callback(Boolean(proof && proof.active===false && proof.clipHandoffActive!==true &&
                proof.sessionId===this.sessionIdValue && Number.isSafeInteger(proof.epoch) && proof.epoch<=epoch));
        }));
    }

    workspaceTransitionStatus(callback) {
        this.invoke("org.kde.KWin", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1",
            "WorkspaceTransitionActive", callback);
    }

    reportMotionParked(completion, callback) {
        const envelope = Object.assign({}, completion, {
            protocol: this.protocol,
            sessionId: this.sessionIdValue,
        });
        this.invoke(this.service, this.path, this.interfaceName,
            "ReportMotionParked", JSON.stringify(envelope), callback);
        return envelope;
    }

    reject(command, reason) {
        this.warn(`[cc-bridge] REJECT reason=${reason}`);
        return this.publish(this.snapshotProvider(), `reject-${reason}`);
    }

    commandEnvelope(command) {
        const baseGeneration = command.baseGeneration === undefined
            ? this.generationValue
            : command.baseGeneration;
        return Object.assign({}, command, {
            protocol: this.protocol,
            sessionId: this.sessionIdValue,
            baseGeneration,
        });
    }

    requestDeferred(command, delayMs, callback) {
        const envelope = this.commandEnvelope(command);
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "RequestDeferredCommand",
            JSON.stringify(envelope),
            delayMs,
            callback
        );
        return envelope;
    }

    validEnvelope(command) {
        return Boolean(command && command.protocol === this.protocol &&
            command.commandId && Object.prototype.hasOwnProperty.call(
                this.handlers,
                command.type
            ));
    }

    dispatch(command) {
        if (!this.validEnvelope(command)) {
            this.reject(command, "invalid-schema");
            return false;
        }
        if (String(command.sessionId) !== this.sessionIdValue) {
            this.reject(command, "session-mismatch");
            return false;
        }
        if (Number(command.baseGeneration) !== this.generationValue &&
                !this.generationAgnosticTypes.has(command.type)) {
            this.reject(command, "stale-generation");
            return false;
        }
        return this.handlers[command.type](command) !== false;
    }

    acceptPendingJson(json) {
        if (!json) return false;
        let command;
        try {
            command = JSON.parse(String(json));
        } catch (error) {
            this.reject(null, "invalid-json");
            return false;
        }
        return this.dispatch(command);
    }

    takePendingCommand() {
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "TakePendingCommand",
            json => this.acceptPendingJson(json)
        );
    }
}

// Generated from src/kwin/visual/FocusRingController.js
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

// Generated from src/kwin/presentation/PresentationController.js
class PresentationController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.viewport = options.viewport;
        this.normalizeUuid = options.normalizeUuid;
        this.stateFor = options.stateFor;
        this.setLayoutMode = options.setLayoutMode;
        this.modes = options.modes;
        this.normalLayoutMode = options.normalLayoutMode;
        this.maximizeLayoutMode = options.maximizeLayoutMode;
        this.wideRatio = options.wideRatio;
        this.rectCopy = options.rectCopy;
        this.cancelPendingDockScroll = options.cancelPendingDockScroll;
        this.focusColumn = options.focusColumn;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.ensureColumnVisible = options.ensureColumnVisible;
        this.relayout = options.relayout;
        this.getActiveWindow = options.getActiveWindow;
        this.setActiveWindow = options.setActiveWindow;
        this.commitRuntimeState = options.commitRuntimeState;
        this.debug = options.debug;
    }

    isMode(mode) {
        return mode === this.modes.normal || mode === this.modes.wide ||
            mode === this.modes.maximized;
    }

    column() {
        const appState = this.getAppState();
        if (appState.presentation.mode !== this.modes.maximized &&
                appState.viewport && appState.viewport.mode === "wide-focus") {
            return this.viewport.column();
        }
        if (appState.presentation.mode === this.modes.normal ||
                !appState.presentation.windowUuid) return null;
        return appState.columns.find(column =>
            this.normalizeUuid(column.window.internalId) ===
                appState.presentation.windowUuid) || null;
    }

    wideRect() {
        const safeRect = this.getAppState().safeRect;
        const width = Math.max(1, Math.min(
            safeRect.width,
            Math.round(safeRect.width * this.wideRatio)
        ));
        return {
            x: safeRect.x + Math.floor((safeRect.width - width) / 2),
            y: safeRect.y,
            width,
            height: safeRect.height,
        };
    }

    rect() {
        const appState = this.getAppState();
        return appState.presentation.mode !== this.modes.maximized &&
                appState.viewport && appState.viewport.mode === "wide-focus" &&
                this.viewport.column()
            ? this.wideRect()
            : this.rectCopy(appState.safeRect);
    }

    resetPresentedWindowLayoutState() {
        const column = this.column();
        if (!column) return false;
        const windowState = this.stateFor(column.window);
        if (windowState.layoutMode !== this.maximizeLayoutMode) return false;
        this.setLayoutMode(windowState, this.normalLayoutMode);
        windowState.pendingAction = null;
        return true;
    }

    clear() {
        const appState = this.getAppState();
        this.resetPresentedWindowLayoutState();
        appState.presentation.windowUuid = null;
        appState.presentation.mode = this.modes.normal;
        this.viewport.pair();
    }

    selectPersistent(column) {
        const appState = this.getAppState();
        const oldWindowUuid = appState.presentation.windowUuid;
        const oldMode = appState.presentation.mode;
        this.clear();
        // Preference alone never selects a Wide viewport. Only a directional
        // focus intent or an explicit Wide command may do that.
        return oldWindowUuid !== appState.presentation.windowUuid ||
            oldMode !== appState.presentation.mode;
    }

    setMode(windowUuid, mode, reason, restoreViewport = null) {
        if (!this.isMode(mode)) return false;
        const appState = this.getAppState();
        const normalizedUuid = this.normalizeUuid(windowUuid);
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === normalizedUuid);
        if (!column || column.window.output !== appState.targetOutput) return false;

        if (mode === this.modes.maximized) {
            appState.prePresentationViewport = appState.viewport
                ? Object.assign({}, appState.viewport)
                : null;
        }

        this.cancelPendingDockScroll(reason);
        this.resetPresentedWindowLayoutState();

        const oldScrollOffsetX = appState.scrollOffsetX;
        this.focusColumn(column);
        this.recomputeLogicalLayout();
        this.ensureColumnVisible(column);

        const targetState = this.stateFor(column.window);
        targetState.internalChange = true;
        try {
            column.window.setMaximize(false, false);
        } finally {
            targetState.internalChange = false;
        }

        if (mode === this.modes.normal) {
            if (!restoreViewport) column.persistentWide = false;
            appState.presentation.windowUuid = null;
            appState.presentation.mode = this.modes.normal;
            if (restoreViewport) this.viewport.restore(restoreViewport);
            else this.viewport.pair();
        } else {
            if (mode === this.modes.wide) column.persistentWide = true;
            appState.presentation.windowUuid = mode === this.modes.maximized
                ? normalizedUuid : null;
            appState.presentation.mode = mode === this.modes.maximized
                ? mode : this.modes.normal;
            if (mode === this.modes.wide) this.viewport.wide(column);
            else this.viewport.pair();
            if (mode === this.modes.maximized) {
                targetState.internalChange = true;
                try {
                    this.setLayoutMode(targetState, this.maximizeLayoutMode);
                    targetState.pendingAction = null;
                } finally {
                    targetState.internalChange = false;
                }
            }
        }

        this.relayout(reason, {
            oldScrollOffsetX,
            newScrollOffsetX: appState.scrollOffsetX,
        });
        if (this.getActiveWindow() !== column.window) {
            this.setActiveWindow(column.window);
        }
        this.debug(`[cc-presentation] SET mode=${mode} uuid=${normalizedUuid}` +
            ` reason=${reason}`);
        this.commitRuntimeState(reason);
        return true;
    }

    restoreFromMaximize(windowUuid, reason) {
        const appState = this.getAppState();
        const normalizedUuid = this.normalizeUuid(windowUuid);
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === normalizedUuid);
        if (!column) return false;
        const previous = appState.prePresentationViewport;
        const restored = this.setMode(windowUuid, this.modes.normal, reason,
            previous || { mode: "pair" });
        appState.prePresentationViewport = null;
        return restored;
    }
}

// Generated from src/kwin/presentation/ContextualViewport.js
const ViewportMode = Object.freeze({
    PAIR: "pair",
    WIDE_FOCUS: "wide-focus",
});

const FocusSource = Object.freeze({
    DIRECTIONAL: "directional",
    POINTER: "pointer",
    DOCK: "dock",
    ALT_TAB: "alt-tab",
    PROGRAMMATIC: "programmatic",
});

function isContextualWideColumn(column) {
    // Full is a persistent strip width. Keep its Wide preference dormant so
    // focus, restore and explicit Wide commands cannot shrink it to 72%.
    return Boolean(column && column.persistentWide && column.widthMode !== "full");
}

function shouldEnterWide(column, intent) {
    return Boolean(isContextualWideColumn(column) && intent &&
        intent.source === FocusSource.DIRECTIONAL && intent.changedFocus);
}

class ContextualViewport {
    constructor(appState) {
        this.appState = appState;
        this.pendingReveal = null;
        this.pendingFocusedWide = null;
        if (!appState.viewport) this.pair();
    }

    cancelReveal() {
        this.pendingReveal = null;
        this.pendingFocusedWide = null;
    }

    pair() {
        this.cancelReveal();
        const old = this.appState.viewport;
        this.appState.viewport = { mode: ViewportMode.PAIR, wideColumnId: null };
        return Boolean(old && old.mode !== ViewportMode.PAIR);
    }

    wide(column) {
        this.cancelReveal();
        if (column && column.widthMode === "full") return this.pair();
        if (!isContextualWideColumn(column)) return false;
        const old = this.appState.viewport;
        this.appState.viewport = {
            mode: ViewportMode.WIDE_FOCUS,
            wideColumnId: column.id,
        };
        return !old || old.mode !== ViewportMode.WIDE_FOCUS ||
            old.wideColumnId !== column.id;
    }

    restore(snapshot) {
        this.cancelReveal();
        if (!snapshot || snapshot.mode !== ViewportMode.WIDE_FOCUS) {
            return this.pair();
        }
        const column = this.appState.columns.find(item =>
            item.id === snapshot.wideColumnId);
        return isContextualWideColumn(column)
            ? this.wide(column) : this.pair();
    }

    column() {
        const state = this.appState.viewport;
        if (!state || state.mode !== ViewportMode.WIDE_FOCUS) return null;
        const column = this.appState.columns.find(item =>
            item.id === state.wideColumnId) || null;
        if (!isContextualWideColumn(column)) {
            this.pair();
            return null;
        }
        return column;
    }

    select(column, intent) {
        if (!shouldEnterWide(column, intent)) {
            const changed = this.pair();
            if (isContextualWideColumn(column) && intent &&
                    intent.source !== FocusSource.DIRECTIONAL &&
                    intent.changedFocus) {
                this.pendingFocusedWide = column;
            }
            return changed;
        }
        const viewport = this.appState.viewport;
        const leavingOtherWide = viewport.mode === ViewportMode.WIDE_FOCUS &&
            viewport.wideColumnId !== column.id;
        if (intent.viewportMoved || leavingOtherWide) {
            // A hidden preference is first revealed at normal pair width.
            // Wide isolation hides neighbors even without a scroll-offset change.
            // Only another press in the same direction may expand it.
            const changed = this.pair();
            this.pendingReveal = {
                column,
                direction: intent.direction,
                scrollOffsetX: this.appState.scrollOffsetX,
            };
            return changed;
        }
        return this.wide(column);
    }

    confirmReveal(column, direction) {
        const pending = this.pendingReveal;
        this.cancelReveal();
        if (!pending || pending.column !== column ||
                pending.direction !== direction || !isContextualWideColumn(column) ||
                this.appState.columns.indexOf(column) < 0 ||
                this.appState.viewport.mode !== ViewportMode.PAIR ||
                this.appState.scrollOffsetX !== pending.scrollOffsetX) return false;
        return this.wide(column);
    }

    enterFocusedWide(column, direction) {
        if (this.pendingReveal) return this.confirmReveal(column, direction);
        const armed = this.pendingFocusedWide === column;
        this.pendingFocusedWide = null;
        if (!armed || !isContextualWideColumn(column) ||
                this.appState.columns.indexOf(column) < 0 ||
                this.appState.viewport.mode !== ViewportMode.PAIR) return false;
        const index = this.appState.columns.indexOf(column);
        const neighbor = this.appState.columns[index + direction];
        const safeRect = this.appState.safeRect;
        const offset = this.appState.scrollOffsetX;
        if (neighbor && safeRect && neighbor.logicalX >= offset &&
                neighbor.logicalX + neighbor.pixelWidth <=
                    offset + safeRect.width) return false;
        return this.wide(column);
    }
}

// Generated from src/kwin/presentation/ContextualWideCoordinator.js
class ContextualWideCoordinator {
    constructor(options) {
        this.appState = options.appState;
        this.gateway = options.gateway;
        this.projectedRectForColumn = options.projectedRectForColumn;
        this.isFullyVisible = options.isFullyVisible;
        this.sameRectNear = options.sameRectNear;
        this.presentationRect = options.presentationRect;
        this.normalizeUuid = options.normalizeUuid;
        this.relayout = options.relayout;
        this.commitParking = options.commitParking;
        this.commitHeld = options.commitHeld;
        this.departureState = options.departureState;
        this.setActiveWindow = options.setActiveWindow;
        this.setTimer = options.setTimer;
        this.clearTimer = options.clearTimer;
        this.debug = options.debug;
        this.warn = options.warn;
        this.parkGraceMs = options.parkGraceMs;
        this.retryMs = options.retryMs;
        this.maxAttempts = options.maxAttempts;
        this.lastCommittedViewport = { mode: "pair", wideColumnId: null };
        this.pendingPark = null;
        this.pendingExit = null;
        this.departures = new Set();
        this.nextParkToken = 1;
        this.nextExitToken = 1;
    }

    cancel() {
        if (!this.appState.enabled) {
            Array.from(this.departures).forEach(pending => this.retireDeparture(pending));
        }
        this.releasePark();
        this.clearPendingTimer(this.pendingExit);
        this.pendingExit = null;
    }

    cancelForWorkspace() {
        const pending = this.pendingPark;
        const state = this.appState;
        // Keep the real Pair neighbor for the departing workspace's frozen
        // Effect pose. Park only after the compositor says Slide is idle.
        // A pending geometry ACK has no parkItem and remains an actual Pair.
        if (pending && pending.parkItem &&
                this.ownsPark(pending) &&
                state.columns.includes(pending.target) &&
                state.columns.includes(pending.neighbor)) {
            this.clearPendingTimer(pending);
            this.pendingPark = null;
            pending.workspaceId = state.activeWorkspaceId;
            pending.outputName = state.targetOutput.name;
            pending.departureAttempts = 0;
            this.departures.add(pending);
            this.scheduleDeparture(pending);
        }
        this.cancel();
    }

    retireDeparture(pending) {
        this.clearPendingTimer(pending);
        if (pending.check) this.clearPendingTimer(pending.check);
        pending.check = null;
        this.departures.delete(pending);
    }

    scheduleDeparture(pending) {
        if (!this.departures.has(pending)) return;
        if (++pending.departureAttempts > 60) {
            this.retireDeparture(pending);
            this.warn("[cc-presentation] workspace parking idle check unavailable");
            return; // Hydration/recovery still settles this sleeping workspace.
        }
        pending.timer = this.setTimer(() => {
            pending.timer = null;
            this.checkDeparture(pending);
        }, this.retryMs);
    }

    checkDeparture(pending) {
        if (!this.departures.has(pending)) return;
        const disposition = this.departureState(pending);
        if (disposition === "retired") { this.retireDeparture(pending); return; }
        if (disposition === "waiting") { this.scheduleDeparture(pending); return; }
        const check = { timer: null };
        pending.check = check;
        const finish = active => {
            if (!this.departures.has(pending) || pending.check !== check) return;
            this.clearPendingTimer(check);
            pending.check = null;
            const current = this.departureState(pending);
            if (current === "retired") { this.retireDeparture(pending); return; }
            if (active !== false || current !== "sleeping") { this.scheduleDeparture(pending); return; }
            this.retireDeparture(pending);
            this.commitParking(pending.parkItem);
            this.gateway.reportMotionParked({
                type: "PAIR_TO_WIDE", transitionToken: pending.token,
                targetWindowUuid: this.normalizeUuid(pending.target.window.internalId),
            }, () => {});
        };
        check.timer = this.setTimer(() => finish(null), 1000);
        try { this.gateway.workspaceTransitionStatus(finish); }
        catch (_error) { finish(null); }
    }

    adoptRestoredViewport() {
        // Workspace hydration restores an existing presentation, rather than
        // entering Wide from this coordinator's previous workspace Pair.
        // Retaining that workspace's neighbor would expose it until a second
        // Pair-to-Wide completion, even though the restored owner is already Wide.
        this.cancel();
        this.lastCommittedViewport = Object.assign({}, this.appState.viewport);
    }

    cancelExit() {
        this.clearPendingTimer(this.pendingExit);
        this.pendingExit = null;
    }

    clearPendingTimer(pending) {
        if (pending && pending.timer) {
            this.clearTimer(pending.timer);
            pending.timer = null;
        }
    }

    releasePark() {
        const pending = this.pendingPark;
        if (!pending) return;
        this.clearPendingTimer(pending);
        this.pendingPark = null;
        this.gateway.reportMotionParked({
            type: "PAIR_TO_WIDE",
            transitionToken: pending.token,
            targetWindowUuid: this.normalizeUuid(pending.target.window.internalId),
        }, () => {});
    }

    cancelForWindow(window) {
        Array.from(this.departures).forEach(pending => {
            if (pending.target.window === window || pending.neighbor.window === window) this.retireDeparture(pending);
        });
        if (this.pendingPark &&
                (this.pendingPark.target.window === window ||
                 this.pendingPark.neighbor.window === window)) {
            this.releasePark();
        }
        if (this.pendingExit && this.pendingExit.target.window === window) {
            this.clearPendingTimer(this.pendingExit);
            this.pendingExit = null;
        }
    }

    isActivationDeferred() {
        return Boolean(this.pendingExit);
    }

    deferActivation(window) {
        if (!this.pendingExit) return false;
        this.pendingExit.activationWindow = window;
        return true;
    }

    retainedNeighbor() {
        return this.pendingPark ? this.pendingPark.neighbor : null;
    }

    parkToken() {
        return this.pendingPark ? this.pendingPark.token : null;
    }

    ownsPark(pending) {
        const state = this.appState;
        return pending.kind === "full"
            ? pending.target.widthMode === "full" && state.viewport.mode === "pair" &&
                state.presentation.mode === "normal" &&
                state.columns[state.focusedColumnIndex] === pending.target
            : state.viewport.mode === "wide-focus" &&
                state.viewport.wideColumnId === pending.target.id;
    }

    wideExitColumn() {
        const state = this.appState;
        return this.lastCommittedViewport.mode === "wide-focus" &&
            state.presentation.mode === "normal" &&
            state.viewport.mode === "pair"
            ? state.columns.find(column =>
                column.id === this.lastCommittedViewport.wideColumnId) || null
            : null;
    }

    prepareLayoutTransition(target, widthTransition) {
        const state = this.appState;
        if (this.pendingExit && (state.viewport.mode !== "pair" ||
                state.columns.indexOf(this.pendingExit.target) < 0)) {
            this.cancelExit();
        }
        if (widthTransition) {
            this.releasePark();
            if (widthTransition.column.widthMode === "full" && widthTransition.neighbor &&
                    this.isFullyVisible(widthTransition.oldRect)) {
                this.pendingPark = {
                    kind: "full", token: String(this.nextParkToken++),
                    target: widthTransition.column, neighbor: widthTransition.neighbor,
                    expected: this.projectedRectForColumn(widthTransition.column),
                    attempts: 0, scheduled: false,
                };
            }
            return;
        }
        if (this.pendingPark && this.pendingPark.kind === "full") {
            if (this.ownsPark(this.pendingPark) && state.columns.includes(this.pendingPark.target) &&
                    state.columns.includes(this.pendingPark.neighbor)) return;
            this.releasePark();
        }
        if (!target || state.viewport.mode !== "wide-focus") {
            this.releasePark();
            return;
        }
        if (this.pendingPark && this.pendingPark.target === target) return;
        if (this.lastCommittedViewport.mode !== "pair") return;
        const targetRect = this.projectedRectForColumn(target);
        const neighbor = state.columns.find(column => {
            if (column === target) return false;
            const rect = this.projectedRectForColumn(column);
            return this.isFullyVisible(rect) &&
                Math.abs(rect.y - targetRect.y) < 2 &&
                (Math.abs(rect.x - targetRect.x - targetRect.width -
                    state.innerGap) < 3 ||
                 Math.abs(rect.x + rect.width + state.innerGap -
                    targetRect.x) < 3);
        }) || null;
        if (!neighbor) return;
        this.pendingPark = {
            token: String(this.nextParkToken++), target, neighbor,
            attempts: 0, scheduled: false,
        };
        this.debug(`[cc-presentation] RETAIN_PAIR_NEIGHBOR token=${this.pendingPark.token}` +
            ` target=${target.id} neighbor=${neighbor.id}`);
    }

    preparePartialExit(plan) {
        if (!plan.viewportMotion || plan.viewportMotion.type !== "WIDE_TO_PAIR" ||
                !plan.windows.some(item => item.partial)) return null;
        const target = plan.windows.find(item => item.columnId === plan.viewportMotion.targetColumnId);
        this.pendingExit = { token: String(this.nextExitToken++), target: target.column,
            expected: target.rect, attempts: 0, waitAttempts: 0, requireMotionComplete: true };
        return this.pendingExit.token;
    }

    onPlanCommitted(plan, wideExitColumn, commitResult, activationWindow, options = {}) {
        const state = this.appState;
        if (this.pendingExit && this.pendingExit.requireMotionComplete &&
                options.nativeScroll && options.legacyMotion && commitResult.heldIncoming.length) {
            this.pendingExit.heldPlan = plan;
        }
        if (this.pendingPark && plan.viewportMotion &&
                plan.viewportMotion.type === "PAIR_TO_WIDE" && plan.layoutSnapshots) {
            const neighbor = this.pendingPark.neighbor;
            const entry = plan.layoutSnapshots.to.entries.find(item =>
                item.columnId === neighbor.id && item.placement === "isolated-hidden");
            const item = plan.windows.find(item => item.column === neighbor);
            if (entry && item) this.pendingPark.parkItem = Object.assign({}, item, {
                placement: "parked", rect: Object.assign({}, entry.realRect),
            });
        }
        if (wideExitColumn && commitResult.heldIncoming.length &&
                !(this.pendingExit && this.pendingExit.requireMotionComplete)) {
            this.clearPendingTimer(this.pendingExit);
            this.pendingExit = {
                token: String(this.nextExitToken++), target: wideExitColumn,
                expected: plan.windows.find(item =>
                    item.column === wideExitColumn).rect,
                attempts: 0, activationWindow,
            };
        }
        this.lastCommittedViewport = Object.assign({}, state.viewport);
        if (this.pendingExit && this.pendingExit.attempts === 0) {
            this.requestExit(this.pendingExit);
        }
        if (this.pendingPark && !this.pendingPark.scheduled) {
            this.pendingPark.scheduled = true;
            this.requestPark(this.pendingPark, this.retryMs);
        }
        if (activationWindow && !this.pendingExit) {
            this.setActiveWindow(activationWindow);
        }
    }

    requestPark(pending, delayMs) {
        this.clearPendingTimer(pending);
        const command = {
            commandId: `${this.gateway.sessionId()}-contextual-wide-${pending.token}-` +
                `${pending.attempts++}`,
            type: "finalize-contextual-wide",
            transitionToken: pending.token,
            windowUuid: this.normalizeUuid(pending.target.window.internalId),
        };
        pending.commandId = command.commandId;
        pending.timer = this.setTimer(() => {
            if (this.pendingPark === pending &&
                    pending.commandId === command.commandId) {
                this.finalizePark(command);
            }
        }, delayMs + 150);
        this.gateway.requestDeferred(command, delayMs, accepted => {
            if (!accepted) this.finalizePark(command);
        });
    }

    finalizePark(command) {
        const pending = this.pendingPark;
        const state = this.appState;
        if (!pending || pending.token !== String(command.transitionToken) ||
                (!command.motionCompleted &&
                 pending.commandId !== command.commandId) ||
                !this.ownsPark(pending) ||
                state.columns.indexOf(pending.target) < 0) return false;
        this.clearPendingTimer(pending);
        if (command.motionCompleted) pending.motionCompleted = true;
        if (!this.sameRectNear(pending.target.window.frameGeometry,
                pending.expected || this.presentationRect()) && pending.attempts <= this.maxAttempts) {
            this.requestPark(pending, this.retryMs);
            return true;
        }
        if (!pending.geometryAcknowledged) {
            pending.geometryAcknowledged = true;
            if (!pending.motionCompleted) {
                this.requestPark(pending, this.parkGraceMs);
                return true;
            }
        }
        this.pendingPark = null;
        const offset = state.scrollOffsetX;
        this.relayout("contextual-wide-park", {
            oldScrollOffsetX: offset, newScrollOffsetX: offset,
        });
        this.gateway.reportMotionParked({
            type: "PAIR_TO_WIDE",
            transitionToken: pending.token,
            targetWindowUuid: this.normalizeUuid(pending.target.window.internalId),
        }, accepted => {
            if (!accepted) this.warn("[cc-presentation] motion-park repaint rejected");
        });
        return true;
    }

    requestExit(pending, delayMs = this.retryMs) {
        this.clearPendingTimer(pending);
        const command = {
            commandId: `${this.gateway.sessionId()}-contextual-wide-exit-` +
                `${pending.token}-${pending.attempts++}`,
            type: "finalize-contextual-wide-exit",
            transitionToken: pending.token,
            windowUuid: this.normalizeUuid(pending.target.window.internalId),
        };
        pending.commandId = command.commandId;
        pending.timer = this.setTimer(() => {
            if (this.pendingExit === pending &&
                    pending.commandId === command.commandId) {
                this.finalizeExit(command);
            }
        }, delayMs + 150);
        this.gateway.requestDeferred(command, delayMs, accepted => {
            if (!accepted) this.finalizeExit(command);
        });
    }

    finalizeExit(command) {
        const pending = this.pendingExit;
        if (!pending || pending.token !== String(command.transitionToken) ||
                (!command.motionCompleted && pending.commandId !== command.commandId)) return false;
        this.clearPendingTimer(pending);
        if (command.motionCompleted) pending.motionCompleted = true;
        if (pending.requireMotionComplete && !pending.motionCompleted && pending.waitAttempts++ < 120) {
            this.requestExit(pending); return true;
        }
        if (!this.sameRectNear(pending.target.window.frameGeometry,
                pending.expected) && pending.attempts <= this.maxAttempts) {
            this.requestExit(pending);
            return true;
        }
        this.pendingExit = null;
        const state = this.appState;
        const offset = state.scrollOffsetX;
        this.relayout("contextual-wide-exit-ack", {
            oldScrollOffsetX: offset, newScrollOffsetX: offset,
        });
        const focused = state.columns[state.focusedColumnIndex];
        if (pending.activationWindow && focused &&
                focused.window === pending.activationWindow) {
            this.setActiveWindow(pending.activationWindow);
        }
        return true;
    }

    onTargetGeometryChanged(window) {
        const pending = this.pendingExit;
        if (!pending || pending.target.window !== window ||
                !this.sameRectNear(window.frameGeometry, pending.expected)) return false;
        if (pending.heldPlan && this.commitHeld) {
            const plan = pending.heldPlan;
            pending.heldPlan = null;
            this.commitHeld(plan);
        }
        this.requestExit(pending, 1);
        return true;
    }
}

// Generated from src/kwin/navigation/DockScrollController.js
class DockScrollController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.clampScrollOffset = options.clampScrollOffset;
        this.stripWidth = options.stripWidth;
        this.isFullyVisible = options.isFullyVisible;
        this.projectedRectForColumn = options.projectedRectForColumn;
        this.requestDeferred = options.requestDeferred;
        this.getSessionId = options.getSessionId;
        this.stepMs = options.stepMs;
        this.clearPresentation = options.clearPresentation;
        this.normalPresentationMode = options.normalPresentationMode;
        this.commitRuntimeState = options.commitRuntimeState;
        this.publishRuntimeState = options.publishRuntimeState;
        this.focusIndex = options.focusIndex;
        this.transitionFocused = options.transitionFocused;
        this.setActiveWindow = options.setActiveWindow;
        this.isActivationDeferred = options.isActivationDeferred || (() => false);
        this.relayout = options.relayout;
        this.debug = options.debug;
        this.pendingScroll = null;
        this.nextToken = 1;
    }

    pending() {
        return this.pendingScroll;
    }

    hasPending() {
        return Boolean(this.pendingScroll);
    }

    cancel(reason) {
        if (!this.pendingScroll) return false;
        this.debug(`[cc-dock] SCROLL_CANCEL token=${this.pendingScroll.token}` +
            ` reason=${reason}`);
        this.pendingScroll = null;
        return true;
    }

    boundedOffset(offset) {
        const appState = this.getAppState();
        const viewportWidth = appState.safeRect ? appState.safeRect.width : 0;
        const maximum = Math.max(0, this.stripWidth() - viewportWidth);
        return Math.max(0, Math.min(Number(offset) || 0, maximum));
    }

    offsetsToTarget(column) {
        const appState = this.getAppState();
        if (!column || !appState.safeRect) return [];
        this.recomputeLogicalLayout();
        this.clampScrollOffset();
        if (this.isFullyVisible(this.projectedRectForColumn(column))) return [];

        const currentOffset = appState.scrollOffsetX;
        const targetOffset = this.boundedOffset(
            column.logicalX + column.pixelWidth - appState.safeRect.width
        );
        if (targetOffset === currentOffset) return [];

        const direction = targetOffset > currentOffset ? 1 : -1;
        const offsets = [];
        const seen = new Set();
        appState.columns.forEach(item => {
            const offset = this.boundedOffset(
                item.logicalX + item.pixelWidth - appState.safeRect.width
            );
            const between = direction > 0
                ? offset > currentOffset && offset <= targetOffset
                : offset < currentOffset && offset >= targetOffset;
            if (!between || seen.has(offset)) return;
            seen.add(offset);
            offsets.push(offset);
        });
        if (!seen.has(targetOffset)) offsets.push(targetOffset);
        offsets.sort((left, right) =>
            direction > 0 ? left - right : right - left);
        return offsets;
    }

    requestStep(pending) {
        const command = {
            commandId: `${this.getSessionId()}-dock-scroll-${pending.token}-` +
                `${pending.deferredSequence++}`,
            type: "advance-dock-scroll",
            transitionToken: pending.token,
            windowUuid: pending.windowUuid,
        };
        this.requestDeferred(command, this.stepMs, accepted => {
            if (accepted) return;
            this.debug(`[cc-dock] SCROLL_DEFER_FALLBACK token=${pending.token}`);
            this.advance(command);
        });
    }

    finish(pending, column) {
        const appState = this.getAppState();
        if (!pending || this.pendingScroll !== pending || !column) return false;
        const index = appState.columns.indexOf(column);
        if (index < 0 || column.window.output !== appState.targetOutput) {
            this.cancel("finish-target-missing");
            return false;
        }

        this.pendingScroll = null;
        const offset = appState.scrollOffsetX;
        this.focusIndex(index);
        const presentationChanged = this.transitionFocused(
            column,
            `${pending.reason}-arrive`,
            offset,
            offset,
            0,
            true
        );
        if (!this.isActivationDeferred() && column.window.minimized) {
            column.window.minimized = false;
        }
        this.setActiveWindow(column.window);
        this.debug(`[cc-dock] SCROLL_COMPLETE token=${pending.token}` +
            ` index=${index} offset=${offset} caption=${column.window.caption}`);
        if (presentationChanged) {
            this.commitRuntimeState(`${pending.reason}-presentation`);
        } else {
            this.publishRuntimeState(pending.reason);
        }
        return true;
    }

    advance(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingScroll;
        if (!pending || token !== pending.token ||
                this.normalizeUuid(command.windowUuid) !== pending.windowUuid) {
            return false;
        }
        const appState = this.getAppState();
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === pending.windowUuid);
        if (!column || column.window.output !== appState.targetOutput) {
            this.cancel("advance-target-missing");
            return false;
        }
        if (!pending.offsets.length) return this.finish(pending, column);

        const oldScrollOffsetX = appState.scrollOffsetX;
        appState.scrollOffsetX = pending.offsets.shift();
        this.clampScrollOffset();
        const newScrollOffsetX = appState.scrollOffsetX;
        this.relayout(`${pending.reason}-step`, {
            oldScrollOffsetX,
            newScrollOffsetX,
        });
        this.debug(`[cc-dock] SCROLL_STEP token=${pending.token}` +
            ` old=${oldScrollOffsetX} new=${newScrollOffsetX}` +
            ` remaining=${pending.offsets.length}`);
        if (pending.offsets.length) this.requestStep(pending);
        else this.finish(pending, column);
        return true;
    }

    begin(column, reason) {
        const appState = this.getAppState();
        if (!column || !appState.safeRect) return false;
        this.cancel("superseded-by-dock-click");
        const offsets = this.offsetsToTarget(column);

        if (appState.presentation.mode !== this.normalPresentationMode ||
                (appState.viewport && appState.viewport.mode !== "pair")) {
            this.clearPresentation();
            this.commitRuntimeState(`${reason}-clear-presentation`);
        }

        const pending = {
            token: String(this.nextToken++),
            windowUuid: this.normalizeUuid(column.window.internalId),
            reason,
            offsets,
            deferredSequence: 1,
        };
        this.pendingScroll = pending;
        this.debug(`[cc-dock] SCROLL_BEGIN token=${pending.token}` +
            ` target=${pending.windowUuid}` +
            ` steps=${offsets.join(",") || "focus-only"}`);
        if (!offsets.length) return this.finish(pending, column);
        return this.advance({
            transitionToken: pending.token,
            windowUuid: pending.windowUuid,
        });
    }
}

// Generated from src/kwin/navigation/ReorderController.js
class ReorderController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.rejectRuntimeCommand = options.rejectRuntimeCommand;
        this.cancelDockScroll = options.cancelDockScroll;
        this.getFocusedColumn = options.getFocusedColumn;
        this.reorderColumns = options.reorderColumns;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.ensureColumnVisible = options.ensureColumnVisible;
        this.relayout = options.relayout;
        this.getGeneration = options.getGeneration;
        this.commitRuntimeState = options.commitRuntimeState;
        this.getActiveWindow = options.getActiveWindow;
        this.indexOfWindow = options.indexOfWindow;
        this.focusIndex = options.focusIndex;
        this.focusedIndex = options.focusedIndex;
        this.moveFocusedColumn = options.moveFocusedColumn;
        this.debug = options.debug;
    }

    applyRuntimeCommand(command) {
        if (!Array.isArray(command.order)) {
            this.rejectRuntimeCommand("invalid-column-order");
            return false;
        }
        const appState = this.getAppState();
        const requested = command.order.map(value => this.normalizeUuid(value));
        const current = appState.columns.map(column =>
            this.normalizeUuid(column.window.internalId));
        const requestedSet = new Set(requested);
        const currentSet = new Set(current);
        if (requested.length !== current.length ||
                requestedSet.size !== requested.length ||
                requested.some(uuid => !uuid || !currentSet.has(uuid))) {
            this.rejectRuntimeCommand("invalid-column-set");
            return false;
        }

        const columnsByUuid = new Map(appState.columns.map(column => [
            this.normalizeUuid(column.window.internalId),
            column,
        ]));
        this.cancelDockScroll("dock-reorder");
        const focusedColumn = this.getFocusedColumn();
        const oldScrollOffsetX = appState.scrollOffsetX;
        this.reorderColumns(requested.map(uuid => columnsByUuid.get(uuid)));
        this.recomputeLogicalLayout();
        if (focusedColumn) this.ensureColumnVisible(focusedColumn);
        const newScrollOffsetX = appState.scrollOffsetX;
        this.relayout("dock-reorder", {
            oldScrollOffsetX,
            newScrollOffsetX,
        });
        this.debug(`[cc-dock] APPLY command=${command.commandId}` +
            ` generation=${this.getGeneration()} columns=${requested.length}`);
        this.commitRuntimeState("dock-reorder");
        return true;
    }

    moveFocused(delta) {
        const appState = this.getAppState();
        const columns = appState.columns;
        if (!appState.enabled || columns.length < 2) return false;
        const reason = delta < 0 ? "move-column-left" : "move-column-right";
        this.cancelDockScroll(reason);
        const activeIndex = this.indexOfWindow(this.getActiveWindow());
        if (activeIndex >= 0) this.focusIndex(activeIndex);
        const oldIndex = this.focusedIndex();
        if (oldIndex < 0 || oldIndex >= columns.length) return false;
        const nextIndex = Math.max(0, Math.min(
            columns.length - 1,
            oldIndex + delta
        ));
        if (nextIndex === oldIndex) return false;

        const movement = this.moveFocusedColumn(delta);
        if (!movement) return false;
        const focusedColumn = movement.column;
        this.recomputeLogicalLayout();
        this.ensureColumnVisible(focusedColumn);
        this.relayout(reason);
        this.debug(`[cc-scroll] MOVE column=${focusedColumn.id}` +
            ` from=${oldIndex} to=${nextIndex}`);
        this.commitRuntimeState(reason);
        return true;
    }
}
/* END GENERATED KWIN MODULES */

// Generated from src/kwin/runtime/RuntimeEntry.js
// Runtime composition. Generated into package/contents/code/main.js by tools/build.js.
const TAG = "[cc-niri-maximize]";
const FULL_MAXIMIZE_MODE = 3;
const NORMAL_MODE = "normal";
const MAXIMIZE_MODE = "maximize";
const PRESENTATION_NORMAL = "normal";
const PRESENTATION_WIDE = "wide";
const PRESENTATION_MAXIMIZED = "maximized";
const WIDE_RATIO = 0.72;
const COLUMN_WIDTH_THIRD = "third";
const COLUMN_WIDTH_HALF = "half";
const COLUMN_WIDTH_TWO_THIRDS = "twoThirds";
const PARKING_MARGIN = 4096;
const FLOATING_FOCUS_GUARD_MS = 1200;
/* Park only after target geometry ACK and a conservative paint-motion grace.
 * The Effect owns the visual fade; this timer only releases real geometry. */
const CONTEXTUAL_WIDE_PARK_GRACE_MS = 500;
const WIDE_GEOMETRY_RETRY_MS = 50;
const WIDE_GEOMETRY_MAX_ATTEMPTS = 20;
const DOCK_SCROLL_STEP_MS = 140;
const ADOPTION_UNTRACKED = "untracked";
const ADOPTION_WAITING_ACTIVATION = "waiting-activation";
const ADOPTION_WAITING_PRIMARY = "waiting-primary";
const ADOPTION_WAITING_WORKSPACE = "waiting-workspace";
const ADOPTION_WAITING_ELIGIBLE = "waiting-eligible";
const ADOPTION_WAITING_NORMAL = "waiting-normal";
const ADOPTION_ADOPTING = "adopting";
const ADOPTION_SETTLING = "settling";
const ADOPTION_MANAGED = "managed";
const ADOPTION_FLOATING = "floating";
const ADOPTION_POLICY_FLOATING = "policy-floating";
const ADOPTION_IGNORED = "ignored";
const RUNTIME_BRIDGE_SERVICE = "org.cc.CCNiriBridge";
const RUNTIME_BRIDGE_PATH = "/CCNiriBridge";
const RUNTIME_BRIDGE_INTERFACE = "org.cc.CCNiriBridge1";

const mainScreenState = {
    activeWorkspaceId: null,
    workspaceSwitching: false,
    targetOutput: null,
    safeRect: null,
    columns: [],
    focusedColumnIndex: -1,
    scrollOffsetX: 0,
    innerGap: 8,
    enabled: true,
    nextColumnId: 1,
    presentation: {
        windowUuid: null,
        mode: PRESENTATION_NORMAL,
    },
};
const contextualViewport = new ContextualViewport(mainScreenState);
let focusRingController;
let continuousLayout;
const runtimeConfig = loadRuntimeConfig(readConfig);
const columnStore = new ColumnStore(mainScreenState, () => {
    if (focusRingController) focusRingController.membershipChanged();
}, { scrollLayoutV2Enabled: runtimeConfig.scrollLayoutV2Enabled });
const states = new WindowStateStore(createWindowState);
const windowPolicy = new WindowPolicy();
const virtualDesktopTopology = new VirtualDesktopTopology({
    getDesktops: () => workspace.desktops,
    getCurrentDesktop: output => output &&
        typeof workspace.currentDesktopForScreen === "function"
        ? workspace.currentDesktopForScreen(output) : workspace.currentDesktop,
});
const workspaceMembership = new WorkspaceMembership({
    getCurrentDesktop: output => virtualDesktopTopology.current(output),
});
const workspaceOccupancy = new WorkspaceOccupancy({ membership: workspaceMembership });
const workspaceSnapshots = new WorkspaceSnapshotStore();
const workspacePersistence = new WorkspacePersistence({
    snapshots: workspaceSnapshots,
    hasDesktop: id => Boolean(virtualDesktopTopology.byId(id)),
});
let workspaceMountController;
const layoutEligibility = new LayoutEligibility({
    windowPolicy,
    membership: workspaceMembership,
    isEnabled: () => mainScreenState.enabled &&
        (!workspaceMountController || !workspaceMountController.stopped),
    getPrimaryOutput: resolveTargetOutput,
    isPrimaryReady: () => Boolean(workspaceMountController &&
        workspaceMountController.canUseActiveWorkspace()),
});
let workspaceSwitchController;
let workspaceTransferController;
let workspaceMoveController;
let dynamicWorkspaceController;
let workspaceRecycleController;
const runtimeLogger = new RuntimeLogger({
    tag: TAG,
    enabled: runtimeConfig.debugLogging,
    infoSink: message => console.info(message),
    warnSink: message => console.warn(message),
});
const outputTopology = new OutputTopology({
    getScreens: () => workspace.screens,
    getWindows: () => workspace.windowList(),
    config: runtimeConfig,
    computeSafeRect,
    getWorkingArea: (output, desktop) => workspace.clientArea(KWin.MaximizeArea,
        output, desktop || virtualDesktopTopology.current(output)),
    warn,
});
const innerGap = runtimeConfig.primary.inner;
let contextualWideCoordinator;
const runtimeBridge = new RuntimeBridge({
    snapshotProtocol: 2,
    invoke: callDBus,
    service: RUNTIME_BRIDGE_SERVICE,
    path: RUNTIME_BRIDGE_PATH,
    interfaceName: RUNTIME_BRIDGE_INTERFACE,
    snapshotProvider: createRuntimeSnapshot,
    handlers: Object.assign({
        "emergency-restore": command => emergencyRestoreAllWindows("bridge-unload", command.commandId),
        "finalize-contextual-wide": command =>
            runWorkspaceAction(() => contextualWideCoordinator.finalizePark(command)),
        "finalize-contextual-wide-exit": command =>
            runWorkspaceAction(() => contextualWideCoordinator.finalizeExit(command)),
    }, runtimeConfig.dockIntegration ? {
        // Persistence, animation completion and recovery stay available without
        // a Dock. Only UI-originated commands are part of the optional integration.
        "advance-dock-scroll": command => runWorkspaceAction(() => advancePendingDockScroll(command)),
        "set-presentation-mode": command => runWorkspaceAction(() => handleDockPresentationCommand(command)),
        "focus-column-right": command => runWorkspaceAction(() => handleDockFocusCommand(command)),
        "set-column-order": command => runWorkspaceAction(() => handleDockReorderCommand(command)),
    } : {}),
    generationAgnosticTypes: [
        "finalize-contextual-wide",
        "finalize-contextual-wide-exit",
    ],
    debug,
    warn,
    now: () => Date.now(),
    random: () => Math.random(),
});
const startupLayout = new StartupLayout({
    normalizeUuid: normalizeWindowUuid,
    targetOutput: () => mainScreenState.targetOutput
        ? mainScreenState.targetOutput.name : "",
});
contextualWideCoordinator = new ContextualWideCoordinator({
    appState: mainScreenState,
    gateway: runtimeBridge,
    projectedRectForColumn,
    isFullyVisible: isFullyVisibleInSafeRect,
    sameRectNear,
    presentationRect,
    normalizeUuid: normalizeWindowUuid,
    relayout,
    commitParking: item => geometryCommitter.commit({
        reason: "workspace-wide-settle", windows: [item], commitOrder: [item],
    }),
    commitHeld: plan => commitLayoutPlan(plan, plan.wideExitColumn, null,
        { nativeScroll: true, legacyMotion: true }),
    departureState: pending => {
        if (!mainScreenState.enabled) return "retired";
        const windows = workspace.windowList();
        for (const column of [pending.target, pending.neighbor]) {
            const window = column.window;
            if (!windows.includes(window)) return "retired";
            const state = states.get(window);
            if (!state || state.floating || window.fullScreen || isTileMode(state.layoutMode) ||
                    !windowPolicy.canJoinColumn(window) ||
                    !workspaceMembership.belongsTo(window, pending.workspaceId) ||
                    !window.output || window.output.name !== pending.outputName) return "retired";
        }
        if (mainScreenState.workspaceSwitching) return "waiting";
        return mainScreenState.activeWorkspaceId === pending.workspaceId ? "retired" : "sleeping";
    },
    setActiveWindow: window => { workspace.activeWindow = window; },
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    debug,
    warn,
    parkGraceMs: CONTEXTUAL_WIDE_PARK_GRACE_MS,
    retryMs: WIDE_GEOMETRY_RETRY_MS,
    maxAttempts: WIDE_GEOMETRY_MAX_ATTEMPTS,
});
let connectedManagedOutputs = new Set();
let scrollLayoutInitialized = false;
const parkingManager = new ParkingManager({
    trackUserMinimized: runtimeConfig.scrollLayoutV2Enabled,
    stateFor,
    getState: window => states.get(window),
    refreshSafeArea: refreshMainScreenState,
    getSafeRect: () => mainScreenState.safeRect,
    debug,
});
const geometryCommitter = new GeometryCommitter({
    stateFor,
    sameRect,
    sameRectNear,
    rectCopy,
    rectText,
    isTileMode,
    isRectInsideAnyOutput,
    setWindowVisibility: (window, visible) =>
        parkingManager.setVisibility(window, visible),
    isWindowHidden: window => parkingManager.isHidden(window),
    rememberVisibleGeometry: (window, rect) =>
        parkingManager.rememberVisibleGeometry(window, rect),
    debug,
    warn,
});
const invariantChecker = new InvariantChecker({
    appState: mainScreenState,
    alwaysCenterSingleColumn: runtimeConfig.alwaysCenterSingleColumn,
    getV2Geometry: () => runtimeConfig.scrollLayoutV2Enabled ? v2Geometry() : null,
    workspaceMembership,
    windowStates: states,
    workspaceSnapshots,
    normalizeUuid: normalizeWindowUuid,
    stripWidth,
    managedPhases: [ADOPTION_MANAGED, ADOPTION_SETTLING],
    normalPresentationMode: PRESENTATION_NORMAL,
    debug,
    warn,
});
let stabilitySupervisor;
const layoutTransaction = new LayoutTransaction({
    audit: (reason, epoch) => stabilitySupervisor.audit(reason, epoch),
    debug,
});
const motionPlanCommitGate = new MotionPlanCommitGate({
    publish: (envelope, callback) =>
        runtimeBridge.publishMotionPlan(envelope, callback),
    currentEpoch: () => layoutTransaction.currentEpoch(),
    commit: (plan, context, activationWindow) => {
        // Native now has the legacy viewport marker (or fallback will park
        // partial surfaces). Transfer its clip before installing new geometry.
        scrollPlanCommitGate.cancel();
        if (!context.motionFallback) {
            const envelope = createWidthViewportClipPlan(plan, {
                workspaceId: mainScreenState.activeWorkspaceId,
                targetOutput: mainScreenState.targetOutput.name,
                issuedAt: Date.now(), normalizeUuid: normalizeWindowUuid,
            });
            if (envelope) {
                // Arm paint/input clipping before exposing a Full neighbor.
                // Its translation still shares the existing width timeline.
                scrollPlanCommitGate.whenIdle(() => {
                    if (layoutTransaction.currentEpoch() !== plan.epoch) return;
                    scrollPlanCommitGate.schedule(plan, envelope,
                        { wideExitColumn: context.wideExitColumn, legacyMotion: true });
                    if (activationWindow) activateColumnWhenReady(activationWindow);
                });
                return;
            }
        }
        commitLayoutPlan(plan, context.wideExitColumn, activationWindow);
    },
    warn,
    timeoutMs: 150,
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
});

const scrollPlanCommitGate = new ScrollPlanCommitGate({
    prepare: (context, callback) => {
        if (!context.membershipReason) { callback(true); return; }
        if (!commitRuntimeState(context.membershipReason, callback)) callback(false);
    },
    publish: (envelope, callback) => runtimeBridge.publishMotionPlan(envelope, callback),
    arm: (envelope, callback) => runtimeBridge.armScrollPlan(envelope, callback),
    disarm: (epoch, callback) => runtimeBridge.disarmScrollPlan(epoch, callback),
    cancelDeferred: () => deferredScrollParking.cancel(),
    releaseDeferred: () => deferredScrollParking.release(),
    currentEpoch: () => layoutTransaction.currentEpoch(),
    commit: (plan, context, activationWindow) =>
        commitLayoutPlan(plan, context.wideExitColumn, activationWindow,
            { nativeScroll: context.nativeScroll, legacyMotion: context.legacyMotion }),
    timeoutMs: 150,
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    warn,
});

const deferredScrollParking = new DeferredScrollParking({
    stateFor,
    getState: window => states.get(window),
    isCurrent: column => mainScreenState.enabled && mainScreenState.columns.includes(column),
    context: () => ({ sessionId: runtimeBridge.sessionId(), workspaceId: mainScreenState.activeWorkspaceId,
        targetOutput: mainScreenState.targetOutput ? mainScreenState.targetOutput.name : "" }),
    status: callback => runtimeBridge.scrollMotionStatus(callback),
    disarm: (epoch, callback) => runtimeBridge.disarmScrollPlan(epoch, callback),
    finalize: item => {
        geometryCommitter.commitGeometry(item.column, item.rect, "scroll-finalize");
        parkingManager.setVisibility(item.column.window, false);
    },
    setTimer: setRuntimeTimer, clearTimer: clearRuntimeTimer, warn,
});

function setRuntimeTimer(callback, delayMs) {
    const timer = new QTimer();
    timer.singleShot = true;
    timer.timeout.connect(callback);
    timer.start(delayMs);
    return { timer, callback };
}

function clearRuntimeTimer(handle) {
    handle.timer.stop();
    handle.timer.timeout.disconnect(handle.callback);
}
const recoveryCompletion = new RecoveryCompletionGate({
    getWindows: () => workspace.windowList(), sameRect,
    setTimer: setRuntimeTimer, clearTimer: clearRuntimeTimer,
});
const recovery = new Recovery({
    appState: mainScreenState,
    windowStates: states,
    parking: parkingManager,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    waitForRestored: runtimeConfig.scrollLayoutV2Enabled ? (rows, done) => recoveryCompletion.wait(rows, done) : null,
    onStatus: runtimeConfig.scrollLayoutV2Enabled ? status => runtimeBridge.reportRecoveryStatus(status) : null,
    retire: runtimeConfig.scrollLayoutV2Enabled ? done => {
        mainScreenState.enabled = false;
        continuousLayout.stop(done);
    } : null,
    beforeRestore: reason => {
        if (workspaceMoveController) workspaceMoveController.stop();
        if (workspaceSwitchController) workspaceSwitchController.stop();
        if (workspaceTransferController) workspaceTransferController.stop();
        if (dynamicWorkspaceController) dynamicWorkspaceController.stop();
        if (workspaceRecycleController) workspaceRecycleController.stop();
        if (workspaceMountController) workspaceMountController.stop();
        mainScreenState.enabled = false;
        connectedManagedOutputs.clear();
        motionPlanCommitGate.cancel();
        scrollPlanCommitGate.cancel();
        contextualWideCoordinator.cancel();
        cancelPendingDockScroll(reason);
    },
    debug,
    warn,
});
stabilitySupervisor = new StabilitySupervisor({
    checker: invariantChecker,
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    relayout,
    recovery,
    disableLayout: () => { mainScreenState.enabled = false; },
    isEnabled: () => mainScreenState.enabled,
    warn,
    debug,
});
const adoptionController = new AdoptionController({
    phases: {
        untracked: ADOPTION_UNTRACKED,
        waitingActivation: ADOPTION_WAITING_ACTIVATION,
        waitingPrimary: ADOPTION_WAITING_PRIMARY,
        waitingWorkspace: ADOPTION_WAITING_WORKSPACE,
        waitingEligible: ADOPTION_WAITING_ELIGIBLE,
        waitingNormal: ADOPTION_WAITING_NORMAL,
        adopting: ADOPTION_ADOPTING,
        settling: ADOPTION_SETTLING,
        managed: ADOPTION_MANAGED,
        floating: ADOPTION_FLOATING,
        policyFloating: ADOPTION_POLICY_FLOATING,
        ignored: ADOPTION_IGNORED,
    },
    stateFor,
    hasState: window => states.has(window),
    indexOfWindow: window => columnStore.indexOfWindow(window),
    getAppState: () => mainScreenState,
    refreshAppState: refreshMainScreenState,
    windowPolicy,
    workspaceMembership,
    workspaceReady: () => workspaceMountController && workspaceMountController.canUseActiveWorkspace() &&
        (!workspaceTransferController || !workspaceTransferController.isProcessing()),
    dispositions: WindowDisposition,
    removeManagedWindow: removeColumn,
    isLayoutMode,
    isTileMode,
    detectQuickTileMode,
    fullMaximizeMode: FULL_MAXIMIZE_MODE,
    adoptWindow: adoptNewWindowAsColumn,
    settleLayout: settleAdoptionGeometry,
    rectText,
    debug,
});
const floatingController = new FloatingController({
    workspaceMembership,
    stateFor,
    hasState: window => states.has(window),
    indexOfWindow: window => columnStore.indexOfWindow(window),
    getAppState: () => mainScreenState,
    refreshAppState: refreshMainScreenState,
    windowPolicy,
    dispositions: WindowDisposition,
    prepareWindow: prepareInitialColumn,
    adoptWindow: adoptNewWindowAsColumn,
    removeColumn,
    transitionAdoption: (window, windowState, phase, reason) =>
        adoptionController.transition(window, windowState, phase, reason),
    floatingPhase: ADOPTION_FLOATING,
    settlingPhase: ADOPTION_SETTLING,
    managedPhase: ADOPTION_MANAGED,
    getActiveWindow: () => workspace.activeWindow,
    setActiveWindow: window => {
        activateColumnWhenReady(window);
    },
    rectText,
    debug,
    warn,
    now: () => Date.now(),
    focusGuardMs: FLOATING_FOCUS_GUARD_MS,
});
const outputController = new OutputController({
    stateFor,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    resolvePrimaryOutput: resolveTargetOutput,
    clearPresentationForWindow: window => {
        if (mainScreenState.presentation.windowUuid ===
                normalizeWindowUuid(window.internalId)) {
            clearPresentationState();
        }
    },
    removeColumn,
    transitionAdoption: (window, windowState, phase, reason) =>
        adoptionController.transition(window, windowState, phase, reason),
    phases: {
        untracked: ADOPTION_UNTRACKED,
        waitingPrimary: ADOPTION_WAITING_PRIMARY,
        floating: ADOPTION_FLOATING,
        policyFloating: ADOPTION_POLICY_FLOATING,
        ignored: ADOPTION_IGNORED,
    },
    profileForOutput,
    translateRestoreGeometry,
    fullMaximizeMode: FULL_MAXIMIZE_MODE,
    maximizeMode: MAXIMIZE_MODE,
    applyLayoutGeometry,
    detectQuickTileMode,
    isTileMode,
    applyDetectedTile,
    beginAdoption: beginWindowAdoption,
    advanceAdoption: advanceWindowAdoption,
    setLayoutMode,
    rectText,
    debug,
});
const fullscreenController = new FullscreenController({
    viewport: contextualViewport,
    stateFor,
    getAppState: () => mainScreenState,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    relayout,
    onManagedOutput,
    isLayoutMode,
    applyLayoutGeometry,
    advanceAdoption: (window, reason) =>
        adoptionController.onFullscreenChanged(window, reason),
    normalMode: NORMAL_MODE,
    debug,
});
const presentationController = new PresentationController({
    getAppState: () => mainScreenState,
    viewport: contextualViewport,
    normalizeUuid: normalizeWindowUuid,
    stateFor,
    setLayoutMode,
    modes: {
        normal: PRESENTATION_NORMAL,
        wide: PRESENTATION_WIDE,
        maximized: PRESENTATION_MAXIMIZED,
    },
    normalLayoutMode: NORMAL_MODE,
    maximizeLayoutMode: MAXIMIZE_MODE,
    wideRatio: WIDE_RATIO,
    rectCopy,
    cancelPendingDockScroll,
    focusColumn: column => columnStore.focusColumn(column),
    recomputeLogicalLayout,
    ensureColumnVisible,
    relayout,
    getActiveWindow: () => workspace.activeWindow,
    setActiveWindow: activateColumnWhenReady,
    commitRuntimeState,
    debug,
});
const dockScrollController = runtimeConfig.dockIntegration ? new DockScrollController({
    getAppState: () => mainScreenState,
    normalizeUuid: normalizeWindowUuid,
    recomputeLogicalLayout,
    clampScrollOffset,
    stripWidth,
    isFullyVisible: isFullyVisibleInSafeRect,
    projectedRectForColumn,
    requestDeferred: (command, delayMs, callback) =>
        runtimeBridge.requestDeferred(command, delayMs, callback),
    getSessionId: () => runtimeBridge.sessionId(),
    stepMs: DOCK_SCROLL_STEP_MS,
    clearPresentation: clearPresentationState,
    normalPresentationMode: PRESENTATION_NORMAL,
    commitRuntimeState,
    publishRuntimeState,
    focusIndex: index => columnStore.focusIndex(index),
    transitionFocused: relayoutFocusedColumnTransition,
    isActivationDeferred: () => contextualWideCoordinator.isActivationDeferred(),
    setActiveWindow: window => {
        activateColumnWhenReady(window);
    },
    relayout,
    debug,
}) : null;
const columnWidthController = new ColumnWidthController({
    scrollLayoutV2Enabled: runtimeConfig.scrollLayoutV2Enabled,
    applyV2Width: (column, mode, reason) => continuousLayout.ready() &&
        continuousLayout.controller.setWidth(column, mode, reason),
    getAppState: () => mainScreenState,
    getActiveWindow: () => workspace.activeWindow,
    captureLayout: column => captureColumnWidthTransition(column,
        mainScreenState.columns, mainScreenState.safeRect, mainScreenState.innerGap),
    cancelPending: reason => {
        motionPlanCommitGate.cancel();
        scrollPlanCommitGate.retainForLegacy();
        contextualWideCoordinator.cancel();
        cancelPendingDockScroll(reason);
    },
    clearPresentation: () => {
        clearPresentationState();
        mainScreenState.prePresentationViewport = null;
        contextualWideCoordinator.adoptRestoredViewport();
    },
    focusColumn: column => columnStore.focusColumn(column),
    recomputeLogicalLayout,
    ensureColumnVisible,
    relayout,
    commitState: commitRuntimeState,
});
const reorderController = new ReorderController({
    getAppState: () => mainScreenState,
    normalizeUuid: normalizeWindowUuid,
    rejectRuntimeCommand,
    cancelDockScroll: cancelPendingDockScroll,
    getFocusedColumn: () => columnStore.focusedColumn(),
    reorderColumns: columns => columnStore.reorder(columns),
    recomputeLogicalLayout,
    ensureColumnVisible,
    relayout,
    getGeneration: () => runtimeBridge.generation(),
    commitRuntimeState,
    getActiveWindow: () => workspace.activeWindow,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    focusIndex: index => columnStore.focusIndex(index),
    focusedIndex: () => columnStore.focusedIndex(),
    moveFocusedColumn: delta => columnStore.moveFocused(delta),
    debug,
});
workspaceMountController = new WorkspaceMountController({
    scrollLayoutV2Enabled: runtimeConfig.scrollLayoutV2Enabled,
    captureV2View: runtimeConfig.scrollLayoutV2Enabled ? () => continuousLayout.captureView() : null,
    restoreV2View: (anchor, preserve) => continuousLayout.restoreView(anchor, preserve),
    onMounted: runtimeConfig.scrollLayoutV2Enabled ? reason => continuousLayout.sync(reason) : null,
    appState: mainScreenState,
    columnStore,
    snapshots: workspaceSnapshots,
    persistence: workspacePersistence,
    topology: virtualDesktopTopology,
    membership: workspaceMembership,
    windowPolicy,
    stateFor,
    getWindows: () => workspace.windowList(),
    getActiveWindow: () => workspace.activeWindow,
    normalizeUuid: normalizeWindowUuid,
    refreshState: refreshMainScreenState,
    prepareWindow: prepareInitialColumn,
    transitionAdoption: (window, state, phase, reason) =>
        adoptionController.transition(window, state, phase, reason),
    phases: { managed: ADOPTION_MANAGED, waitingWorkspace: ADOPTION_WAITING_WORKSPACE },
    cancelPending: reason => {
        if (continuousLayout && reason !== "workspace-stop" && reason !== "workspace-column-move") continuousLayout.releaseForWorkspace();
        motionPlanCommitGate.cancel();
        if (reason !== "workspace-stop" && reason !== "workspace-column-move" &&
                deferredScrollParking.pending && deferredScrollParking.pending.partialItems.length)
            scrollPlanCommitGate.releaseForWorkspace();
        else scrollPlanCommitGate.cancel();
        cancelPendingDockScroll(reason);
        contextualViewport.cancelReveal();
        contextualWideCoordinator.cancelForWorkspace();
    },
    resetPresentation: clearPresentationState,
    restoreViewport: snapshot => {
        contextualViewport.restore(snapshot);
        contextualWideCoordinator.adoptRestoredViewport();
    },
    recomputeLayout: recomputeLogicalLayout,
    boundOffset: offset => boundScrollOffset(offset, stripWidth(),
        mainScreenState.safeRect ? mainScreenState.safeRect.width : 0),
    ensureVisible: ensureColumnVisible,
    activateColumn: activateColumnWhenReady,
    relayout,
    commitState: commitRuntimeState,
    releaseWindow: (window, reason) => releaseParkingOwnership(window, reason, true),
    onFailure: error => {
        warn(`[cc-workspace] mount failed: ${error}`);
        emergencyRestoreAllWindows("workspace-mount-failure");
    },
    debug,
});
workspaceSwitchController = new WorkspaceSwitchController({
    appState: mainScreenState,
    mount: workspaceMountController,
    topology: virtualDesktopTopology,
    requestDesktop: (desktop, output) => {
        if (typeof workspace.setCurrentDesktopForScreen === "function") {
            workspace.setCurrentDesktopForScreen(desktop, output);
        } else {
            workspace.currentDesktop = desktop;
        }
    },
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    onFailure: error => {
        warn(`[cc-workspace] switch failed: ${error}`);
        emergencyRestoreAllWindows("workspace-switch-failure");
    },
    debug,
});
workspaceTransferController = new WorkspaceTransferController({
    scrollLayoutV2Enabled: runtimeConfig.scrollLayoutV2Enabled,
    appState: mainScreenState,
    snapshots: workspaceSnapshots,
    topology: virtualDesktopTopology,
    membership: workspaceMembership,
    windowPolicy,
    stateFor,
    normalizeUuid: normalizeWindowUuid,
    getColumn: window => mainScreenState.columns[columnStore.indexOfWindow(window)] || null,
    cancelPending: (window, reason) => {
        motionPlanCommitGate.cancel();
        scrollPlanCommitGate.cancel();
        contextualWideCoordinator.cancelForWindow(window);
        contextualViewport.cancelReveal();
        cancelPendingDockScroll(reason);
    },
    releaseWindow: (window, reason) => releaseParkingOwnership(window, reason, true),
    removeWindow: (window, reason) => removeColumn(window, reason, false),
    adoption: adoptionController,
    flushLayout: reason => {
        recomputeLogicalLayout();
        clampScrollOffset();
        relayout(reason);
    },
    canCommit: () => scrollLayoutInitialized && workspaceMountController.canUseActiveWorkspace(),
    commitState: commitRuntimeState,
    onFailure: error => {
        warn(`[cc-workspace] transfer failed: ${error}`);
        emergencyRestoreAllWindows("workspace-transfer-failure");
    },
});
workspaceMoveController = new WorkspaceMoveController({
    appState: mainScreenState,
    mount: workspaceMountController,
    switcher: workspaceSwitchController,
    transfer: workspaceTransferController,
    topology: virtualDesktopTopology,
    membership: workspaceMembership,
    snapshots: workspaceSnapshots,
    columnStore,
    windowPolicy,
    stateFor,
    normalizeUuid: normalizeWindowUuid,
    getActiveWindow: () => workspace.activeWindow,
    getWindows: () => workspace.windowList(),
    settleMotion: callback => continuousLayout
        ? continuousLayout.exclusive("workspace-column-move", callback)
        : scrollPlanCommitGate.whenIdle(callback),
    clearPresentation: () => {
        contextualWideCoordinator.cancel();
        clearPresentationState();
        mainScreenState.prePresentationViewport = null;
    },
    changeMembership: (window, desktop) => { window.desktops = [desktop]; },
    settleSourceLayout: () => {
        recomputeLogicalLayout();
        clampScrollOffset();
        const focused = columnStore.focusedColumn();
        if (focused) ensureColumnVisible(focused);
    },
    onSettled: () => {
        dynamicWorkspaceController.request();
        workspaceRecycleController.request();
    },
    onFailure: error => {
        warn(`[cc-workspace] move failed: ${error}`);
        emergencyRestoreAllWindows("workspace-move-failure");
    },
    debug,
});
dynamicWorkspaceController = new DynamicWorkspaceController({
    enabled: runtimeConfig.dynamicTrailingWorkspace,
    isReady: () => scrollLayoutInitialized && mainScreenState.enabled &&
        !mainScreenState.workspaceSwitching && !workspaceTransferController.isProcessing() &&
        (!workspaceRecycleController || workspaceRecycleController.pendingId === null),
    getTargetOutput: () => resolveTargetOutput(),
    getDesktops: () => workspace.desktops,
    getWindows: () => workspace.windowList(),
    membership: workspaceMembership,
    occupancy: workspaceOccupancy,
    createDesktop: typeof workspace.createDesktop === "function"
        ? (position, name) => workspace.createDesktop(position, name) : null,
    ensureVerticalLayout: count => runtimeBridge.ensureVerticalDesktopLayout(
        count, accepted => {
            if (!accepted) warn("[cc-workspace] vertical desktop layout not confirmed");
        }),
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    onSettled: () => { if (workspaceRecycleController) workspaceRecycleController.request(); },
    warn,
});
workspaceRecycleController = new WorkspaceRecycleController({
    enabled: runtimeConfig.dynamicTrailingWorkspace && runtimeConfig.autoRecycleWorkspaces,
    transitionStatus: callback => runtimeBridge.workspaceTransitionStatus(callback),
    isReady: () => scrollLayoutInitialized && workspaceMountController.canUseActiveWorkspace() &&
        !workspaceTransferController.isProcessing() && dynamicWorkspaceController.pendingTopology === null,
    getDesktopIds: () => virtualDesktopTopology.ordered().map(desktop => virtualDesktopTopology.id(desktop)),
    getProtectedIds: () => [mainScreenState.activeWorkspaceId].concat(
        Array.from(workspace.screens, output => virtualDesktopTopology.id(virtualDesktopTopology.current(output)))),
    getWindows: () => workspace.windowList(),
    occupancy: workspaceOccupancy,
    removeDesktop: typeof workspace.removeDesktop === "function" ? id => {
        const desktop = virtualDesktopTopology.byId(id);
        if (desktop) workspace.removeDesktop(desktop);
    } : null,
    onRemoved: id => {
        workspaceSnapshots.remove(id);
        commitRuntimeState("workspace-recycle");
        dynamicWorkspaceController.request();
    },
    ensureVerticalLayout: count => dynamicWorkspaceController.ensureVerticalLayout(count),
    onFailure: error => {
        warn(`[cc-workspace] recycle cleanup failed: ${error}`);
        emergencyRestoreAllWindows("workspace-recycle-failure");
    },
    setTimer: setRuntimeTimer,
    clearTimer: clearRuntimeTimer,
    warn,
});
focusRingController = new FocusRingController({
    workspace,
    invoke: callDBus,
    getState: () => mainScreenState,
    getWindowState: window => states.get(window),
    getCurrentDesktop: output => virtualDesktopTopology.current(output),
    membership: workspaceMembership,
    windowPolicy,
    now: () => Date.now(),
    random: () => Math.random(),
});
if (runtimeConfig.scrollLayoutV2Enabled) {
    continuousLayout = new ContinuousLayoutRuntime({
        state: mainScreenState, columnStore, transaction: layoutTransaction, bridge: runtimeBridge,
        dockEnabled: runtimeConfig.dockIntegration,
        getPrimaryOutput: resolveTargetOutput,
        getCurrentWorkspaceId: () => virtualDesktopTopology.id(virtualDesktopTopology.current(mainScreenState.targetOutput)),
        getUuid: window => normalizeWindowUuid(window.internalId),
        getGeometry: v2Geometry,
        canJoin: (window, scope) => windowPolicy.canJoinColumn(window) &&
            workspaceMembership.belongsTo(window, scope.workspaceId) && window.output === scope.output && !stateFor(window).floating,
        commitState: (reason, done) => { if (!commitRuntimeState(reason, done)) done(false); },
        committer: geometryCommitter,
        prepareClient: window => parkingManager.prepareGeometry(window),
        setVisibility: (window, visible) => parkingManager.setVisibility(window, visible),
        activate: window => { stateFor(window).scrollUserMinimized = false; workspace.activeWindow = window; },
        fail: (reason, cancelled) => {
            warn(`[cc-v2] disabled reason=${reason} cancelled=${cancelled}`);
            mainScreenState.enabled = false;
            if (cancelled === true) emergencyRestoreAllWindows("v2-geometry-failure");
        },
        onSettled: () => focusRingController.publish(),
        setTimer: setRuntimeTimer, clearTimer: clearRuntimeTimer, now: () => Date.now(), warn,
    });
}

function v2Geometry() {
    return outputTopology.v2Geometry(mainScreenState.targetOutput,
        virtualDesktopTopology.current(mainScreenState.targetOutput));
}

function v2Departure(window, reason, action) {
    if (!window || !continuousLayout || continuousLayout.inExclusive) return action();
    return continuousLayout.exclusive(`${reason}:${normalizeWindowUuid(window.internalId)}`, () => {
        if (workspace.windowList().includes(window)) action();
    });
}

const controllerComposition = new ControllerComposition(Object.assign({
    focusRing: focusRingController,
    workspaceRecycle: workspaceRecycleController,
    dynamicWorkspace: dynamicWorkspaceController,
    workspaceTransfer: workspaceTransferController,
    workspaceMove: workspaceMoveController,
    workspaceSwitch: workspaceSwitchController,
    workspaceMount: workspaceMountController,
    parking: parkingManager,
    geometry: geometryCommitter,
    invariants: invariantChecker,
    transactions: layoutTransaction,
    recovery,
    adoption: adoptionController,
    floating: floatingController,
    output: outputController,
    fullscreen: fullscreenController,
    presentation: presentationController,
    columnWidth: columnWidthController,
    runtimeBridge,
    reorder: reorderController,
}, dockScrollController ? { dockScroll: dockScrollController } : {}), [
    "focusRing", "parking", "geometry", "invariants", "transactions", "recovery",
    "adoption", "floating", "output", "fullscreen", "presentation", "columnWidth",
    "runtimeBridge", "reorder", "workspaceMount", "workspaceSwitch", "workspaceTransfer", "workspaceMove", "dynamicWorkspace", "workspaceRecycle",
]);

function debug(message) {
    runtimeLogger.debug(message);
}

function warn(message) {
    runtimeLogger.warn(message);
}

function normalizeWindowUuid(value) {
    return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
}

function createRuntimeSnapshot() {
    const focusedColumn = mainScreenState.columns[mainScreenState.focusedColumnIndex] || null;
    const wideColumn = contextualViewport.column();
    const anchorColumn = mainScreenState.columns.reduce((anchor, column) =>
        column.logicalX <= mainScreenState.scrollOffsetX ? column : anchor, null);
    if (workspaceMountController && workspaceMountController.canUseActiveWorkspace()) workspaceMountController.capture();
    const saved = mainScreenState.activeWorkspaceId && workspaceSnapshots.get(mainScreenState.activeWorkspaceId);
    const active = {
        workspaceId: mainScreenState.activeWorkspaceId,
        workspaceIndex: virtualDesktopTopology.indexOf(
            virtualDesktopTopology.byId(mainScreenState.activeWorkspaceId)),
        targetOutput: mainScreenState.targetOutput ? mainScreenState.targetOutput.name : "",
        focusedUuid: focusedColumn
            ? normalizeWindowUuid(focusedColumn.window.internalId)
            : "",
        presentation: {
            windowUuid: wideColumn
                ? normalizeWindowUuid(wideColumn.window.internalId)
                : mainScreenState.presentation.windowUuid || null,
            mode: wideColumn
                ? PRESENTATION_WIDE : mainScreenState.presentation.mode,
        },
        columns: mainScreenState.columns.map(column => {
            const entry = workspaceColumnPreference(column, normalizeWindowUuid(column.window.internalId),
                runtimeConfig.scrollLayoutV2Enabled);
            if (!continuousLayout) { delete entry.previousNonFullWidthMode; delete entry.persistentWide; }
            return entry;
        }),
        viewportAnchor: anchorColumn ? {
            uuid: normalizeWindowUuid(anchorColumn.window.internalId),
            delta: mainScreenState.scrollOffsetX - anchorColumn.logicalX,
        } : null,
    };
    if (saved && saved.viewportAnchorV2 !== undefined) active.viewportAnchorV2 = saved.viewportAnchorV2;
    return workspacePersistence.snapshot(active);
}

function publishRuntimeState(reason) {
    focusRingController.publish();
    if (workspaceTransferController && workspaceTransferController.isProcessing()) return null;
    return runtimeBridge.publish(createRuntimeSnapshot(), reason);
}

function commitRuntimeState(reason, callback = () => {}) {
    focusRingController.publish();
    if (workspaceTransferController && workspaceTransferController.isProcessing()) return null;
    return runtimeBridge.commit(createRuntimeSnapshot(), reason, callback);
}

function rejectRuntimeCommand(reason) {
    return runtimeBridge.reject(null, reason);
}

function handleDockPresentationCommand(command) {
    const windowUuid = normalizeWindowUuid(command.windowUuid);
    const mode = String(command.mode || "");
    const column = mainScreenState.columns.find(item =>
        normalizeWindowUuid(item.window.internalId) === windowUuid);
    if (!column || column.window.output !== mainScreenState.targetOutput ||
            !isPresentationMode(mode)) {
        rejectRuntimeCommand("invalid-presentation-target");
        return false;
    }
    return setPresentationMode(windowUuid, mode, "dock-presentation");
}

function handleDockFocusCommand(command) {
    const windowUuid = normalizeWindowUuid(command.windowUuid);
    const index = mainScreenState.columns.findIndex(item =>
        normalizeWindowUuid(item.window.internalId) === windowUuid);
    const column = index >= 0 ? mainScreenState.columns[index] : null;
    if (!column || column.window.output !== mainScreenState.targetOutput) {
        rejectRuntimeCommand("invalid-focus-target");
        return false;
    }
    return beginDockScroll(column, "dock-focus-right");
}

function handleDockReorderCommand(command) {
    if (continuousLayout) {
        const order = Array.isArray(command.order) ? command.order : command.windowUuids;
        return continuousLayout.ready() && continuousLayout.controller.reorder(order);
    }
    return reorderController.applyRuntimeCommand(command);
}

function runWorkspaceAction(action) {
    if (!workspaceMountController || !workspaceMountController.canUseActiveWorkspace()) return false;
    return action();
}

function applyPendingRuntimeCommand() {
    return runtimeBridge.takePendingCommand();
}

function rectCopy(rect) {
    return copyRect(rect);
}

function rectText(rect) {
    return formatRect(rect);
}

function sameRect(a, b) {
    return rectsEqual(a, b);
}

function sameRectNear(a, b) {
    return rectsNearlyEqual(a, b);
}

function sameSizeNear(a, b) {
    return sizesNearlyEqual(a, b);
}

function orderedOutputs() {
    return outputTopology.ordered();
}

function resolveTargetOutput() {
    return outputTopology.primary();
}

function resolveSecondaryOutput() {
    return outputTopology.secondary();
}

function profileForOutput(output) {
    return outputTopology.profile(output);
}

function managedOutputs() {
    return outputTopology.managed();
}

function safeRectFor(output) {
    return outputTopology.safeRect(output);
}

function scrollEligible(window) {
    return windowPolicy.canJoinColumn(window) &&
        workspaceMembership.belongsToActive(window, mainScreenState.targetOutput);
}

function refreshMainScreenState() {
    mainScreenState.targetOutput = resolveTargetOutput();
    mainScreenState.safeRect = mainScreenState.targetOutput
        ? safeRectFor(mainScreenState.targetOutput)
        : null;
    mainScreenState.innerGap = innerGap;
}

function widthForMode(mode) {
    const safeRect = mainScreenState.safeRect;
    if (!safeRect) return 1;
    return computeColumnWidth(mode, safeRect.width, mainScreenState.innerGap);
}

function recomputeLogicalLayout() {
    if (continuousLayout) {
        const geometry = v2Geometry();
        if (!geometry) return;
        const layout = deriveV2Layout(mainScreenState.columns, geometry);
        mainScreenState.columns.forEach((column, index) => Object.assign(column, layout.columns[index]));
        return;
    }
    if (!mainScreenState.safeRect) return;
    const layout = deriveColumnLayout(
        mainScreenState.columns,
        mainScreenState.safeRect.width,
        mainScreenState.innerGap,
        { alwaysCenterSingleColumn: runtimeConfig.alwaysCenterSingleColumn }
    );
    mainScreenState.columns.forEach((column, index) => {
        column.pixelWidth = layout[index].pixelWidth;
        column.logicalX = layout[index].logicalX;
    });
}

function stripWidth() {
    if (continuousLayout && v2Geometry()) return deriveV2Layout(mainScreenState.columns, v2Geometry()).stripEnd;
    return computeStripWidth(mainScreenState.columns);
}

function clampScrollOffset() {
    if (continuousLayout && v2Geometry()) {
        mainScreenState.scrollOffsetX = clampV2Camera(mainScreenState.scrollOffsetX,
            deriveV2Layout(mainScreenState.columns, v2Geometry()).maxCamera);
        return;
    }
    const viewportWidth = mainScreenState.safeRect ? mainScreenState.safeRect.width : 0;
    mainScreenState.scrollOffsetX = boundScrollOffset(
        mainScreenState.scrollOffsetX,
        stripWidth(),
        viewportWidth
    );
}

function ensureColumnVisible(column) {
    if (continuousLayout && v2Geometry()) {
        const layout = deriveV2Layout(mainScreenState.columns, v2Geometry());
        mainScreenState.scrollOffsetX = focusV2Camera(layout, columnStore.indexOf(column), mainScreenState.scrollOffsetX);
        return;
    }
    if (!column || !mainScreenState.safeRect) return;
    const oldOffset = mainScreenState.scrollOffsetX;
    mainScreenState.scrollOffsetX = scrollOffsetToRevealColumn(
        runtimeConfig.alwaysCenterSingleColumn && mainScreenState.columns.length > 1
            ? Math.max(oldOffset, virtualLeadingInset(mainScreenState.safeRect.width,
                mainScreenState.innerGap, true)) : oldOffset,
        column,
        stripWidth(),
        mainScreenState.safeRect.width
    );
    if (oldOffset !== mainScreenState.scrollOffsetX) {
        debug(`[cc-scroll] SCROLL old=${oldOffset} new=${mainScreenState.scrollOffsetX}`);
    }
}

function projectedRectForColumnAtOffset(column, scrollOffsetX) {
    if (continuousLayout && v2Geometry()) return projectV2Column(column, v2Geometry(), scrollOffsetX).visualRect;
    return projectColumnRect(column, mainScreenState.safeRect, scrollOffsetX);
}

function projectedRectForColumn(column) {
    return projectedRectForColumnAtOffset(column, mainScreenState.scrollOffsetX);
}

function isPresentationMode(mode) {
    return presentationController.isMode(mode);
}

function presentationColumn() {
    return presentationController.column();
}

function wideRect() {
    return presentationController.wideRect();
}

function presentationRect() {
    return presentationController.rect();
}

function isFullyVisibleInSafeRect(rect) {
    return isRectFullyVisible(rect, mainScreenState.safeRect);
}

function rectIntersects(a, b) {
    return rectanglesIntersect(a, b);
}

function isRectInsideAnyOutput(rect) {
    return workspace.screens.some(output => rectIntersects(rect, output.geometry));
}

function virtualScreenLeft() {
    const geometry = workspace.virtualScreenGeometry;
    if (geometry && Number.isFinite(Number(geometry.x))) return Number(geometry.x);
    return workspace.screens.reduce(
        (left, output) => Math.min(left, output.geometry.x),
        0
    );
}

function looksLikeInheritedParking(window) {
    const rect = window.frameGeometry;
    return Number(window.opacity) <= 0 && window.minimized && rect &&
        Number(rect.x) < virtualScreenLeft();
}

function parkingBaseX() {
    return computeParkingBaseX(
        mainScreenState.columns,
        virtualScreenLeft(),
        PARKING_MARGIN
    );
}

function applyColumnGeometry(column, target, reason) {
    geometryCommitter.commitGeometry(column, target, reason);
}

function setColumnVisualVisibility(column, visible) {
    parkingManager.setVisibility(column.window, visible);
}

function parkingRecoveryRect(windowState, fallbackIndex) {
    return parkingManager.recoveryRect(windowState, fallbackIndex);
}

function releaseParkingOwnership(window, reason, ensureAccessible = false,
        fallbackIndex = 0) {
    return parkingManager.release(
        window,
        reason,
        ensureAccessible,
        fallbackIndex
    );
}

function emergencyRestoreAllWindows(reason, requestId = null) {
    focusRingController.stop();
    stabilitySupervisor.stop();
    return recovery.restoreAll(reason, requestId);
}

function beginLayoutTransaction(reason) {
    return layoutTransaction.begin(reason);
}

function validateLayoutInvariants(reason, epoch) {
    return invariantChecker.check(reason, epoch);
}

function endLayoutTransaction(reason, epoch) {
    layoutTransaction.end(reason, epoch);
}

function relayoutImpl(reason, scrollOffsets, widthTransition, previousSingleLayout) {
    if (!mainScreenState.enabled) {
        warn(`[cc-scroll] relayout skipped: disabled reason=${reason}`);
        return;
    }
    if (!mainScreenState.columns.length) return;
    refreshMainScreenState();
    if (!mainScreenState.safeRect) return;
    recomputeLogicalLayout();
    clampScrollOffset();
    const singleTransition = classifySingleColumnTransition(previousSingleLayout, mainScreenState);
    // A reindexed survivor has a different logical origin. Never combine its
    // new logical X with the old camera to invent a Scroll v2 source pose.
    const reindexed = singleTransition === "reindex" || singleTransition === "rebase" ||
        Boolean(scrollPlanCommitGate.pending && scrollPlanCommitGate.pending.staticFallback);
    if (reindexed) scrollOffsets = undefined;
    const presentedColumn = presentationColumn();
    contextualWideCoordinator.prepareLayoutTransition(presentedColumn, widthTransition);
    const wideExitColumn = widthTransition && widthTransition.column.widthMode !== "full"
        ? widthTransition.column : contextualWideCoordinator.wideExitColumn();
    if (scrollOffsets) scrollOffsets = Object.assign({}, scrollOffsets, {
        oldScrollOffsetX: scrollPlanCommitGate.baseOffset(scrollOffsets.oldScrollOffsetX),
    });
    let plan = computeLayoutPlan({
        reason,
        epoch: layoutTransaction.currentEpoch(),
        columns: mainScreenState.columns,
        safeRect: mainScreenState.safeRect,
        innerGap: mainScreenState.innerGap,
        parkingBaseX: parkingBaseX(),
        scrollOffsetX: mainScreenState.scrollOffsetX,
        scrollOffsets,
        presentedColumn,
        presentedRect: presentedColumn ? presentationRect() : null,
        retainedColumn: contextualWideCoordinator.retainedNeighbor(),
        wideExitColumn,
        wideRect: presentationController.wideRect(),
        widthTransition,
        clipPartial: true,
    });
    const directionalFocus = reason === "focus-next" || reason === "focus-previous";
    const singleScroll = singleTransition === "scroll";
    if (!reindexed && (directionalFocus || singleScroll) && !plan.viewportMotion && !plan.scrollTransaction &&
            (scrollPlanCommitGate.pending || (singleScroll && deferredScrollParking.pending))) {
        // Equal committed offsets do not imply equal painted positions. Reverse
        // the pending Spring through the same native ACK gate instead of snap.
        plan = prepareViewportReturnPlan(plan, mainScreenState.scrollOffsetX, mainScreenState.safeRect);
    }
    if (directionalFocus && !plan.viewportMotion && !plan.scrollTransaction &&
            !scrollPlanCommitGate.pending && deferredScrollParking.pending) {
        // Focus can move inside the already committed pair without stopping
        // its in-flight visual offset or retiring any outgoing window.
        return;
    }
    if (plan.viewportMotion) {
        const motion = plan.viewportMotion;
        const partialExitToken = contextualWideCoordinator.preparePartialExit(plan);
        const envelope = {
            epoch: plan.epoch,
            issuedAt: Date.now(),
            type: motion.type,
            side: motion.side,
            viewport: motion.viewport,
            oldViewportMode: motion.oldViewportMode,
            newViewportMode: motion.newViewportMode,
            parkAfterComplete: motion.parkAfterComplete,
            transitionToken: motion.type === "PAIR_TO_WIDE"
                ? contextualWideCoordinator.parkToken() : partialExitToken,
            targetWindowUuid: normalizeWindowUuid(
                plan.windows.find(item => item.columnId ===
                    motion.targetColumnId).column.window.internalId),
            entries: motion.entries.map((entry, index) => Object.assign({}, entry, {
                windowId: normalizeWindowUuid(entry.windowId),
                oldRealRect: plan.layoutSnapshots.from.entries[index].realRect,
                newRealRect: plan.layoutSnapshots.to.entries[index].realRect,
            })),
        };
        scrollPlanCommitGate.retainForLegacy();
        motionPlanCommitGate.schedule(plan, envelope, { wideExitColumn });
        return;
    }
    if (singleTransition === "reindex") {
        const reindexPlan = prepareSingleColumnReindexPlan(plan, previousSingleLayout, mainScreenState.scrollOffsetX);
        if (reindexPlan) {
            const envelope = createViewportReindexPlan(reindexPlan.scrollTransaction, {
                workspaceId: mainScreenState.activeWorkspaceId,
                targetOutput: mainScreenState.targetOutput.name,
                issuedAt: Date.now(), normalizeUuid: normalizeWindowUuid,
            });
            if (envelope) {
                motionPlanCommitGate.cancel(); deferredScrollParking.pause();
                scrollPlanCommitGate.schedule(reindexPlan, envelope, { wideExitColumn, membershipReason: reason });
                return true;
            }
        }
    }
    if (!reindexed && plan.scrollTransaction && (directionalFocus || singleScroll || plan.scrollTransaction.clipPartial)) {
        const envelope = createViewportScrollPlan(plan.scrollTransaction, {
            workspaceId: mainScreenState.activeWorkspaceId,
            targetOutput: mainScreenState.targetOutput.name,
            issuedAt: Date.now(),
            normalizeUuid: normalizeWindowUuid,
        });
        if (envelope) {
            motionPlanCommitGate.cancel();
            deferredScrollParking.pause();
            // Hydration installs new UUID membership before Bridge validates the plan.
            if (reason === "workspace-mount") commitRuntimeState(reason);
            scrollPlanCommitGate.schedule(plan, envelope, { wideExitColumn,
                membershipReason: singleScroll ? reason : null });
            return singleScroll;
        }
    }
    motionPlanCommitGate.cancel();
    scrollPlanCommitGate.cancel();
    if (reindexed) {
        scrollPlanCommitGate.commitWhenDisarmed(plan, { wideExitColumn }, mainScreenState.scrollOffsetX);
        return;
    }
    commitLayoutPlan(plan, wideExitColumn, null);
}

function commitLayoutPlan(plan, wideExitColumn, activationWindow, options) {
    return layoutTransaction.resume(plan.reason, plan.epoch, () => {
        const activeBeforeCommit = workspace.activeWindow;
        if (!options || !options.nativeScroll) deferredScrollParking.cancel();
        const commitResult = geometryCommitter.commit(plan, options);
        if (options && options.nativeScroll) deferredScrollParking.start(plan.epoch, commitResult.pendingPark, plan.windows.filter(item => item.partial));
        // A restored client can activate during unminimize. Preserve actual
        // focus through this batch; explicit deferred activation is applied by
        // the existing coordinator after its geometry readiness checks.
        if (activeBeforeCommit && workspace.activeWindow !== activeBeforeCommit &&
                !activeBeforeCommit.minimized && workspace.windowList().includes(activeBeforeCommit)) {
            workspace.activeWindow = activeBeforeCommit;
        }
        contextualWideCoordinator.onPlanCommitted(plan, wideExitColumn,
            commitResult, activationWindow, options);
    });
}

function activateColumnWhenReady(window) {
    if (continuousLayout && columnStore.indexOfWindow(window) >= 0) {
        if (continuousLayout.ready()) continuousLayout.controller.focusWindow(window);
        return; // P4 activates only after the matching client/paint proof.
    }
    if (scrollPlanCommitGate.deferActivation(window)) return;
    if (motionPlanCommitGate.deferActivation(window)) return;
    if (!contextualWideCoordinator.deferActivation(window)) {
        workspace.activeWindow = window;
    }
}

function relayout(reason, scrollOffsets, widthTransition, previousSingleLayout) {
    if (reason !== "workspace-mount" && workspaceTransferController &&
            workspaceTransferController.deferLayout()) return;
    if (reason !== "workspace-mount" && !workspaceMountController.canUseActiveWorkspace()) return;
    if (continuousLayout) { refreshMainScreenState(); return continuousLayout.sync(reason); }
    const epoch = beginLayoutTransaction(reason);
    try {
        return relayoutImpl(reason, scrollOffsets, widthTransition, previousSingleLayout);
    } finally {
        endLayoutTransaction(reason, epoch);
    }
}

function columnIndexForWindow(window) {
    return columnStore.indexOfWindow(window);
}

function resetPresentedWindowLayoutState() {
    return presentationController.resetPresentedWindowLayoutState();
}

function clearPresentationState() {
    contextualViewport.cancelReveal();
    return presentationController.clear();
}

function cancelPendingDockScroll(reason, preserveWideReveal = false) {
    if (!preserveWideReveal) contextualViewport.cancelReveal();
    return dockScrollController ? dockScrollController.cancel(reason) : false;
}

function advancePendingDockScroll(command) {
    return dockScrollController ? dockScrollController.advance(command) : false;
}

function beginDockScroll(column, reason) {
    if (continuousLayout) return continuousLayout.ready() && continuousLayout.controller.focusWindow(column.window, "dock");
    if (!dockScrollController) return false;
    contextualViewport.cancelReveal();
    return dockScrollController.begin(column, reason);
}

function selectPersistentPresentation(column) {
    return presentationController.selectPersistent(column);
}

function relayoutFocusedColumnTransition(column, reason, oldScrollOffsetX,
        newScrollOffsetX, wideStepDirection = 0, focusChanged = false) {
    const previousMode = mainScreenState.viewport.mode;
    const previousId = mainScreenState.viewport.wideColumnId;
    if (mainScreenState.presentation.mode !== PRESENTATION_NORMAL) {
        presentationController.clear();
    }
    contextualViewport.select(column, {
        source: wideStepDirection ? FocusSource.DIRECTIONAL :
            FocusSource.PROGRAMMATIC,
        changedFocus: Boolean(wideStepDirection) || focusChanged,
        direction: wideStepDirection,
        viewportMoved: oldScrollOffsetX !== newScrollOffsetX,
    });
    relayout(reason, { oldScrollOffsetX, newScrollOffsetX });
    return previousMode !== mainScreenState.viewport.mode ||
        previousId !== mainScreenState.viewport.wideColumnId;
}

function setPresentationMode(windowUuid, mode, reason) {
    if (continuousLayout) {
        const column = mainScreenState.columns.find(c => normalizeWindowUuid(c.window.internalId) === windowUuid);
        if (!column || column.window.fullScreen) return false;
        if (mode === PRESENTATION_WIDE) return continuousLayout.ready() && continuousLayout.controller.center(column.window);
        return continuousLayout.exclusive("v2-presentation", () => {
            const state = stateFor(column.window);
            state.internalChange = true;
            try { column.window.setMaximize(false, false); } finally { state.internalChange = false; }
            columnStore.focusColumn(column);
            mainScreenState.presentation = { mode, windowUuid: mode === PRESENTATION_MAXIMIZED ? windowUuid : null };
            setLayoutMode(state, mode === PRESENTATION_MAXIMIZED ? MAXIMIZE_MODE : NORMAL_MODE);
            if (mode === PRESENTATION_MAXIMIZED) {
                mainScreenState.columns.forEach(c => parkingManager.setVisibility(c.window, c === column));
                applyLayoutGeometry(column.window, state, MAXIMIZE_MODE, reason);
            }
            commitRuntimeState(reason);
        });
    }
    contextualWideCoordinator.cancelExit();
    return presentationController.setMode(windowUuid, mode, reason);
}

function addColumnAt(window, insertionIndex, reason) {
    if (!workspaceMountController.canUseActiveWorkspace() ||
            !scrollEligible(window) || columnIndexForWindow(window) >= 0) return null;
    const windowState = stateFor(window);
    const column = columnStore.insertWindow(
        window,
        insertionIndex,
        COLUMN_WIDTH_HALF
    );
    if (!column) return null;
    const preference = windowState.workspaceColumnPreference;
    if (preference) {
        column.widthMode = continuousLayout && preference.widthV2 ? preference.widthV2.widthMode : normalizeColumnWidthMode(preference.widthMode);
        if (preference.widthV2) column.widthV2 = preference.widthV2;
        column.previousNonFullWidthMode = normalizePreviousNonFullWidthMode(
            continuousLayout && preference.widthV2 ? preference.widthV2.previousNonFullWidthMode : preference.previousNonFullWidthMode,
            column.widthMode, Boolean(continuousLayout));
        column.persistentWide = preference.persistentWide;
        windowState.workspaceColumnPreference = null;
    }
    windowState.managedByScrollLayout = true;
    windowState.workspaceOwnerId = workspaceMembership.ownerId(window);
    windowState.columnId = column.id;
    const index = columnStore.indexOf(column);
    debug(`[cc-scroll] ADD_WINDOW caption=${window.caption}` +
        ` column=${column.id} index=${index} width=${column.widthMode}` +
        ` reason=${reason}`);
    return column;
}

function addInitialColumn(window) {
    const column = addColumnAt(
        window,
        mainScreenState.columns.length,
        "startup"
    );
    if (column) {
        const windowState = stateFor(window);
        adoptionController.transition(
            window,
            windowState,
            ADOPTION_MANAGED,
            "startup"
        );
    }
    return column;
}

function prepareInitialColumn(window) {
    const windowState = stateFor(window);
    const tileMode = detectQuickTileMode(window);
    const hadLayoutOverride = isLayoutMode(windowState.layoutMode) ||
        Number(window.maximizeMode) === FULL_MAXIMIZE_MODE || isTileMode(tileMode);
    if (!hadLayoutOverride) return true;

    windowState.internalChange = true;
    try {
        if (isTileMode(tileMode)) {
            /*
             * KWin exposes no writable tile property. A maximize -> restore
             * round trip is the verified public operation that detaches the
             * native Quick Tile object before scroll-layout adoption.
             */
            window.setMaximize(true, true);
            window.setMaximize(false, false);
        } else {
            window.setMaximize(false, false);
        }
        clearLayoutState(windowState);
        windowState.layoutModeBeforeFullscreen = NORMAL_MODE;
        windowState.temporarilyMaximized = false;
        windowState.temporarilyQuickTiled = false;
    } finally {
        windowState.internalChange = false;
    }

    const detached = detectQuickTileMode(window) === NORMAL_MODE &&
        Number(window.maximizeMode) !== FULL_MAXIMIZE_MODE;
    if (!detached) {
        warn(`[cc-scroll] failed to detach startup layout caption=${window.caption}` +
            ` tile=${detectQuickTileMode(window)} maximize=${window.maximizeMode}`);
    } else {
        debug(`[cc-scroll] ADOPT_STARTUP_OVERRIDE caption=${window.caption}` +
            ` previous=${tileMode}`);
    }
    return detached;
}

function removeColumn(window, reason, activateSuccessor = true) {
    if (continuousLayout) {
        const remove = () => {
            workspaceSnapshots.removeWindow(normalizeWindowUuid(window.internalId));
            const column = mainScreenState.columns[columnStore.indexOfWindow(window)];
            if (!column) return;
            if (reason !== "window-closed") stateFor(window).workspaceColumnPreference = workspaceColumnPreference(
                column, normalizeWindowUuid(window.internalId), true);
            if (reason !== "window-closed") releaseParkingOwnership(window, reason,
                window.output === mainScreenState.targetOutput && !window.fullScreen);
            columnStore.removeWindow(window);
            const state = states.get(window);
            if (state) { state.managedByScrollLayout = false; state.columnId = null; }
            if (mainScreenState.presentation.windowUuid === normalizeWindowUuid(window.internalId)) clearPresentationState();
            recomputeLogicalLayout(); clampScrollOffset();
            if (workspaceTransferController && workspaceTransferController.deferLayout()) return;
            if (!continuousLayout.inExclusive) continuousLayout.sync(reason);
            if (workspaceMountController.canUseActiveWorkspace()) commitRuntimeState(reason);
        };
        if (reason === "window-closed" || continuousLayout.inExclusive) remove();
        else continuousLayout.exclusive(`remove:${normalizeWindowUuid(window.internalId)}`, remove);
        return;
    }
    const previousSingleLayout = captureSingleColumnLayout(mainScreenState, runtimeConfig.alwaysCenterSingleColumn);
    workspaceSnapshots.removeWindow(normalizeWindowUuid(window.internalId));
    contextualWideCoordinator.cancelForWindow(window);
    const index = columnIndexForWindow(window);
    if (index < 0) return;
    cancelPendingDockScroll(reason);
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    const focusedColumn = columnStore.focusedColumn();
    const removedColumn = mainScreenState.columns[index];
    if (reason !== "window-closed") {
        const needsAccessibleGeometry = reason === "shortcut-toggle-floating" ||
            reason === "interactive-move-resize" || reason === "window-desktops-changed";
        releaseParkingOwnership(
            removedColumn.window,
            reason,
            needsAccessibleGeometry,
            index
        );
    }
    const removedGeometry = removedColumn.window.frameGeometry;
    const removedWasVisibleLeft = mainScreenState.safeRect &&
        isFullyVisibleInSafeRect(removedGeometry) &&
        removedGeometry.x + removedGeometry.width / 2 <
            mainScreenState.safeRect.x + mainScreenState.safeRect.width / 2;
    if (mainScreenState.presentation.windowUuid ===
            normalizeWindowUuid(removedColumn.window.internalId) ||
            mainScreenState.viewport.wideColumnId === removedColumn.id) {
        clearPresentationState();
    }
    const removedFocusedColumn = focusedColumn === removedColumn;
    columnStore.removeWindow(window);
    const windowState = states.get(window);
    if (windowState) {
        windowState.managedByScrollLayout = false;
        windowState.columnId = null;
        adoptionController.transition(
            window,
            windowState,
            windowState.floating ? ADOPTION_FLOATING : ADOPTION_UNTRACKED,
            `${reason}-removed`
        );
    }
    // Removal still clears ownership during a switch; activation and publication
    // wait for the final mount so a closing old window cannot switch KDE back.
    focusRingController.publish();
    if (!workspaceMountController.canUseActiveWorkspace()) return;
    if (!mainScreenState.columns.length) {
        mainScreenState.scrollOffsetX = 0;
        if (previousSingleLayout) {
            motionPlanCommitGate.cancel();
            scrollPlanCommitGate.cancel();
        }
        commitRuntimeState(reason);
        return;
    }

    recomputeLogicalLayout();
    const nextFocusedColumn = columnStore.focusedColumn();
    if (removedWasVisibleLeft && index > 0) {
        /* Keep the existing right-hand window fixed in its right slot. The
         * predecessor becomes the new left-hand window instead of shifting
         * the entire visible pair left after the left window closes. */
        mainScreenState.scrollOffsetX = oldScrollOffsetX -
            removedColumn.pixelWidth - mainScreenState.innerGap;
        clampScrollOffset();
    } else {
        ensureColumnVisible(nextFocusedColumn);
    }
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const publishedBeforeArm = relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX,
    }, undefined, previousSingleLayout);

    if (activateSuccessor && removedFocusedColumn && nextFocusedColumn &&
            workspace.activeWindow !== nextFocusedColumn.window) {
        if (runtimeConfig.alwaysCenterSingleColumn) activateColumnWhenReady(nextFocusedColumn.window);
        else workspace.activeWindow = nextFocusedColumn.window;
    }
    debug(`[cc-scroll] REMOVE_WINDOW column=${removedColumn.id}` +
        ` index=${index} focused=${removedFocusedColumn}` +
        ` next=${nextFocusedColumn ? nextFocusedColumn.id : "<none>"}` +
        ` reason=${reason}`);
    if (!publishedBeforeArm) commitRuntimeState(reason);
}

function initializeScrollLayout(previousState) {
    refreshMainScreenState();
    startupLayout.load(previousState);
    const mounted = workspaceMountController.initialize(previousState);
    if (mounted) workspace.windowList().forEach(window => {
        if (workspaceMembership.ownerId(window) !== mainScreenState.activeWorkspaceId) {
            workspaceTransferController.onWindowAdded(window);
        }
    });
    return mounted;
}

function adoptNewWindowAsColumn(window, reason, focusNew = true) {
    if (!scrollLayoutInitialized || !window) return false;
    refreshMainScreenState();
    if (!mainScreenState.enabled || !mainScreenState.targetOutput ||
            window.output !== mainScreenState.targetOutput ||
            !scrollEligible(window) || window.fullScreen ||
            columnIndexForWindow(window) >= 0) {
        return false;
    }

    const previousSingleLayout = captureSingleColumnLayout(mainScreenState, runtimeConfig.alwaysCenterSingleColumn);
    cancelPendingDockScroll(reason);
    const windowState = stateFor(window);
    if (windowState.floating || isLayoutMode(windowState.layoutMode) ||
            Number(window.maximizeMode) === FULL_MAXIMIZE_MODE ||
            isTileMode(detectQuickTileMode(window))) {
        return false;
    }

    if (focusNew && (mainScreenState.presentation.mode !== PRESENTATION_NORMAL ||
            mainScreenState.viewport.mode !== ViewportMode.PAIR)) {
        clearPresentationState();
    }

    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    const focusedIndex = mainScreenState.columns.length
        ? Math.max(0, Math.min(
            mainScreenState.focusedColumnIndex,
            mainScreenState.columns.length - 1
        ))
        : -1;
    const focusedColumn = focusedIndex >= 0
        ? mainScreenState.columns[focusedIndex]
        : null;
    const savedIndex = startupLayout.insertionIndex(
        window, mainScreenState.columns);
    const insertionIndex = savedIndex >= 0 ? savedIndex : focusNew
        ? focusedIndex + 1 : mainScreenState.columns.length;
    if (continuousLayout) parkingManager.setVisibility(window, false);
    const column = addColumnAt(window, insertionIndex, reason);
    if (!column) return false;

    if (focusNew || !focusedColumn) columnStore.focusColumn(column);
    else columnStore.focusColumn(focusedColumn);
    recomputeLogicalLayout();
    if (focusNew || !focusedColumn) ensureColumnVisible(column);
    else if (classifySingleColumnTransition(previousSingleLayout, mainScreenState) === "reindex")
        ensureColumnVisible(focusedColumn);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const publishedBeforeArm = relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX,
    }, undefined, previousSingleLayout);
    debug(`[cc-scroll] ADOPT_NEW index=${insertionIndex}` +
        ` focused=${focusNew} caption=${window.caption}`);
    if (!publishedBeforeArm) commitRuntimeState(reason);
    return true;
}

function setAdoptionPhase(window, windowState, phase, reason) {
    adoptionController.transition(window, windowState, phase, reason);
}

function settleAdoptionGeometry(window, index, reason) {
    if (continuousLayout) {
        const column = mainScreenState.columns[index];
        return { column, expected: projectedRectForColumn(column),
            settled: !continuousLayout.coordinator.gate.pending && !continuousLayout.coordinator.bootstrap &&
                sameRect(window.frameGeometry, projectedRectForColumn(column)) };
    }
    const column = mainScreenState.columns[index];
    if (runtimeConfig.alwaysCenterSingleColumn &&
            ((scrollPlanCommitGate.pending && scrollPlanCommitGate.pending.plan.windows.some(item => item.column === column)) ||
             (deferredScrollParking.pending && scrollPlanCommitGate.activeEpoch === deferredScrollParking.pending.epoch))) {
        // Adoption settling cannot cancel its own pending arm or the shared
        // Spring just because the real target frame is already configured.
        const expected = projectedRectForColumn(column);
        return { column, expected, settled: !scrollPlanCommitGate.pending && sameRect(window.frameGeometry, expected) };
    }
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    columnStore.focusIndex(index);
    recomputeLogicalLayout();
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayoutFocusedColumnTransition(
        column,
        `${reason}-settle`,
        oldScrollOffsetX,
        newScrollOffsetX
    );

    const expected = projectedRectForColumn(column);
    return {
        column,
        expected,
        settled: isFullyVisibleInSafeRect(expected) &&
            sameRect(window.frameGeometry, expected),
    };
}

function advanceWindowAdoption(window, reason) {
    return adoptionController.advance(window, reason);
}

function beginWindowAdoption(window, origin) {
    return adoptionController.begin(window, origin);
}

function onWindowActivatedForScrollLayout(window) {
    if (!window || !workspaceMountController.canUseActiveWorkspace()) return;
    if (layoutTransaction.isActive()) {
        debug(`[cc-stability] SUPPRESS activation epoch=${layoutTransaction.currentEpoch()}` +
            ` caption=${window.caption}`);
        return;
    }
    if (windowPolicy.classify(window).kind ===
            WindowDisposition.POLICY_FLOATING) {
        adoptionController.onActivated(window);
        return;
    }
    if (window !== (columnStore.focusedColumn() || {}).window) {
        contextualViewport.cancelReveal();
    }
    if (floatingController.redirectActivation(window)) return;
    adoptionController.onActivated(window);

    const index = columnIndexForWindow(window);
    if (index < 0) return;
    if (dockScrollController && dockScrollController.hasPending()) {
        cancelPendingDockScroll("window-activated");
    }
    const column = mainScreenState.columns[index];
    if (continuousLayout) {
        if (mainScreenState.presentation.mode === PRESENTATION_MAXIMIZED &&
                mainScreenState.presentation.windowUuid !== normalizeWindowUuid(window.internalId))
            return setPresentationMode(normalizeWindowUuid(window.internalId), PRESENTATION_NORMAL, "activation-exit-maximized");
        return continuousLayout.ready() && continuousLayout.controller.focusWindow(window, "activation");
    }
    const windowUuid = normalizeWindowUuid(window.internalId);
    const presentationMatches = (mainScreenState.presentation.mode ===
            PRESENTATION_MAXIMIZED &&
            mainScreenState.presentation.windowUuid === windowUuid) ||
        (mainScreenState.presentation.mode ===
        PRESENTATION_NORMAL && (mainScreenState.viewport.mode === ViewportMode.PAIR ||
        mainScreenState.viewport.wideColumnId === column.id));
    if (index === mainScreenState.focusedColumnIndex && presentationMatches) return;
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    columnStore.focusIndex(index);
    recomputeLogicalLayout();
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        "window-activated",
        oldScrollOffsetX,
        newScrollOffsetX,
        0,
        true
    );
    debug(`[cc-scroll] FOCUS_ACTIVE index=${index} caption=${window.caption}`);
    if (presentationChanged) commitRuntimeState("focus-selected-presentation");
    else publishRuntimeState("window-activated");
}

function focusRelativeColumn(delta) {
    if (continuousLayout) return continuousLayout.ready() && continuousLayout.controller.focusRelative(delta);
    const columns = mainScreenState.columns;
    if (!mainScreenState.enabled || !columns.length) return;
    cancelPendingDockScroll(delta < 0 ? "focus-previous" : "focus-next", true);
    const activeIndex = columnIndexForWindow(workspace.activeWindow);
    if (activeIndex >= 0 && !contextualWideCoordinator.isActivationDeferred() &&
            !scrollPlanCommitGate.pending) {
        columnStore.focusIndex(activeIndex);
    }
    const oldIndex = columnStore.focusedIndex();
    const focused = columns[oldIndex];
    if (focused && !focused.window.fullScreen &&
            mainScreenState.presentation.mode === PRESENTATION_NORMAL &&
            contextualViewport.enterFocusedWide(focused, delta)) {
        const offset = mainScreenState.scrollOffsetX;
        relayout("directional-focused-to-wide", {
            oldScrollOffsetX: offset,
            newScrollOffsetX: offset,
        });
        activateColumnWhenReady(focused.window);
        commitRuntimeState("directional-focused-to-wide");
        return;
    }
    contextualViewport.cancelReveal();
    const nextIndex = Math.max(0, Math.min(columns.length - 1, oldIndex + delta));
    if (nextIndex === oldIndex) return;

    columnStore.focusIndex(nextIndex);
    const column = columns[nextIndex];
    recomputeLogicalLayout();
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        delta < 0 ? "focus-previous" : "focus-next",
        oldScrollOffsetX,
        newScrollOffsetX,
        delta
    );
    /*
     * Never activate a window while its real geometry is still in the
     * off-screen parking area. KWin may compose one activation frame before
     * the following geometry transaction, which can surface on an adjacent
     * output. Commit the target's primary-screen slot first, then focus it.
     */
    activateColumnWhenReady(column.window);
    debug(`[cc-scroll] FOCUS from=${oldIndex} to=${nextIndex}`);
    if (presentationChanged) {
        commitRuntimeState(delta < 0 ? "focus-previous-presentation" :
            "focus-next-presentation");
    } else {
        publishRuntimeState(delta < 0 ? "focus-previous" : "focus-next");
    }
}

function toggleFocusWide(window) {
    if (continuousLayout) return continuousLayout.ready() && continuousLayout.controller.center(window);
    const index = columnIndexForWindow(window);
    if (!window || index < 0 || window.output !== mainScreenState.targetOutput ||
            window.fullScreen) return;
    const windowUuid = normalizeWindowUuid(window.internalId);
    const alreadyWide = mainScreenState.viewport.mode === ViewportMode.WIDE_FOCUS &&
        mainScreenState.viewport.wideColumnId === mainScreenState.columns[index].id;
    setPresentationMode(
        windowUuid,
        alreadyWide ? PRESENTATION_NORMAL : PRESENTATION_WIDE,
        alreadyWide ? "shortcut-wide-to-normal" : "shortcut-focus-wide"
    );
}

function moveFocusedColumn(delta) {
    if (continuousLayout) return continuousLayout.ready() && continuousLayout.controller.moveFocused(delta);
    return reorderController.moveFocused(delta);
}

function detachColumnToFloating(window, reason) {
    return floatingController.detach(window, reason);
}

function attachFloatingToColumns(window, reason) {
    return floatingController.attach(window, reason);
}

function rememberFloatingWindow(window, guardFocus) {
    floatingController.remember(window, guardFocus);
}

function toggleFloating(window) {
    if (continuousLayout) return v2Departure(window, "floating", () => floatingController.toggle(window));
    return floatingController.toggle(window);
}

function rectForLayout(mode, safeRect, requestedInnerGap) {
    return quickTileRect(mode, safeRect, requestedInnerGap, MAXIMIZE_MODE);
}

function detectQuickTileMode(window) {
    const relative = window.tile ? window.tile.relativeGeometry : null;
    if (!relative) return NORMAL_MODE;
    const key = [relative.x, relative.y, relative.width, relative.height]
        .map(value => Number(value).toFixed(2)).join(",");
    return ({
        "0.00,0.00,0.50,1.00": "left",
        "0.50,0.00,0.50,1.00": "right",
        "0.00,0.00,1.00,0.50": "top",
        "0.00,0.50,1.00,0.50": "bottom",
        "0.00,0.00,0.50,0.50": "topLeft",
        "0.50,0.00,0.50,0.50": "topRight",
        "0.00,0.50,0.50,0.50": "bottomLeft",
        "0.50,0.50,0.50,0.50": "bottomRight",
    })[key] || "unsupported";
}

function isTileMode(mode) {
    return mode !== NORMAL_MODE && mode !== MAXIMIZE_MODE && mode !== "unsupported";
}

function isLayoutMode(mode) {
    return mode === MAXIMIZE_MODE || isTileMode(mode);
}

function eligible(window) {
    return layoutEligibility.eligible(window);
}

function onManagedOutput(window) {
    return Boolean(window && profileForOutput(window.output));
}

function createWindowState(window) {
    const currentOpacity = Number(window.opacity);
    const inheritedParkingHidden = looksLikeInheritedParking(window);
    const currentGeometry = rectCopy(window.frameGeometry);
    return {
        pseudoMaximized: false,
        layoutMode: NORMAL_MODE,
        layoutModeBeforeFullscreen: NORMAL_MODE,
        restoreGeometry: null,
        restoreOutput: null,
        pendingAction: null,
        internalChange: false,
        interactiveMoveResize: false,
        managedByScrollLayout: false,
        columnId: null,
        workspaceOwnerId: workspaceMembership.ownerId(window),
        workspaceColumnPreference: null,
        floating: false,
        adoptionPhase: ADOPTION_UNTRACKED,
        adoptionOrigin: "",
        adoptionLastEvent: "",
        adoptionAttempts: 0,
        temporarilyMaximized: false,
        temporarilyQuickTiled: false,
        scrollOriginalOpacity: currentOpacity > 0 ? currentOpacity : 1,
        scrollVisuallyHidden: inheritedParkingHidden,
        scrollParkedByScript: inheritedParkingHidden,
        scrollParkingMinimized: inheritedParkingHidden && window.minimized,
        scrollLastVisibleGeometry: inheritedParkingHidden
            ? null
            : currentGeometry,
        scrollLastRequestedGeometry: null,
    };
}

function stateFor(window) {
    return states.ensure(window);
}

function setLayoutMode(state, mode) {
    state.layoutMode = mode;
    state.pseudoMaximized = mode === MAXIMIZE_MODE;
}

function clearLayoutState(state) {
    setLayoutMode(state, NORMAL_MODE);
    state.restoreGeometry = null;
    state.restoreOutput = null;
    state.pendingAction = null;
}

function rememberRestore(window, state, geometry) {
    if (state.restoreGeometry) return;
    state.restoreGeometry = rectCopy(geometry);
    state.restoreOutput = window.output;
    debug(`CAPTURE ${window.caption} restore=${rectText(state.restoreGeometry)}`);
}

function translateRestoreGeometry(state, newOutput) {
    if (!state.restoreGeometry || !newOutput) return;
    if (!state.restoreOutput) {
        state.restoreOutput = newOutput;
        return;
    }
    if (state.restoreOutput === newOutput) return;
    const oldScreen = state.restoreOutput.geometry;
    const newScreen = newOutput.geometry;
    state.restoreGeometry.x += newScreen.x - oldScreen.x;
    state.restoreGeometry.y += newScreen.y - oldScreen.y;
    state.restoreOutput = newOutput;
    debug(`TRANSLATE restore=${rectText(state.restoreGeometry)} output=${newOutput.name}`);
}

function applyLayoutGeometry(window, state, mode, reason) {
    const profile = profileForOutput(window.output);
    if (!profile || !eligible(window)) return false;
    const target = rectForLayout(mode, safeRectFor(window.output), profile.inner);
    if (!target) return false;
    state.internalChange = true;
    try {
        if (mode === MAXIMIZE_MODE) window.setMaximize(false, false);
        window.frameGeometry = target;
        setLayoutMode(state, mode);
        state.pendingAction = null;
    } finally {
        state.internalChange = false;
    }
    debug(`APPLY ${window.caption} reason=${reason} mode=${mode}` +
        ` geometry=${rectText(window.frameGeometry)} expected=${rectText(target)}` +
        ` restore=${rectText(state.restoreGeometry)}`);
    return sameRect(window.frameGeometry, target);
}

function leavePseudoMaximize(window, state, reason) {
    const restore = rectCopy(state.restoreGeometry);
    state.internalChange = true;
    try {
        window.setMaximize(false, false);
        if (restore) window.frameGeometry = restore;
        clearLayoutState(state);
    } finally {
        state.internalChange = false;
    }
    debug(`RESTORE ${window.caption} reason=${reason} geometry=${rectText(window.frameGeometry)}`);
}

function onPanelGeometryChanged(window) {
    if (window.dock && continuousLayout && scrollLayoutInitialized) relayout("v2-panel-area-changed");
}

function onFrameGeometryChanged(window, oldGeometry) {
    if (window.dock) return onPanelGeometryChanged(window);
    if (continuousLayout && columnStore.indexOfWindow(window) >= 0) return;
    const state = stateFor(window);
    if (!layoutEligibility.isWorkspaceReady(window)) return;
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    if (contextualWideCoordinator.onTargetGeometryChanged(window)) return;
    if (!windowPolicy.canJoinColumn(window)) return;
    if (window.output === mainScreenState.targetOutput && window.active &&
            state.adoptionPhase !== ADOPTION_UNTRACKED &&
            state.adoptionPhase !== ADOPTION_MANAGED &&
            state.adoptionPhase !== ADOPTION_FLOATING &&
            state.adoptionPhase !== ADOPTION_POLICY_FLOATING &&
            state.adoptionPhase !== ADOPTION_IGNORED) {
        adoptionController.onGeometryChanged(window);
        return;
    }
    const detectedMode = detectQuickTileMode(window);
    if (state.layoutMode === NORMAL_MODE) {
        if (isTileMode(detectedMode)) rememberRestore(window, state, oldGeometry);
        return;
    }

    /*
     * Plasma edit mode changes panel struts and KWin silently reapplies native
     * Quick Tile geometry without tileChanged/quickTileModeChanged. Correct
     * only that recognizable native-size reset; this is not a general geometry
     * enforcement path and interactive move/resize is excluded above.
     */
    if (isTileMode(state.layoutMode) && state.layoutMode === detectedMode &&
            onManagedOutput(window) && window.tile &&
            sameSizeNear(window.frameGeometry, window.tile.absoluteGeometryInScreen)) {
        const profile = profileForOutput(window.output);
        const expected = rectForLayout(
            state.layoutMode,
            safeRectFor(window.output),
            profile.inner
        );
        if (!sameRect(window.frameGeometry, expected)) {
            applyLayoutGeometry(window, state, state.layoutMode, "native-tile-geometry-reset");
        }
    }
}

function applyDetectedTile(window, signalName) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize ||
            !eligible(window)) return;
    const mode = detectQuickTileMode(window);
    const profile = profileForOutput(window.output);
    if (!profile) {
        if (isTileMode(mode)) {
            setLayoutMode(state, mode);
            debug(`NATIVE ${window.caption} mode=${mode} output=${window.output.name}`);
        } else if (mode === NORMAL_MODE && isTileMode(state.layoutMode)) {
            clearLayoutState(state);
        }
        return;
    }
    if (isTileMode(mode)) {
        applyLayoutGeometry(window, state, mode, signalName);
        return;
    }
    if (mode === NORMAL_MODE && isTileMode(state.layoutMode)) {
        if (state.pendingAction === "enterMaximize") return;
        const restore = rectCopy(state.restoreGeometry);
        state.internalChange = true;
        try {
            if (restore) window.frameGeometry = restore;
            clearLayoutState(state);
        } finally {
            state.internalChange = false;
        }
        debug(`RESTORE ${window.caption} reason=${signalName}-untile` +
            ` geometry=${rectText(window.frameGeometry)}`);
        advanceWindowAdoption(window, `${signalName}-untile`);
    }
}

function onMaximizedAboutToChange(window, mode) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize ||
            !eligible(window)) return;
    const onTarget = onManagedOutput(window);
    const managedColumn = columnIndexForWindow(window) >= 0 &&
        window.output === mainScreenState.targetOutput;
    if (Number(mode) === FULL_MAXIMIZE_MODE) {
        if (!managedColumn && state.layoutMode === NORMAL_MODE) {
            rememberRestore(window, state, window.frameGeometry);
        }
        if (onTarget && state.layoutMode === MAXIMIZE_MODE) {
            state.pendingAction = "leaveMaximize";
        } else {
            state.pendingAction = onTarget ? "enterMaximize" : "nativeMaximize";
        }
    } else if (!onTarget && state.layoutMode === MAXIMIZE_MODE) {
        state.pendingAction = "nativeRestore";
    }
}

function onMaximizedChanged(window) {
    const state = stateFor(window);
    if (state.internalChange || !state.pendingAction) return;
    if (!eligible(window)) {
        state.pendingAction = null;
        return;
    }
    const action = state.pendingAction;
    state.pendingAction = null;
    const managedColumn = columnIndexForWindow(window) >= 0 &&
        window.output === mainScreenState.targetOutput;
    if (managedColumn && action === "enterMaximize") {
        setPresentationMode(
            normalizeWindowUuid(window.internalId),
            PRESENTATION_MAXIMIZED,
            "native-maximize"
        );
        return;
    }
    if (continuousLayout && managedColumn && action === "leaveMaximize") {
        setPresentationMode(normalizeWindowUuid(window.internalId), PRESENTATION_NORMAL, "native-restore");
        return;
    }
    if (managedColumn && action === "leaveMaximize") {
        presentationController.restoreFromMaximize(
            normalizeWindowUuid(window.internalId),
            "native-restore"
        );
        return;
    }
    if (action === "enterMaximize") {
        applyLayoutGeometry(window, state, MAXIMIZE_MODE, "maximize-request");
    } else if (action === "leaveMaximize") {
        leavePseudoMaximize(window, state, "maximize-toggle");
    } else if (action === "nativeMaximize") {
        setLayoutMode(state, MAXIMIZE_MODE);
        debug(`NATIVE ${window.caption} mode=maximize output=${window.output.name}`);
    } else if (action === "nativeRestore") {
        clearLayoutState(state);
    }
    advanceWindowAdoption(window, `maximize-${action}`);
}

function onOutputChanged(window) {
    if (window.dock) return onPanelGeometryChanged(window);
    if (continuousLayout && !continuousLayout.inExclusive) return v2Departure(window, "output", () => onOutputChanged(window));
    if (!windowPolicy.canJoinColumn(window)) {
        adoptionController.onPolicyChanged(window, "output-policy-changed");
        return false;
    }
    contextualWideCoordinator.cancelForWindow(window);
    return outputController.onOutputChanged(window);
}

function onFullScreenChanged(window) {
    if (continuousLayout && columnStore.indexOfWindow(window) >= 0) return v2Departure(window, "fullscreen", () => {
        // KDE owns the fullscreen frame. Never restore a parked frame over it.
        mainScreenState.columns.forEach(c => parkingManager.release(c.window, "v2-fullscreen", !c.window.fullScreen));
        focusRingController.publish();
    });
    if (!windowPolicy.canJoinColumn(window)) return false;
    return fullscreenController.onFullscreenChanged(window);
}

function onInteractiveMoveResizeStarted(window) {
    if (continuousLayout && !continuousLayout.inExclusive) return v2Departure(window, "interactive", () => onInteractiveMoveResizeStarted(window));
    const state = stateFor(window);
    if (floatingController.onInteractiveMoveResize(window)) return;
    if (state.internalChange || !isLayoutMode(state.layoutMode)) return;
    state.interactiveMoveResize = true;
    clearLayoutState(state);
    debug(`CLEAR ${window.caption} reason=interactive-move-resize`);
}

function onWindowPolicyChanged(window, reason) {
    if (continuousLayout && !continuousLayout.inExclusive && columnStore.indexOfWindow(window) >= 0)
        return v2Departure(window, reason, () => onWindowPolicyChanged(window, reason));
    dynamicWorkspaceController.request();
    workspaceRecycleController.request();
    workspaceMountController.onWindowMembershipChanged(window);
    const state = stateFor(window);
    if (!windowPolicy.managedLayoutEligible(window) &&
            isLayoutMode(state.layoutMode)) {
        clearLayoutState(state);
    }
    return adoptionController.onPolicyChanged(window, reason);
}

function setupWindow(window) {
    if (!window || states.has(window)) return;
    const state = stateFor(window);
    const connect = (signal, handler) => app.lifecycle.connect(signal, handler, window);
    connect(window.frameGeometryChanged, oldGeometry =>
        onFrameGeometryChanged(window, oldGeometry));
    connect(window.tileChanged, () => applyDetectedTile(window, "tileChanged"));
    connect(window.quickTileModeChanged, () => applyDetectedTile(window, "quickTileModeChanged"));
    connect(window.maximizedAboutToChange, mode => onMaximizedAboutToChange(window, mode));
    connect(window.maximizedChanged, () => onMaximizedChanged(window));
    connect(window.outputChanged, () => {
        onOutputChanged(window);
        dynamicWorkspaceController.request();
        workspaceRecycleController.request();
    });
    if (window.desktopsChanged) connect(window.desktopsChanged, () => {
        if (window.dock) return onPanelGeometryChanged(window);
        if (continuousLayout) v2Departure(window, "membership", () => workspaceTransferController.onMembershipChanged(window));
        else workspaceTransferController.onMembershipChanged(window);
        dynamicWorkspaceController.request();
        workspaceRecycleController.request();
    });
    if (window.dock) {
        connect(window.hiddenChanged, () => onPanelGeometryChanged(window));
        connect(window.minimizedChanged, () => onPanelGeometryChanged(window));
    }
    connect(window.fullScreenChanged, () => onFullScreenChanged(window));
    if (window.skipTaskbarChanged) connect(window.skipTaskbarChanged, () =>
        onWindowPolicyChanged(window, "skip-taskbar-changed"));
    if (window.transientChanged) connect(window.transientChanged, () =>
        onWindowPolicyChanged(window, "transient-changed"));
    if (window.modalChanged) connect(window.modalChanged, () =>
        onWindowPolicyChanged(window, "modal-changed"));
    connect(window.activeChanged, () => {
        if (window.active && !layoutTransaction.isActive()) {
            adoptionController.onActivated(window, "active-changed");
        }
    });
    connect(window.readyForPaintingChanged, () => {
        adoptionController.onReady(window);
    });
    if (window.windowShown) {
        connect(window.windowShown, () => {
            adoptionController.onReady(window, "window-shown");
        });
    }
    connect(window.interactiveMoveResizeStarted, () => onInteractiveMoveResizeStarted(window));
    connect(window.interactiveMoveResizeFinished, () => {
        stateFor(window).interactiveMoveResize = false;
    });
    connect(window.closed, () => {
        app.lifecycle.disconnectOwner(window);
        const wasMounted = columnIndexForWindow(window) >= 0;
        workspaceTransferController.onWindowClosed(window);
        removeColumn(window, "window-closed");
        floatingController.onWindowClosed(window);
        states.delete(window);
        onPanelGeometryChanged(window);
        if (!wasMounted) workspaceTransferController.commitClosed();
        dynamicWorkspaceController.request();
        workspaceRecycleController.request();
    });

    if (!eligible(window)) return;
    if (Number(window.maximizeMode) === FULL_MAXIMIZE_MODE) {
        setLayoutMode(state, MAXIMIZE_MODE);
        if (onManagedOutput(window)) {
            applyLayoutGeometry(window, state, MAXIMIZE_MODE, "startup-adopt-maximize");
        }
        return;
    }
    const tileMode = detectQuickTileMode(window);
    if (isTileMode(tileMode)) {
        setLayoutMode(state, tileMode);
        if (onManagedOutput(window)) {
            applyLayoutGeometry(window, state, tileMode, "startup-adopt-tile");
        }
    }
}

function reapplyManagedLayouts(reason) {
    states.forEach((state, window) => {
        if (!state.internalChange && !state.interactiveMoveResize && eligible(window) &&
                !state.managedByScrollLayout && onManagedOutput(window)) {
            // An inactive secondary desktop may have been skipped at startup.
            const profile = profileForOutput(window.output);
            if (profile.role === "secondary" && state.layoutMode === NORMAL_MODE &&
                    Number(window.maximizeMode) === FULL_MAXIMIZE_MODE) {
                setLayoutMode(state, MAXIMIZE_MODE);
            }
            if (!isLayoutMode(state.layoutMode)) return;
            applyLayoutGeometry(window, state, state.layoutMode, reason);
        }
    });
}

function connectManagedGeometry() {
    managedOutputs().forEach(output => {
        if (connectedManagedOutputs.has(output)) return;
        connectedManagedOutputs.add(output);
        app.lifecycle.connect(output.geometryChanged, () => {
            if (profileForOutput(output)) {
                reapplyManagedLayouts("managed-output-geometry-changed");
                relayout("managed-output-geometry-changed");
            }
        }, output);
    });
}

function onScreensChanged() {
    if (continuousLayout && !continuousLayout.inExclusive) return continuousLayout.exclusive("screens-changed", onScreensChanged);
    connectedManagedOutputs.forEach(output => app.lifecycle.disconnectOwner(output));
    connectedManagedOutputs = new Set();
    refreshMainScreenState();
    if (continuousLayout) {
        mainScreenState.columns.slice().forEach(column => {
            if (column.window.output !== mainScreenState.targetOutput) removeColumn(column.window, "output-left-primary", false);
        });
        workspaceSwitchController.onDesktopChanged(null, null, mainScreenState.targetOutput);
    }
    connectManagedGeometry();
    reapplyManagedLayouts("screens-changed");
    relayout("screens-changed");
    focusRingController.publish();
    dynamicWorkspaceController.request();
    workspaceRecycleController.request();
}

const shortcuts = createShortcutCatalog({
    workspacePrevious: () => workspaceSwitchController.previous(),
    workspaceNext: () => workspaceSwitchController.next(),
    workspaceFocus: number => workspaceSwitchController.focusNumber(number),
    moveWorkspacePrevious: () => workspaceMoveController.movePrevious(),
    moveWorkspaceNext: () => workspaceMoveController.moveNext(),
    moveWorkspaceNumber: number => workspaceMoveController.moveNumber(number),
    focusPrevious: () => runWorkspaceAction(() => focusRelativeColumn(-1)),
    focusNext: () => runWorkspaceAction(() => focusRelativeColumn(1)),
    cycleWidth: () => runWorkspaceAction(() => columnWidthController.cycle()),
    toggleFull: () => runWorkspaceAction(() => columnWidthController.toggleFull()),
    toggleWide: () => runWorkspaceAction(() => toggleFocusWide(workspace.activeWindow)),
    moveLeft: () => runWorkspaceAction(() => moveFocusedColumn(-1)),
    moveRight: () => runWorkspaceAction(() => moveFocusedColumn(1)),
    toggleFloating: () => runWorkspaceAction(() => toggleFloating(workspace.activeWindow)),
    publishFocusRingState: () => focusRingController.publish(true),
    publishRuntimeState: () => publishRuntimeState("bridge-request"),
    applyRuntimeCommand: applyPendingRuntimeCommand,
    emergencyRestore: () => emergencyRestoreAllWindows("external-unload"),
});

const app = new CCNiri({
    controllers: controllerComposition,
    lifecycle: {
        workspace,
        setupWindow,
        onWindowAdded: window => {
            setupWindow(window);
            adoptionController.onWindowAdded(window);
            workspaceTransferController.onWindowAdded(window);
            onPanelGeometryChanged(window);
            dynamicWorkspaceController.request();
            workspaceRecycleController.request();
        },
        onWindowActivated: onWindowActivatedForScrollLayout,
        onCurrentDesktopChanged: (previous, current, output) => {
            workspaceRecycleController.onDesktopChanged();
            workspaceSwitchController.onDesktopChanged(previous, current, output);
            reapplyManagedLayouts("output-desktop-changed");
            dynamicWorkspaceController.request();
            workspaceRecycleController.request();
        },
        onDesktopsChanged: () => {
            workspaceRecycleController.onDesktopChanged();
            workspaceSwitchController.onTopologyChanged();
            dynamicWorkspaceController.request();
            workspaceRecycleController.request();
        },
        onScreensChanged,
        onVirtualScreenGeometryChanged: () => {
            reapplyManagedLayouts("virtual-screen-geometry-changed");
            relayout("virtual-screen-geometry-changed");
        },
        connectManagedGeometry,
        initializeScrollLayout,
        readPreviousState: callback => runtimeBridge.readPreviousState(callback),
        setTimer: setRuntimeTimer,
        clearTimer: clearRuntimeTimer,
        markInitialized: value => {
            scrollLayoutInitialized = value;
            if (value) {
                dynamicWorkspaceController.request();
                workspaceRecycleController.request();
            }
        },
        registerShortcut,
        shortcuts,
        commitInitialState: () => commitRuntimeState("script-start", accepted => {
            if (accepted && continuousLayout) runtimeBridge.reportRecoveryStatus(recovery.status);
        }),
    },
    onStarted: () => {
        focusRingController.start();
        debug(
            `loaded primary=${resolveTargetOutput() ? resolveTargetOutput().name : "<none>"}` +
            ` secondary=${resolveSecondaryOutput() ? resolveSecondaryOutput().name : "<none>"}` +
            ` primaryOuter=${runtimeConfig.primary.top}/${runtimeConfig.primary.right}/` +
                `${runtimeConfig.primary.bottom}/${runtimeConfig.primary.left}` +
            ` secondaryOuter=${runtimeConfig.secondary.top}/${runtimeConfig.secondary.right}/` +
                `${runtimeConfig.secondary.bottom}/${runtimeConfig.secondary.left}`
        );
    },
    onStopping: () => emergencyRestoreAllWindows("runtime-stop"),
});

app.start();
