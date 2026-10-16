"use strict";

// Legacy saved order for late arrivals only. WorkspaceMountController owns
// startup membership and viewport restoration for the active workspace.
class StartupLayout {
    constructor(options) {
        this.normalizeUuid = options.normalizeUuid;
        this.targetOutput = options.targetOutput;
        this.savedOrder = [];
    }

    load(json) {
        this.savedOrder = [];
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
        return true;
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
}

/* cjs:start */
module.exports = { StartupLayout };
/* cjs:end */
