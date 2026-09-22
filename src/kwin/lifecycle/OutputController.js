"use strict";

class OutputController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.indexOfWindow = options.indexOfWindow;
        this.resolvePrimaryOutput = options.resolvePrimaryOutput;
        this.clearPresentationForWindow = options.clearPresentationForWindow;
        this.removeColumn = options.removeColumn;
        this.transitionAdoption = options.transitionAdoption;
        this.phases = options.phases;
        this.profileForOutput = options.profileForOutput;
        this.translateRestoreGeometry = options.translateRestoreGeometry;
        this.fullMaximizeMode = options.fullMaximizeMode;
        this.maximizeMode = options.maximizeMode;
        this.applyLayoutGeometry = options.applyLayoutGeometry;
        this.detectQuickTileMode = options.detectQuickTileMode;
        this.isTileMode = options.isTileMode;
        this.applyDetectedTile = options.applyDetectedTile;
        this.beginAdoption = options.beginAdoption;
        this.advanceAdoption = options.advanceAdoption;
        this.setLayoutMode = options.setLayoutMode;
        this.rectText = options.rectText;
        this.debug = options.debug;
    }

    onOutputChanged(window) {
        const state = this.stateFor(window);
        if (state.internalChange || state.interactiveMoveResize || window.fullScreen) {
            return false;
        }

        const primary = this.resolvePrimaryOutput();
        if (this.indexOfWindow(window) >= 0 && window.output !== primary) {
            this.clearPresentationForWindow(window);
            this.removeColumn(window, "output-left-primary", false);
            this.transitionAdoption(
                window,
                state,
                this.phases.waitingPrimary,
                "output-left-primary"
            );
            this.debug(`[cc-scroll] LEAVE_PRIMARY caption=${window.caption}` +
                ` output=${this.outputName(window.output)}`);
            return true;
        }

        if (window.output !== primary &&
                state.adoptionPhase !== this.phases.untracked &&
                state.adoptionPhase !== this.phases.floating &&
                state.adoptionPhase !== this.phases.ignored) {
            this.transitionAdoption(
                window,
                state,
                this.phases.waitingPrimary,
                "output-wait-primary"
            );
        }

        const profile = this.profileForOutput(window.output);
        this.translateRestoreGeometry(state, window.output);
        if (profile) {
            if (Number(window.maximizeMode) === this.fullMaximizeMode ||
                    state.layoutMode === this.maximizeMode) {
                this.applyLayoutGeometry(
                    window,
                    state,
                    this.maximizeMode,
                    "output-adopt-maximize"
                );
            } else if (this.isTileMode(this.detectQuickTileMode(window))) {
                this.applyDetectedTile(window, "output-adopt-tile");
            } else if (window.output === primary) {
                if (state.adoptionPhase === this.phases.untracked) {
                    this.beginAdoption(window, "output-entered-primary");
                } else {
                    this.advanceAdoption(window, "output-entered-primary");
                }
            }
            return true;
        }

        if (state.layoutMode === this.maximizeMode &&
                Number(window.maximizeMode) !== this.fullMaximizeMode) {
            state.internalChange = true;
            try {
                window.setMaximize(true, true);
            } finally {
                state.internalChange = false;
            }
            this.debug(`NATIVE-TRANSFER ${window.caption} mode=maximize` +
                ` output=${this.outputName(window.output)}` +
                ` geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }

        const tileMode = this.detectQuickTileMode(window);
        if (this.isTileMode(tileMode)) {
            this.setLayoutMode(state, tileMode);
            this.debug(`NATIVE-TRANSFER ${window.caption} mode=${tileMode}` +
                ` output=${this.outputName(window.output)}` +
                ` geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }
        return false;
    }

    outputName(output) {
        return output ? output.name : "<none>";
    }
}

/* cjs:start */
module.exports = { OutputController };
/* cjs:end */
