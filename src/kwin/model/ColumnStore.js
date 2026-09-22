"use strict";

class ColumnStore {
    constructor(state) {
        this.state = state;
    }

    indexOf(column) {
        return this.state.columns.indexOf(column);
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

    insertWindow(window, insertionIndex, widthMode) {
        if (this.indexOfWindow(window) >= 0) return null;
        const column = {
            id: this.state.nextColumnId++,
            window,
            widthMode,
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

/* cjs:start */
module.exports = { ColumnStore };
/* cjs:end */
