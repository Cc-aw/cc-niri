"use strict";

class FloatingController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.hasState = options.hasState;
        this.indexOfWindow = options.indexOfWindow;
        this.getAppState = options.getAppState;
        this.refreshAppState = options.refreshAppState;
        this.scrollEligible = options.scrollEligible;
        this.prepareWindow = options.prepareWindow;
        this.adoptWindow = options.adoptWindow;
        this.removeColumn = options.removeColumn;
        this.transitionAdoption = options.transitionAdoption;
        this.floatingPhase = options.floatingPhase;
        this.settlingPhase = options.settlingPhase;
        this.managedPhase = options.managedPhase;
        this.getActiveWindow = options.getActiveWindow;
        this.setActiveWindow = options.setActiveWindow;
        this.rectText = options.rectText;
        this.debug = options.debug;
        this.warn = options.warn;
        this.now = options.now;
        this.focusGuardMs = options.focusGuardMs;
        this.rememberedWindow = null;
        this.detachedAt = 0;
        this.focusGuardUntil = 0;
    }

    detach(window, reason) {
        const index = this.indexOfWindow(window);
        if (!window || index < 0) return false;
        const windowState = this.stateFor(window);
        windowState.floating = true;
        this.transitionAdoption(window, windowState, this.floatingPhase, reason);
        this.removeColumn(window, reason, false);
        if (window.minimized) window.minimized = false;
        if (this.getActiveWindow() !== window) this.setActiveWindow(window);
        this.debug(`[cc-scroll] FLOAT caption=${window.caption}` +
            ` geometry=${this.rectText(window.frameGeometry)} reason=${reason}`);
        return true;
    }

    attach(window, reason) {
        if (!window || window.fullScreen) return false;
        this.refreshAppState();
        const appState = this.getAppState();
        if (!appState.enabled || !appState.targetOutput ||
                window.output !== appState.targetOutput ||
                !this.scrollEligible(window) || this.indexOfWindow(window) >= 0) {
            return false;
        }
        const windowState = this.stateFor(window);
        if (!this.prepareWindow(window)) {
            this.warn(`[cc-scroll] MANAGE rejected caption=${window.caption}` +
                ` reason=layout-detach-failed`);
            return false;
        }
        windowState.floating = false;
        this.transitionAdoption(window, windowState, this.settlingPhase, reason);
        if (!this.adoptWindow(window, reason, true)) {
            windowState.floating = true;
            this.transitionAdoption(
                window,
                windowState,
                this.floatingPhase,
                `${reason}-rollback`
            );
            return false;
        }
        this.transitionAdoption(window, windowState, this.managedPhase, reason);
        this.debug(`[cc-scroll] MANAGE caption=${window.caption}` +
            ` geometry=${this.rectText(window.frameGeometry)} reason=${reason}`);
        return true;
    }

    remember(window, guardFocus) {
        this.rememberedWindow = window;
        this.detachedAt = this.now();
        this.focusGuardUntil = guardFocus
            ? this.detachedAt + this.focusGuardMs
            : 0;
        this.debug(`[cc-scroll] REMEMBER_FLOAT caption=${window.caption}` +
            ` guard=${guardFocus}`);
    }

    hasRememberedFloating() {
        return Boolean(this.rememberedWindow &&
            this.hasState(this.rememberedWindow) &&
            this.stateFor(this.rememberedWindow).floating &&
            this.indexOfWindow(this.rememberedWindow) < 0);
    }

    toggle(window) {
        const rememberedFloating = this.hasRememberedFloating();
        let target = window;
        if (rememberedFloating && target !== this.rememberedWindow) {
            target = this.rememberedWindow;
        }
        if (!target) return false;
        if (this.indexOfWindow(target) >= 0) {
            if (this.detach(target, "shortcut-toggle-floating")) {
                this.remember(target, true);
                this.setActiveWindow(target);
                return true;
            }
            return false;
        }
        if (this.attach(target, "shortcut-toggle-managed") &&
                target === this.rememberedWindow) {
            this.clearRemembered();
            return true;
        }
        return false;
    }

    redirectActivation(window) {
        if (this.rememberedWindow && this.now() <= this.focusGuardUntil &&
                this.hasState(this.rememberedWindow) &&
                this.stateFor(this.rememberedWindow).floating &&
                window !== this.rememberedWindow) {
            this.setActiveWindow(this.rememberedWindow);
            return true;
        }
        if (this.now() > this.focusGuardUntil) this.focusGuardUntil = 0;
        return false;
    }

    onInteractiveMoveResize(window) {
        if (this.indexOfWindow(window) < 0) return false;
        const state = this.stateFor(window);
        state.interactiveMoveResize = true;
        if (this.detach(window, "interactive-move-resize")) {
            this.remember(window, false);
        }
        return true;
    }

    onWindowClosed(window) {
        if (window === this.rememberedWindow) this.clearRemembered();
    }

    clearRemembered() {
        this.rememberedWindow = null;
        this.detachedAt = 0;
        this.focusGuardUntil = 0;
    }
}

/* cjs:start */
module.exports = { FloatingController };
/* cjs:end */
