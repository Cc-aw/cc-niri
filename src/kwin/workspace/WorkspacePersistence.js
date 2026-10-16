"use strict";

/* cjs:start */
const { WorkspaceSnapshotStore, normalizeWorkspaceSnapshot, migrateLegacyWorkspaceSnapshot } = require("./WorkspaceSnapshotStore");
/* cjs:end */

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

/* cjs:start */
module.exports = { WorkspacePersistence };
/* cjs:end */
