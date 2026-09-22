"use strict";

class ReorderController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.rejectDockCommand = options.rejectDockCommand;
        this.cancelDockScroll = options.cancelDockScroll;
        this.getFocusedColumn = options.getFocusedColumn;
        this.reorderColumns = options.reorderColumns;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.ensureColumnVisible = options.ensureColumnVisible;
        this.relayout = options.relayout;
        this.getGeneration = options.getGeneration;
        this.commitDockState = options.commitDockState;
        this.getActiveWindow = options.getActiveWindow;
        this.indexOfWindow = options.indexOfWindow;
        this.focusIndex = options.focusIndex;
        this.focusedIndex = options.focusedIndex;
        this.moveFocusedColumn = options.moveFocusedColumn;
        this.debug = options.debug;
    }

    applyDockCommand(command) {
        if (!Array.isArray(command.order)) {
            this.rejectDockCommand("invalid-column-order");
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
            this.rejectDockCommand("invalid-column-set");
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
        this.commitDockState("dock-reorder");
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
        this.commitDockState(reason);
        return true;
    }
}

/* cjs:start */
module.exports = { ReorderController };
/* cjs:end */
