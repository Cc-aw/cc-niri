/* Temporary coexistence POC for the third-party Geometry Change effect. */

"use strict";

const TAG = "[cc-niri-v3-scroll-transition-poc]";
const TARGET_OUTPUT = "DP-1";
const DURATION_MS = 250;
const SAFE_SLIDE_X = 20;

class ScrollTransitionPOC {
    constructor() {
        this.pendingDeltaX = null;
        effect.animationEnded.connect(window => {
            if (window.ccNiriLRevealAnimation) {
                delete window.ccNiriLRevealAnimation;
            }
        });
        effects.windowAdded.connect(this.manage.bind(this));
        for (const window of effects.stackingOrder) this.manage(window);
        console.info(`${TAG} loaded: L uses safe in-slot motion; H is untouched`);
    }

    manage(window) {
        window.windowFrameGeometryChanged.connect(this.geometryChanged.bind(this));
    }

    sameSize(a, b) {
        return Math.abs(a.width - b.width) < 1 &&
            Math.abs(a.height - b.height) < 1;
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

    geometryChanged(window, oldGeometry) {
        if (!window.screen || window.screen.name !== TARGET_OUTPUT ||
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

        if (oldSlot && newSlot) {
            // The script commits the continuing column first. Positive means L.
            this.pendingDeltaX = oldGeometry.x - newGeometry.x;
            console.info(`${TAG} ARM delta=${this.pendingDeltaX}`);
            return;
        }

        if (oldParked && newSlot && this.pendingDeltaX > 0) {
            if (window.ccNiriLRevealAnimation) {
                cancel(window.ccNiriLRevealAnimation);
            }

            /*
             * Geometry Change contributes (oldX - newX) -> 0. Apply the
             * exact inverse with its 250 ms OutExpo timing so the incoming
             * surface stays at its final right-hand slot. Add only 20 px of
             * rightward motion (the configured right safe-area is 24 px),
             * plus a right-anchored horizontal expansion and fade. This is
             * visibly continuous without painting on the adjacent output.
             */
            const geometryChangeFromX = oldGeometry.x - newGeometry.x;
            window.ccNiriLRevealAnimation = animate({
                window,
                duration: animationTime(DURATION_MS),
                animations: [{
                    type: Effect.Translation,
                    from: {
                        value1: -geometryChangeFromX + SAFE_SLIDE_X,
                        value2: 0
                    },
                    to: { value1: 0, value2: 0 },
                    curve: QEasingCurve.OutExpo
                }, {
                    type: Effect.Scale,
                    sourceAnchor: Effect.Right,
                    targetAnchor: Effect.Right,
                    from: { value1: 0.94, value2: 1 },
                    to: { value1: 1, value2: 1 },
                    curve: QEasingCurve.OutCubic
                }, {
                    type: Effect.Opacity,
                    from: 0.2,
                    to: 1,
                    curve: QEasingCurve.OutCubic
                }]
            });
            console.info(`${TAG} L-INCOMING oldX=${oldGeometry.x}` +
                ` newX=${newGeometry.x} inverse=${-geometryChangeFromX}` +
                ` safeSlide=${SAFE_SLIDE_X}`);
            return;
        }

        if (oldSlot && newParked) {
            this.pendingDeltaX = null;
        }
    }
}

new ScrollTransitionPOC();
