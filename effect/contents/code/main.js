/* SPDX-License-Identifier: MIT
 * Visual transitions for the V3 scrolling-column geometry writer.
 */

"use strict";

const SAFE_RIGHT_EDGE_SLIDE_X = 20;
const UNARMED_TRANSACTION_TTL_MS = 80;
const PRESENTATION_MIN_WIDTH_RATIO = 0.65;
const PRESENTATION_MAX_WIDTH_RATIO = 0.85;

const MotionTokens = Object.freeze({
    microPressMs: 90,
    microHoverMs: 110,
    fastMs: 170,
    spatialMs: 220,
    spatialFastMs: 190,
    resizeMs: 300,
    expressiveEnterMs: 320,
    expressiveExitMs: 240,
});

const MotionCurves = Object.freeze({
    standardDecel: "standardDecel",
    expressiveSpatial: "expressiveSpatial",
});

const MotionType = Object.freeze({
    NONE: "NONE",
    SCROLL: "SCROLL",
    DOCK_SCROLL: "DOCK_SCROLL",
    CLOSE_REFILL: "CLOSE_REFILL",
    REORDER: "REORDER",
    WIDE_ENTER: "WIDE_ENTER",
    WIDE_EXIT: "WIDE_EXIT",
});

function clampUnit(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function standardDecelProgress(progress) {
    const remaining = 1 - clampUnit(progress);
    return 1 - remaining * remaining * remaining;
}

function interpolateValue(from, to, progress) {
    return from + (to - from) * progress;
}

function retargetedTranslation(current, oldGeometry, newGeometry) {
    return {
        value1: current.value1 + oldGeometry.x - newGeometry.x,
        value2: current.value2 + oldGeometry.y - newGeometry.y,
    };
}

function sampleMotionState(state, now) {
    if (!state) {
        return {
            active: false,
            progress: 1,
            translation: { value1: 0, value2: 0 },
            scale: { value1: 1, value2: 1 },
            opacity: 1,
        };
    }
    const linearProgress = clampUnit((now - state.startTime) /
        Math.max(1, state.duration));
    const progress = state.curve === MotionCurves.standardDecel ||
            state.curve === MotionCurves.expressiveSpatial
        ? standardDecelProgress(linearProgress)
        : linearProgress;
    const channelValue = (name, fallback) => {
        const channel = state.channels[name];
        if (!channel) return fallback;
        if (name === "opacity") {
            return interpolateValue(channel.from, channel.to, progress);
        }
        return {
            value1: interpolateValue(channel.from.value1, channel.to.value1, progress),
            value2: interpolateValue(channel.from.value2, channel.to.value2, progress),
        };
    };
    return {
        active: linearProgress < 1,
        progress,
        translation: channelValue("translation", { value1: 0, value2: 0 }),
        scale: channelValue("scale", { value1: 1, value2: 1 }),
        opacity: channelValue("opacity", 1),
    };
}

function visualRectFor(rect, sample, anchor) {
    const width = rect.width * sample.scale.value1;
    const height = rect.height * sample.scale.value2;
    let x = rect.x + (rect.width - width) / 2;
    let y = rect.y + (rect.height - height) / 2;
    if (anchor === "left") x = rect.x;
    if (anchor === "right") x = rect.x + rect.width - width;
    if (anchor === "top") y = rect.y;
    if (anchor === "bottom") y = rect.y + rect.height - height;
    return {
        x: x + sample.translation.value1,
        y: y + sample.translation.value2,
        width,
        height,
        opacity: sample.opacity,
    };
}

class MotionController {
    constructor(owner) {
        this.owner = owner;
        this.states = new Map();
        this.nextEpoch = 1;
    }

    sample(window, now) {
        return sampleMotionState(this.states.get(window) || null, now || Date.now());
    }

    visualSnapshot(window, geometry) {
        const state = this.states.get(window) || null;
        const anchor = state && state.channels.scale
            ? state.channels.scale.anchor
            : "center";
        return visualRectFor(geometry, sampleMotionState(state, Date.now()), anchor);
    }

    cancel(window) {
        const state = this.states.get(window);
        if (!state) return false;
        this.states.delete(window);
        if (state.animationIds && state.animationIds.length) {
            cancel(state.animationIds);
        }
        if (window.ccNiriScrollAnimation === state.animationIds) {
            delete window.ccNiriScrollAnimation;
        }
        return true;
    }

    cancelAll() {
        const windows = Array.from(this.states.keys());
        windows.forEach(window => this.cancel(window));
    }

    kwinAttribute(name) {
        if (name === "translation") return Effect.Translation;
        if (name === "scale") return Effect.Scale;
        if (name === "opacity") return Effect.Opacity;
        return Effect.Generic;
    }

    channelName(attribute) {
        if (attribute === Effect.Translation) return "translation";
        if (attribute === Effect.Scale) return "scale";
        if (attribute === Effect.Opacity) return "opacity";
        return "";
    }

    kwinAnchor(anchor) {
        if (anchor === "left") return Effect.Left;
        if (anchor === "right") return Effect.Right;
        if (anchor === "top") return Effect.Top;
        if (anchor === "bottom") return Effect.Bottom;
        return 0;
    }

    curveType(curve) {
        if (curve === MotionCurves.standardDecel ||
                curve === MotionCurves.expressiveSpatial) {
            return QEasingCurve.OutCubic;
        }
        return QEasingCurve.Linear;
    }

    start(window, options) {
        const now = Date.now();
        const previous = this.states.get(window) || null;
        const previousSample = sampleMotionState(previous, now);
        const desired = {};
        options.channels.forEach(channel => {
            const name = channel.name || this.channelName(channel.type);
            if (name) desired[name] = channel;
        });

        if (previous) {
            this.states.delete(window);
            if (previous.animationIds && previous.animationIds.length) {
                cancel(previous.animationIds);
            }
        }

        const channels = {};
        const names = ["translation", "scale", "opacity"];
        names.forEach(name => {
            const target = desired[name] || null;
            const carried = previous && previous.channels[name]
                ? previous.channels[name]
                : null;
            if (!target && !carried) return;

            if (name === "translation") {
                const from = previous
                    ? retargetedTranslation(
                        previousSample.translation,
                        options.oldGeometry,
                        options.newGeometry
                    )
                    : target.from;
                channels.translation = {
                    from,
                    to: target ? target.to : { value1: 0, value2: 0 },
                    anchor: "center",
                };
                return;
            }

            if (name === "scale") {
                channels.scale = {
                    from: previous ? previousSample.scale : target.from,
                    to: target ? target.to : { value1: 1, value2: 1 },
                    anchor: target ? (target.anchor || "center") :
                        (carried.anchor || "center"),
                };
                return;
            }

            channels.opacity = {
                from: previous ? previousSample.opacity : target.from,
                to: target ? target.to : 1,
                anchor: "center",
            };
        });

        const duration = Math.max(1, Number(options.duration) || 1);
        const animationSpecs = Object.keys(channels).map(name => {
            const channel = channels[name];
            const spec = {
                type: this.kwinAttribute(name),
                from: channel.from,
                to: channel.to,
            };
            if (name === "scale" && channel.anchor !== "center") {
                const anchor = this.kwinAnchor(channel.anchor);
                spec.sourceAnchor = anchor;
                spec.targetAnchor = anchor;
            }
            return spec;
        });
        const state = {
            epoch: this.nextEpoch++,
            type: options.type || MotionType.NONE,
            startTime: now,
            duration,
            curve: options.curve || MotionCurves.standardDecel,
            channels,
            animationIds: [],
        };
        state.animationIds = animate({
            window,
            duration,
            curve: this.curveType(state.curve),
            animations: animationSpecs,
        });
        this.states.set(window, state);
        window.ccNiriScrollAnimation = state.animationIds;

        const startSample = sampleMotionState(state, now);
        window.ccNiriIncomingVisual = visualRectFor(
            options.newGeometry,
            startSample,
            channels.scale ? channels.scale.anchor : "center"
        );
        this.owner.debug(`[MOTION] ${previous ? "retarget" : "start"}` +
            ` type=${state.type} epoch=${state.epoch}` +
            ` duration=${duration} channels=${Object.keys(channels).join(",")}`);
        return state;
    }

    animationEnded(window, animationId) {
        const state = this.states.get(window);
        if (!state) return;
        /* KWin 6.7 reports animationId=0 for declarative animation groups.
         * The signal is still scoped to the correct EffectWindow, and all
         * channels in a group share one duration, so the first group-end
         * signal completes the current epoch for that window. */
        if (Number(animationId) === 0) {
            this.states.delete(window);
            if (window.ccNiriScrollAnimation) delete window.ccNiriScrollAnimation;
            if (window.ccNiriIncomingVisual) delete window.ccNiriIncomingVisual;
            this.owner.debug(`[MOTION] complete type=${state.type}` +
                ` epoch=${state.epoch} group=true`);
            return;
        }
        if (state.animationIds.indexOf(animationId) < 0) return;
        state.animationIds = state.animationIds.filter(id => id !== animationId);
        if (state.animationIds.length) {
            window.ccNiriScrollAnimation = state.animationIds;
            return;
        }
        this.states.delete(window);
        if (window.ccNiriScrollAnimation) delete window.ccNiriScrollAnimation;
        if (window.ccNiriIncomingVisual) delete window.ccNiriIncomingVisual;
        this.owner.debug(`[MOTION] complete type=${state.type} epoch=${state.epoch}`);
    }
}

class CCNiriScrollTransition {
    constructor() {
        this.pendingDeltaX = null;
        this.pendingDeltaArmedAt = 0;
        this.motion = new MotionController(this);
        this.loadConfig();
        effect.configChanged.connect(this.loadConfig.bind(this));
        effect.animationEnded.connect((window, animationId) => {
            this.debug(`[MOTION] ended animationId=${String(animationId)}`);
            this.motion.animationEnded(window, animationId);
        });
        effects.windowAdded.connect(this.manage.bind(this));
        for (const window of effects.stackingOrder) this.manage(window);
    }

    loadConfig() {
        this.targetOutputName = String(effect.readConfig("TargetOutputName", "DP-1"));
        this.innerGap = Math.max(0, Number(effect.readConfig("InnerGap", 8)) || 0);
        this.duration = Math.max(1, animationTime(
            Math.max(1, Number(effect.readConfig("Duration", MotionTokens.spatialMs)) ||
                MotionTokens.spatialMs)
        ));
        this.presentationDuration = Math.max(1, animationTime(
            Math.max(1, Number(effect.readConfig("PresentationDuration", 220)) || 220)
        ));
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
            const recordedIncoming = window.ccNiriIncomingVisual || null;
            const chainedIncoming = this.motion.states.has(window)
                ? this.motion.visualSnapshot(window, oldGeometry)
                : recordedIncoming;
            const sourceGeometry = chainedIncoming || oldGeometry;
            this.motion.cancel(window);
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
            this.motion.start(window, {
                type: this.isFocusWide(newGeometry, screenRect)
                    ? MotionType.WIDE_ENTER
                    : MotionType.WIDE_EXIT,
                duration: chainedIncoming
                    ? this.duration + this.presentationDuration
                    : this.presentationDuration,
                curve: MotionCurves.expressiveSpatial,
                oldGeometry,
                newGeometry,
                channels: presentationAnimations,
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
                    anchor: newSlot === "right" ? "right" : "left",
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
                    anchor: "right",
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
        this.motion.start(window, {
            type: MotionType.SCROLL,
            duration: this.duration,
            curve: MotionCurves.standardDecel,
            oldGeometry,
            newGeometry,
            channels: animations,
        });
    }
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        MotionTokens,
        MotionCurves,
        MotionType,
        clampUnit,
        standardDecelProgress,
        interpolateValue,
        retargetedTranslation,
        sampleMotionState,
        visualRectFor,
    };
} else {
    new CCNiriScrollTransition();
}
