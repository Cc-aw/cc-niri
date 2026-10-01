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

    restore(previousState, currentId, targetOutput) {
        let source = previousState;
        if (typeof source === "string") {
            try { source = JSON.parse(source); } catch (_) { return false; }
        }
        const candidate = new WorkspaceSnapshotStore();
        if (!source || source.targetOutput !== targetOutput) return false;
        try {
            if (source.protocol === 1) {
                const legacy = migrateLegacyWorkspaceSnapshot(source, currentId, targetOutput);
                if (!legacy) return false;
                candidate.set(currentId, legacy);
            } else if (source.protocol === 2) {
                if (!Array.isArray(source.workspaces) || !this.validColumns(source.columns) ||
                        typeof source.workspaceId !== "string" || !source.workspaceId.trim()) return false;
                const ids = new Set();
                for (const workspace of source.workspaces) {
                    const id = workspace && typeof workspace.id === "string" ? workspace.id.trim() : "";
                    if (!id || ids.has(id) || !this.validColumns(workspace.columns)) return false;
                    ids.add(id);
                    candidate.set(id, workspace); // Reject conflicting UUID owners before committing.
                }
                const active = candidate.get(source.workspaceId);
                const columns = normalizeWorkspaceSnapshot("validation", source).columns;
                if (!active || columns.length !== active.columns.length || columns.some((column, index) =>
                    column.uuid !== active.columns[index].uuid || column.widthMode !== active.columns[index].widthMode)) return false;
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
