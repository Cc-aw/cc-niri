/* SPDX-License-Identifier: MIT
 * Visual transitions for the V3 scrolling-column geometry writer.
 */

"use strict";

const SAFE_RIGHT_EDGE_SLIDE_X = 20;
const UNARMED_TRANSACTION_TTL_MS = 80;
const PRESENTATION_MIN_WIDTH_RATIO = 0.65;
const PRESENTATION_MAX_WIDTH_RATIO = 0.85;

class CCNiriScrollTransition {
    constructor() {
        this.pendingDeltaX = null;
        this.pendingDeltaArmedAt = 0;
        this.loadConfig();
        effect.configChanged.connect(this.loadConfig.bind(this));
        effect.animationEnded.connect(window => {
            if (window.ccNiriScrollAnimation) delete window.ccNiriScrollAnimation;
            if (window.ccNiriIncomingVisual) delete window.ccNiriIncomingVisual;
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
        this.presentationDuration = animationTime(
            Math.max(1, Number(effect.readConfig("PresentationDuration", 220)) || 220)
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

    isFocusWide(rect, screenRect) {
        const widthRatio = rect.width / screenRect.width;
        if (widthRatio < PRESENTATION_MIN_WIDTH_RATIO ||
                widthRatio > PRESENTATION_MAX_WIDTH_RATIO ||
                rect.height < screenRect.height * 0.75 ||
                rect.x < screenRect.x || rect.y < screenRect.y ||
                rect.x + rect.width > screenRect.x + screenRect.width ||
                rect.y + rect.height > screenRect.y + screenRect.height) {
            return false;
        }
        const rectCenter = rect.x + rect.width / 2;
        const screenCenter = screenRect.x + screenRect.width / 2;
        return Math.abs(rectCenter - screenCenter) < screenRect.width * 0.03;
    }

    presentationTransition(oldGeometry, newGeometry, screenRect) {
        /* A real Focus Wide transition only changes horizontal position and
         * width. Newly mapped applications often start as a centered large
         * window but also change height when adopted; never classify those
         * first-layout changes as Presentation animation. */
        if (Math.abs(oldGeometry.y - newGeometry.y) >= 1 ||
                Math.abs(oldGeometry.height - newGeometry.height) >= 1) {
            return false;
        }
        const oldSlot = this.visibleSlot(oldGeometry, screenRect);
        const newSlot = this.visibleSlot(newGeometry, screenRect);
        const oldWide = this.isFocusWide(oldGeometry, screenRect);
        const newWide = this.isFocusWide(newGeometry, screenRect);
        return (oldSlot && newWide) || (oldWide && newSlot);
    }

    parked(rect, screenRect) {
        return this.isColumnSize(rect, screenRect) &&
            (rect.x + rect.width < screenRect.x ||
             (rect.x < screenRect.x &&
              rect.x + rect.width <= screenRect.x + screenRect.width * 0.25));
    }

    incomingVisualStart(rect, translationX, scaleX, anchor, opacity) {
        const width = rect.width * scaleX;
        let x = rect.x + (rect.width - width) / 2;
        if (anchor === "left") x = rect.x;
        if (anchor === "right") x = rect.x + rect.width - width;
        return {
            x: x + translationX,
            y: rect.y,
            width,
            height: rect.height,
            opacity,
        };
    }

    debug(message) {
        if (this.debugLogging) {
            console.info(`[cc-niri-scroll-transition] ${message}`);
        }
    }

    clearPendingDelta() {
        this.pendingDeltaX = null;
        this.pendingDeltaArmedAt = 0;
    }

    expireStalePendingDelta() {
        if (this.pendingDeltaX !== null &&
                Date.now() - this.pendingDeltaArmedAt > UNARMED_TRANSACTION_TTL_MS) {
            this.debug(`EXPIRE staleDelta=${this.pendingDeltaX}`);
            this.clearPendingDelta();
        }
    }

    geometryChanged(window, oldGeometry) {
        if (!window.screen || window.screen.name !== this.targetOutputName) {
            return;
        }
        const screenRect = window.screen.geometry;
        const newGeometry = window.geometry;

        if (this.presentationTransition(oldGeometry, newGeometry, screenRect)) {
            /* The script normally waits until the destination pair has
             * finished scrolling before it commits 50%->72%. Preserve the
             * incoming visual as a defensive fallback if custom timing or a
             * fast follow-up makes the two animations overlap. */
            const chainedIncoming = window.ccNiriIncomingVisual || null;
            const sourceGeometry = chainedIncoming || oldGeometry;
            if (window.ccNiriScrollAnimation) {
                cancel(window.ccNiriScrollAnimation);
                delete window.ccNiriScrollAnimation;
            }
            if (window.ccNiriIncomingVisual) delete window.ccNiriIncomingVisual;
            const presentationAnimations = [{
                /* Size/Position animations interfere with scripted real
                 * geometry changes on KWin 6.7.5 and can leave a Wide
                 * window physically at its old 50% width. Scale and
                 * Translation are paint-only and keep geometry authoritative. */
                type: Effect.Scale,
                from: {
                    value1: sourceGeometry.width / newGeometry.width,
                    value2: sourceGeometry.height / newGeometry.height
                },
                to: {
                    value1: 1,
                    value2: 1
                }
            }, {
                type: Effect.Translation,
                from: {
                    value1: sourceGeometry.x + sourceGeometry.width / 2 -
                        (newGeometry.x + newGeometry.width / 2),
                    value2: sourceGeometry.y + sourceGeometry.height / 2 -
                        (newGeometry.y + newGeometry.height / 2)
                },
                to: {
                    value1: 0,
                    value2: 0
                }
            }];
            if (chainedIncoming) {
                presentationAnimations.push({
                    type: Effect.Opacity,
                    from: chainedIncoming.opacity,
                    to: 1.0
                });
            }
            window.ccNiriScrollAnimation = animate({
                window,
                duration: chainedIncoming
                    ? this.duration + this.presentationDuration
                    : this.presentationDuration,
                curve: QEasingCurve.OutCubic,
                animations: presentationAnimations
            });
            this.clearPendingDelta();
            this.debug(`${chainedIncoming ? "PRESENTATION_CHAINED" : "PRESENTATION"}` +
                ` old=${oldGeometry.x},${oldGeometry.y}` +
                ` ${oldGeometry.width}x${oldGeometry.height}` +
                ` new=${newGeometry.x},${newGeometry.y}` +
                ` ${newGeometry.width}x${newGeometry.height}`);
            return;
        }

        if (!this.sameSize(oldGeometry, newGeometry)) return;
        const oldSlot = this.visibleSlot(oldGeometry, screenRect);
        const newSlot = this.visibleSlot(newGeometry, screenRect);
        const oldParked = this.parked(oldGeometry, screenRect);
        const newParked = this.parked(newGeometry, screenRect);
        this.expireStalePendingDelta();
        if (!(oldSlot || oldParked) || !(newSlot || newParked) ||
                Math.abs(oldGeometry.x - newGeometry.x) < 1) {
            return;
        }

        if (window.ccNiriScrollAnimation) {
            cancel(window.ccNiriScrollAnimation);
            delete window.ccNiriScrollAnimation;
        }

        let animations;
        let incomingVisual = null;
        if (oldSlot && newSlot) {
            /*
             * Script commits the continuing column first. Both coordinates
             * are projections, never parking coordinates, so this is exactly
             * oldProjectedX - newProjectedX == scrollDeltaX.
             */
            this.pendingDeltaX = oldGeometry.x - newGeometry.x;
            this.pendingDeltaArmedAt = Date.now();
            animations = [{
                type: Effect.Translation,
                from: { value1: this.pendingDeltaX, value2: 0 },
                to: { value1: 0, value2: 0 }
            }];
            this.debug(`ARM delta=${this.pendingDeltaX}` +
                ` oldProjectedX=${oldGeometry.x} newProjectedX=${newGeometry.x}`);
        } else if (oldParked && newSlot) {
            if (this.pendingDeltaX === null) {
                /* Closing the visible right-hand Column can reveal its parked
                 * successor without changing scrollOffsetX. There is no
                 * continuing moving window from which to infer a delta, so
                 * animate the structural replacement from its slot edge. */
                const fromX = newSlot === "right"
                    ? SAFE_RIGHT_EDGE_SLIDE_X
                    : -SAFE_RIGHT_EDGE_SLIDE_X;
                const anchor = newSlot === "right" ? Effect.Right : Effect.Left;
                animations = [{
                    type: Effect.Translation,
                    from: { value1: fromX, value2: 0 },
                    to: { value1: 0, value2: 0 }
                }, {
                    type: Effect.Scale,
                    sourceAnchor: anchor,
                    targetAnchor: anchor,
                    from: { value1: 0.94, value2: 1 },
                    to: { value1: 1, value2: 1 }
                }, {
                    type: Effect.Opacity,
                    from: 0.2,
                    to: 1.0
                }];
                incomingVisual = this.incomingVisualStart(
                    newGeometry,
                    fromX,
                    0.94,
                    newSlot === "right" ? "right" : "left",
                    0.2
                );
                this.debug(`INCOMING_UNARMED slot=${newSlot}` +
                    ` newProjectedX=${newGeometry.x}`);
            } else if (this.pendingDeltaX > 0) {
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
                incomingVisual = this.incomingVisualStart(
                    newGeometry,
                    SAFE_RIGHT_EDGE_SLIDE_X,
                    0.94,
                    "right",
                    0.2
                );
                this.debug(`INCOMING_RIGHT_SAFE delta=${this.pendingDeltaX}` +
                    ` newProjectedX=${newGeometry.x}`);
            } else {
                animations = [{
                    type: Effect.Translation,
                    from: { value1: this.pendingDeltaX, value2: 0 },
                    to: { value1: 0, value2: 0 }
                }];
                incomingVisual = this.incomingVisualStart(
                    newGeometry,
                    this.pendingDeltaX,
                    1,
                    "center",
                    1
                );
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
            this.clearPendingDelta();
        } else {
            return;
        }

        if (incomingVisual) window.ccNiriIncomingVisual = incomingVisual;
        window.ccNiriScrollAnimation = animate({
            window,
            duration: this.duration,
            curve: QEasingCurve.OutCubic,
            animations
        });
    }
}

new CCNiriScrollTransition();
