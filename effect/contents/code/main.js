/* SPDX-License-Identifier: MIT
 * Visual transitions for the V3 scrolling-column geometry writer.
 */

"use strict";

const SAFE_RIGHT_EDGE_SLIDE_X = 20;

class CCNiriScrollTransition {
    constructor() {
        this.pendingDeltaX = null;
        this.loadConfig();
        effect.configChanged.connect(this.loadConfig.bind(this));
        effect.animationEnded.connect(window => {
            if (window.ccNiriScrollAnimation) delete window.ccNiriScrollAnimation;
        });
        effects.windowAdded.connect(this.manage.bind(this));
        for (const window of effects.stackingOrder) this.manage(window);
    }

    loadConfig() {
        this.targetOutputName = String(effect.readConfig("TargetOutputName", "DP-1"));
        this.innerGap = Math.max(0, Number(effect.readConfig("InnerGap", 8)) || 0);
        this.duration = animationTime(
            Math.max(1, Number(effect.readConfig("Duration", 180)) || 180)
        );
        this.debugLogging = Boolean(effect.readConfig("DebugLogging", false));
    }

    manage(window) {
        window.windowFrameGeometryChanged.connect(this.geometryChanged.bind(this));
    }

    sameSize(a, b) {
        return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    }

    isColumnSize(rect, screenRect) {
        return rect.width > screenRect.width * 0.35 &&
            rect.width < screenRect.width * 0.65 &&
            rect.height > screenRect.height * 0.75;
    }

    visibleSlot(rect, screenRect) {
        if (!this.isColumnSize(rect, screenRect) ||
                rect.x < screenRect.x || rect.y < screenRect.y ||
                rect.x + rect.width > screenRect.x + screenRect.width ||
                rect.y + rect.height > screenRect.y + screenRect.height) {
            return null;
        }
        const center = rect.x + rect.width / 2;
        return center < screenRect.x + screenRect.width / 2 ? "left" : "right";
    }

    parked(rect, screenRect) {
        return this.isColumnSize(rect, screenRect) &&
            rect.x + rect.width < screenRect.x;
    }

    debug(message) {
        if (this.debugLogging) {
            console.info(`[cc-niri-scroll-transition] ${message}`);
        }
    }

    geometryChanged(window, oldGeometry) {
        if (!window.screen || window.screen.name !== this.targetOutputName ||
                !this.sameSize(oldGeometry, window.geometry)) {
            return;
        }
        const screenRect = window.screen.geometry;
        const newGeometry = window.geometry;
        const oldSlot = this.visibleSlot(oldGeometry, screenRect);
        const newSlot = this.visibleSlot(newGeometry, screenRect);
        const oldParked = this.parked(oldGeometry, screenRect);
        const newParked = this.parked(newGeometry, screenRect);
        if (!(oldSlot || oldParked) || !(newSlot || newParked) ||
                Math.abs(oldGeometry.x - newGeometry.x) < 1) {
            return;
        }

        if (window.ccNiriScrollAnimation) {
            cancel(window.ccNiriScrollAnimation);
            delete window.ccNiriScrollAnimation;
        }

        let animations;
        if (oldSlot && newSlot) {
            /*
             * Script commits the continuing column first. Both coordinates
             * are projections, never parking coordinates, so this is exactly
             * oldProjectedX - newProjectedX == scrollDeltaX.
             */
            this.pendingDeltaX = oldGeometry.x - newGeometry.x;
            animations = [{
                type: Effect.Translation,
                from: { value1: this.pendingDeltaX, value2: 0 },
                to: { value1: 0, value2: 0 }
            }];
            this.debug(`ARM delta=${this.pendingDeltaX}` +
                ` oldProjectedX=${oldGeometry.x} newProjectedX=${newGeometry.x}`);
        } else if (oldParked && newSlot) {
            if (this.pendingDeltaX === null) return;
            if (this.pendingDeltaX > 0) {
                /*
                 * Preserve L's right-to-left direction without ever entering
                 * the adjacent output. The primary safe area leaves 24 px on
                 * the right, so a 20 px in-slot reveal remains on DP-1.
                 */
                animations = [{
                    type: Effect.Translation,
                    from: { value1: SAFE_RIGHT_EDGE_SLIDE_X, value2: 0 },
                    to: { value1: 0, value2: 0 }
                }, {
                    type: Effect.Scale,
                    sourceAnchor: Effect.Right,
                    targetAnchor: Effect.Right,
                    from: { value1: 0.94, value2: 1 },
                    to: { value1: 1, value2: 1 }
                }, {
                    type: Effect.Opacity,
                    from: 0.2,
                    to: 1.0
                }];
                this.debug(`INCOMING_RIGHT_SAFE delta=${this.pendingDeltaX}` +
                    ` newProjectedX=${newGeometry.x}`);
            } else {
                animations = [{
                    type: Effect.Translation,
                    from: { value1: this.pendingDeltaX, value2: 0 },
                    to: { value1: 0, value2: 0 }
                }];
                this.debug(`INCOMING delta=${this.pendingDeltaX}` +
                    ` newProjectedX=${newGeometry.x}`);
            }
        } else if (oldSlot && newParked) {
            if (this.pendingDeltaX === null) return;
            const oldProjectedX = oldGeometry.x;
            const newProjectedX = oldProjectedX - this.pendingDeltaX;
            if (this.pendingDeltaX < 0) {
                /* Move only inside the 24 px primary right margin, then fade
                 * to its already-committed parking geometry. */
                const holdX = oldGeometry.x - newGeometry.x;
                animations = [{
                    type: Effect.Translation,
                    from: { value1: holdX, value2: 0 },
                    to: { value1: holdX + SAFE_RIGHT_EDGE_SLIDE_X, value2: 0 }
                }, {
                    type: Effect.Opacity,
                    from: 1.0,
                    to: 0.0
                }];
                this.debug(`OUTGOING_RIGHT_SAFE delta=${this.pendingDeltaX}` +
                    ` holdProjectedX=${oldProjectedX}`);
            } else {
                animations = [{
                    type: Effect.Translation,
                    from: { value1: oldGeometry.x - newGeometry.x, value2: 0 },
                    to: { value1: newProjectedX - newGeometry.x, value2: 0 }
                }];
                this.debug(`OUTGOING delta=${this.pendingDeltaX}` +
                    ` oldProjectedX=${oldProjectedX} newProjectedX=${newProjectedX}`);
            }
            this.pendingDeltaX = null;
        } else {
            return;
        }

        window.ccNiriScrollAnimation = animate({
            window,
            duration: this.duration,
            curve: QEasingCurve.OutCubic,
            animations
        });
    }
}

new CCNiriScrollTransition();
