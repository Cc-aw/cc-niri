"use strict";

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

/* cjs:start */
module.exports = { StartupLayout };
/* cjs:end */
