"use strict";

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

function shouldEnterWide(column, intent) {
    return Boolean(column && column.persistentWide && intent &&
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
        if (!column || !column.persistentWide) return false;
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
        return column && column.persistentWide
            ? this.wide(column) : this.pair();
    }

    column() {
        const state = this.appState.viewport;
        if (!state || state.mode !== ViewportMode.WIDE_FOCUS) return null;
        const column = this.appState.columns.find(item =>
            item.id === state.wideColumnId) || null;
        if (!column || !column.persistentWide) {
            this.pair();
            return null;
        }
        return column;
    }

    select(column, intent) {
        if (!shouldEnterWide(column, intent)) {
            const changed = this.pair();
            if (column && column.persistentWide && intent &&
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
                pending.direction !== direction || !column.persistentWide ||
                this.appState.columns.indexOf(column) < 0 ||
                this.appState.viewport.mode !== ViewportMode.PAIR ||
                this.appState.scrollOffsetX !== pending.scrollOffsetX) return false;
        return this.wide(column);
    }

    enterFocusedWide(column, direction) {
        if (this.pendingReveal) return this.confirmReveal(column, direction);
        const armed = this.pendingFocusedWide === column;
        this.pendingFocusedWide = null;
        if (!armed || !column || !column.persistentWide ||
                this.appState.columns.indexOf(column) < 0 ||
                this.appState.viewport.mode !== ViewportMode.PAIR) return false;
        return this.wide(column);
    }
}

/* cjs:start */
module.exports = { ContextualViewport, ViewportMode, FocusSource, shouldEnterWide };
/* cjs:end */
