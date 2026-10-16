"use strict";

/* cjs:start */
const { normalizeColumnWidthMode, normalizePreviousNonFullWidthMode } = require("../model/ColumnStore");
/* cjs:end */

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

/* cjs:start */
module.exports = { WorkspaceSnapshotStore, normalizeWorkspaceSnapshot, migrateLegacyWorkspaceSnapshot,
    normalizeWorkspaceWidthV2, workspaceColumnPreference, normalizeViewportAnchorV2 };
/* cjs:end */
