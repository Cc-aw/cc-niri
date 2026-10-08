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

function normalizeWorkspaceSnapshot(workspaceId, snapshot) {
    const id = workspaceSnapshotId(workspaceId);
    if (!id) throw new TypeError("workspaceId must be a non-empty stable ID");
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const seen = new Set();
    const columns = [];
    for (const column of Array.isArray(source.columns) ? source.columns : []) {
        const uuid = workspaceSnapshotUuid(column && column.uuid);
        if (!uuid || seen.has(uuid)) continue;
        seen.add(uuid);
        const widthMode = normalizeColumnWidthMode(column.widthMode);
        columns.push({
            uuid,
            widthMode,
            previousNonFullWidthMode: normalizePreviousNonFullWidthMode(
                column.previousNonFullWidthMode, widthMode),
            persistentWide: column.persistentWide === true,
        });
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
        column && ["third", "twoThirds"].includes(column.widthMode));
    const viewport = source.viewport || {};
    const wideUuid = member(viewport.wideUuid);
    const wide = ["wide", "wide-focus"].includes(viewport.mode) && wideUuid;
    const presentation = source.presentation || {};
    const windowUuid = member(presentation.windowUuid);
    const presented = ["wide", "maximized"].includes(presentation.mode) && windowUuid;
    return {
        workspaceId: id, columns,
        focusedUuid: member(source.focusedUuid),
        viewportAnchor: validAnchor ? { uuid: anchorUuid, delta: migratedWidths ? 0 : anchor.delta } : null,
        viewport: { mode: wide ? "wide" : "pair", wideUuid: wide ? wideUuid : null },
        presentation: {
            mode: presented ? presentation.mode : "normal",
            windowUuid: presented ? windowUuid : null,
        },
    };
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
module.exports = { WorkspaceSnapshotStore, normalizeWorkspaceSnapshot, migrateLegacyWorkspaceSnapshot };
/* cjs:end */
