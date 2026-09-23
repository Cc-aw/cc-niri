"use strict";

class FullscreenController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.getAppState = options.getAppState;
        this.viewport = options.viewport;
        this.indexOfWindow = options.indexOfWindow;
        this.relayout = options.relayout;
        this.onManagedOutput = options.onManagedOutput;
        this.isLayoutMode = options.isLayoutMode;
        this.applyLayoutGeometry = options.applyLayoutGeometry;
        this.advanceAdoption = options.advanceAdoption;
        this.normalMode = options.normalMode;
        this.debug = options.debug;
    }

    onFullscreenChanged(window) {
        const state = this.stateFor(window);
        if (state.internalChange) return false;

        if (window.fullScreen) {
            this.viewport.cancelReveal();
            state.layoutModeBeforeFullscreen = state.layoutMode;
            const appState = this.getAppState ? this.getAppState() : null;
            state.viewportBeforeFullscreen = appState && appState.viewport
                ? Object.assign({}, appState.viewport) : null;
            this.debug(`FULLSCREEN enter ${window.caption} prior=${state.layoutMode}`);
            return true;
        }

        const prior = state.layoutModeBeforeFullscreen;
        state.layoutModeBeforeFullscreen = this.normalMode;
        if (this.indexOfWindow(window) >= 0) {
            const previous = state.viewportBeforeFullscreen;
            if (previous) this.viewport.restore(previous);
            state.viewportBeforeFullscreen = null;
            this.relayout("fullscreen-exit");
        } else if (this.onManagedOutput(window) && this.isLayoutMode(prior)) {
            state.viewportBeforeFullscreen = null;
            this.applyLayoutGeometry(window, state, prior, "fullscreen-exit");
        } else {
            state.viewportBeforeFullscreen = null;
            this.advanceAdoption(window, "fullscreen-exit");
        }
        return true;
    }
}

/* cjs:start */
module.exports = { FullscreenController };
/* cjs:end */
