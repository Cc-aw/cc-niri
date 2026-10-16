"use strict";

class ParkingManager {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.getState = options.getState;
        this.refreshSafeArea = options.refreshSafeArea;
        this.getSafeRect = options.getSafeRect;
        this.debug = options.debug;
        this.trackUserMinimized = options.trackUserMinimized === true;
        this.preserveClientGeometry = options.preserveClientGeometry === true;
    }

    owns(window) {
        const state = this.getState(window);
        return Boolean(state && (state.scrollParkedByScript ||
            state.scrollVisuallyHidden || state.scrollParkingMinimized || state.scrollUserMinimized));
    }

    isHidden(window) {
        const state = this.getState(window);
        return Boolean(state && state.scrollVisuallyHidden);
    }

    rememberVisibleGeometry(window, rect) {
        const state = this.stateFor(window);
        state.scrollLastVisibleGeometry = rect;
    }

    prepareGeometry(window) {
        // Minimized Wayland clients can withhold resized buffers indefinitely.
        // Keep the frame invisible while allowing its configure ACK to arrive.
        if (!window.minimized) return;
        const state = this.stateFor(window);
        if (!state.scrollParkingMinimized) state.scrollUserMinimized = true;
        this.setVisibility(window, false);
        window.minimized = false;
        state.scrollParkingMinimized = true;
    }

    setVisibility(window, visible) {
        const state = this.stateFor(window);
        if (state.scrollOriginalOpacity === null) {
            const currentOpacity = Number(window.opacity);
            state.scrollOriginalOpacity = currentOpacity > 0 ? currentOpacity : 1;
        }
        if (visible) {
            window.opacity = state.scrollOriginalOpacity;
            if (state.scrollParkingMinimized && window.minimized) {
                window.minimized = false;
            }
            state.scrollParkedByScript = false;
            state.scrollParkingMinimized = false;
            state.scrollVisuallyHidden = false;
            return;
        }
        if (this.trackUserMinimized && window.minimized && !state.scrollParkingMinimized && !state.scrollVisuallyHidden)
            state.scrollUserMinimized = true;
        window.opacity = 0;
        if (!window.minimized) {
            window.minimized = true;
            state.scrollParkingMinimized = true;
        }
        state.scrollParkedByScript = true;
        state.scrollVisuallyHidden = true;
    }

    recoveryRect(windowState, fallbackIndex, currentFrame = null) {
        this.refreshSafeArea();
        const safeRect = this.getSafeRect();
        if (!safeRect) return null;
        // V2 parks real clients on-output. Restore their accepted size instead
        // of reconfiguring to a stale size that may violate scale/size hints.
        const valid = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
        const source = valid(currentFrame) ? currentFrame : windowState.scrollLastVisibleGeometry;
        if (valid(source)) {
            const width = Math.max(1, Math.min(Number(source.width), safeRect.width));
            const height = Math.max(1, Math.min(Number(source.height), safeRect.height));
            return {
                x: Math.max(safeRect.x, Math.min(Number(source.x),
                    safeRect.x + safeRect.width - width)),
                y: Math.max(safeRect.y, Math.min(Number(source.y),
                    safeRect.y + safeRect.height - height)),
                width,
                height,
            };
        }
        const cascade = Math.max(0, Number(fallbackIndex) || 0) * 24;
        const width = Math.max(1, Math.floor(safeRect.width * 0.72));
        const height = Math.max(1, Math.floor(safeRect.height * 0.82));
        return {
            x: safeRect.x + Math.min(cascade, Math.max(0, safeRect.width - width)),
            y: safeRect.y + Math.min(cascade, Math.max(0, safeRect.height - height)),
            width,
            height,
        };
    }

    release(window, reason, ensureAccessible = false, fallbackIndex = 0, observe = null) {
        const state = this.getState(window);
        if (!this.owns(window)) return false;
        let target = null;
        if (ensureAccessible && !window.fullScreen && !state.scrollUserMinimized) {
            target = this.recoveryRect(state, fallbackIndex, this.preserveClientGeometry ? window.frameGeometry : null);
            if (target) {
                state.internalChange = true;
                try {
                    window.frameGeometry = target;
                } finally {
                    state.internalChange = false;
                }
            }
        }
        window.opacity = state.scrollOriginalOpacity;
        if (state.scrollUserMinimized) window.minimized = true;
        else if (state.scrollParkingMinimized && window.minimized) {
            window.minimized = false;
        }
        state.scrollUserMinimized = false;
        state.scrollParkedByScript = false;
        state.scrollParkingMinimized = false;
        state.scrollVisuallyHidden = false;
        if (observe) observe({ window, target, opacity: Number(window.opacity), minimized: window.minimized });
        this.debug(`[cc-stability] RELEASE_PARKING caption=${window.caption}` +
            ` accessible=${ensureAccessible} reason=${reason}`);
        return true;
    }
}

/* cjs:start */
module.exports = { ParkingManager };
/* cjs:end */
