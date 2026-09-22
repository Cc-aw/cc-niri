"use strict";

class AdoptionController {
    constructor(options) {
        this.phases = options.phases;
        this.stateFor = options.stateFor;
        this.hasState = options.hasState;
        this.indexOfWindow = options.indexOfWindow;
        this.getAppState = options.getAppState;
        this.refreshAppState = options.refreshAppState;
        this.isPlasmaShellWindow = options.isPlasmaShellWindow;
        this.isLayoutMode = options.isLayoutMode;
        this.isTileMode = options.isTileMode;
        this.detectQuickTileMode = options.detectQuickTileMode;
        this.fullMaximizeMode = options.fullMaximizeMode;
        this.scrollEligible = options.scrollEligible;
        this.adoptWindow = options.adoptWindow;
        this.settleLayout = options.settleLayout;
        this.rectText = options.rectText;
        this.debug = options.debug;
    }

    transition(window, windowState, phase, reason) {
        const previous = windowState.adoptionPhase;
        windowState.adoptionPhase = phase;
        windowState.adoptionLastEvent = reason;
        if (previous !== phase) {
            this.debug(`[cc-adoption] PHASE ${previous}->${phase}` +
                ` caption=${window.caption} reason=${reason}`);
        }
    }

    waitPhase(window, windowState) {
        const state = this.getAppState();
        if (this.isPlasmaShellWindow(window)) return this.phases.ignored;
        if (windowState.floating) return this.phases.floating;
        if (!state.enabled || !state.targetOutput ||
                window.output !== state.targetOutput) {
            return this.phases.waitingPrimary;
        }
        if (window.fullScreen || this.isLayoutMode(windowState.layoutMode) ||
                Number(window.maximizeMode) === this.fullMaximizeMode ||
                this.isTileMode(this.detectQuickTileMode(window))) {
            return this.phases.waitingNormal;
        }
        if (!this.scrollEligible(window)) return this.phases.waitingEligible;
        if (!window.active) return this.phases.waitingActivation;
        return null;
    }

    settle(window, windowState, reason) {
        const index = this.indexOfWindow(window);
        if (index < 0) {
            this.transition(window, windowState, this.phases.waitingEligible,
                `${reason}-missing-column`);
            return false;
        }
        if (!window.active) {
            this.transition(window, windowState, this.phases.managed,
                `${reason}-inactive-after-adopt`);
            return true;
        }
        const result = this.settleLayout(window, index, reason);
        if (result.settled) {
            this.transition(window, windowState, this.phases.managed, reason);
            this.debug(`[cc-scroll] ADOPT_SETTLED column=${result.column.id}` +
                ` caption=${window.caption} geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }
        this.transition(window, windowState, this.phases.settling, reason);
        this.debug(`[cc-scroll] ADOPT_PENDING column=${result.column.id}` +
            ` caption=${window.caption} actual=${this.rectText(window.frameGeometry)}` +
            ` expected=${this.rectText(result.expected)} reason=${reason}`);
        return false;
    }

    advance(window, reason) {
        if (!window || !this.hasState(window)) return false;
        const windowState = this.stateFor(window);
        if (windowState.adoptionPhase === this.phases.managed) {
            return this.indexOfWindow(window) >= 0;
        }
        if (windowState.adoptionPhase === this.phases.floating ||
                windowState.adoptionPhase === this.phases.ignored) return false;
        if (windowState.adoptionPhase === this.phases.settling &&
                this.indexOfWindow(window) >= 0) {
            return this.settle(window, windowState, reason);
        }
        if (windowState.adoptionPhase === this.phases.untracked) return false;

        this.refreshAppState();
        const waitPhase = this.waitPhase(window, windowState);
        if (waitPhase) {
            this.transition(window, windowState, waitPhase, reason);
            return false;
        }

        this.transition(window, windowState, this.phases.adopting, reason);
        windowState.adoptionAttempts += 1;
        this.transition(window, windowState, this.phases.settling, reason);
        if (!this.adoptWindow(window, reason, true)) {
            this.transition(window, windowState, this.phases.waitingEligible,
                `${reason}-adopt-rejected`);
            return false;
        }
        return this.settle(window, windowState, reason);
    }

    begin(window, origin) {
        if (!window) return false;
        const windowState = this.stateFor(window);
        if (windowState.managedByScrollLayout || this.indexOfWindow(window) >= 0) {
            this.transition(window, windowState, this.phases.managed, origin);
            return true;
        }
        if (windowState.floating) {
            this.transition(window, windowState, this.phases.floating, origin);
            return false;
        }
        windowState.adoptionOrigin = origin;
        this.transition(window, windowState, this.phases.waitingEligible, origin);
        return this.advance(window, origin);
    }

    onWindowAdded(window) {
        return this.begin(window, "window-added");
    }

    onActivated(window, reason = "window-activated-after-add") {
        return this.advance(window, reason);
    }

    onReady(window, reason = "ready-for-painting") {
        return this.advance(window, reason);
    }

    onGeometryChanged(window, reason = "pending-geometry-changed") {
        return this.advance(window, reason);
    }

    onOutputChanged(window, reason = "output-entered-primary") {
        return this.advance(window, reason);
    }

    onFullscreenChanged(window, reason = "fullscreen-exit") {
        return this.advance(window, reason);
    }
}

/* cjs:start */
module.exports = { AdoptionController };
/* cjs:end */
