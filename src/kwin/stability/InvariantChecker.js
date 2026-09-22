"use strict";

class InvariantChecker {
    constructor(options) {
        this.appState = options.appState;
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
        let expectedLogicalX = 0;

        columns.forEach((column, index) => {
            const uuid = this.normalizeUuid(column.window.internalId);
            if (windows.has(column.window)) errors.push(`duplicate-window:${index}`);
            windows.add(column.window);
            if (!uuid || uuids.has(uuid)) errors.push(`duplicate-uuid:${uuid || index}`);
            uuids.add(uuid);
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
            if (this.appState.targetOutput &&
                    column.window.output !== this.appState.targetOutput) {
                errors.push(`wrong-output:${column.id}`);
            }
            expectedLogicalX += column.pixelWidth + this.appState.innerGap;
        });

        if (!columns.length) {
            if (this.appState.focusedColumnIndex !== -1) errors.push("empty-focus");
        } else if (this.appState.focusedColumnIndex < 0 ||
                this.appState.focusedColumnIndex >= columns.length) {
            errors.push(`focus-index:${this.appState.focusedColumnIndex}`);
        }

        const maximumOffset = Math.max(0, this.stripWidth() -
            (this.appState.safeRect ? this.appState.safeRect.width : 0));
        if (this.appState.scrollOffsetX < 0 ||
                this.appState.scrollOffsetX > maximumOffset) {
            errors.push(`scroll-offset:${this.appState.scrollOffsetX}:${maximumOffset}`);
        }

        const presentation = this.appState.presentation;
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

/* cjs:start */
module.exports = { InvariantChecker };
/* cjs:end */
