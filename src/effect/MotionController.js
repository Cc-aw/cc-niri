"use strict";

/* cjs:start */
const {
    CC_NIRI_VIEWPORT_CLIP_ROLE,
    MotionCurves,
    MotionType,
} = require("./MotionTokens");
const {
    channelDistance,
    distanceAwareDuration,
    motionValuesEqual,
    retargetedTranslation,
    sampleMotionState,
    visualRectFor,
} = require("./MotionSampler");
/* cjs:end */

class MotionController {
    constructor(owner) {
        this.owner = owner;
        this.states = new Map();
        this.nextEpoch = 1;
    }

    sample(window, now) {
        return sampleMotionState(this.states.get(window) || null, now || Date.now());
    }

    visualSnapshot(window, geometry, now = Date.now()) {
        const state = this.states.get(window) || null;
        const anchor = state && state.channels.scale
            ? state.channels.scale.anchor
            : "center";
        return visualRectFor(geometry, sampleMotionState(state, now), anchor);
    }

    setNativeViewportClip(window, state) {
        if (!state.viewport || typeof window.setData !== "function") return;
        window.setData(CC_NIRI_VIEWPORT_CLIP_ROLE, {
            enabled: true,
            x: Number(state.viewport.x),
            y: Number(state.viewport.y),
            width: Number(state.viewport.width),
            height: Number(state.viewport.height),
            transactionId: state.transactionId,
            transactionEpoch: state.transactionEpoch,
            motionEpoch: state.epoch,
            role: state.role,
        });
    }

    clearNativeViewportClip(window) {
        if (typeof window.setData === "function") {
            window.setData(CC_NIRI_VIEWPORT_CLIP_ROLE, null);
        }
    }

    cancel(window) {
        const state = this.states.get(window);
        if (!state) {
            this.clearNativeViewportClip(window);
            return false;
        }
        this.states.delete(window);
        if (state.animationIds && state.animationIds.length) {
            cancel(state.animationIds);
        }
        if (window.ccNiriScrollAnimation === state.animationIds) {
            delete window.ccNiriScrollAnimation;
        }
        this.clearNativeViewportClip(window);
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

    startTransaction(window, transaction, role, options) {
        return this.start(window, Object.assign({}, options, {
            transactionId: transaction.id,
            transactionEpoch: transaction.layoutEpoch,
            role,
            viewport: transaction.viewport,
        }));
    }

    start(window, options) {
        const now = options.startTime === undefined
            ? Date.now() : options.startTime;
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

        Object.keys(channels).forEach(name => {
            const channel = channels[name];
            if (motionValuesEqual(channel.from, channel.to)) delete channels[name];
        });
        if (!Object.keys(channels).length) {
            if (window.ccNiriScrollAnimation) delete window.ccNiriScrollAnimation;
            if (window.ccNiriIncomingVisual) delete window.ccNiriIncomingVisual;
            this.clearNativeViewportClip(window);
            this.owner.debug(`[MOTION] skip type=${options.type || MotionType.NONE}` +
                " reason=no-op");
            return null;
        }

        const requestedDuration = Math.max(1, Number(options.duration) || 1);
        const requestedTranslation = desired.translation || null;
        const duration = previous && channels.translation && requestedTranslation &&
                !options.synchronizeDuration
            ? distanceAwareDuration(
                requestedDuration,
                channelDistance(channels.translation),
                channelDistance(requestedTranslation)
            )
            : requestedDuration;
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
        /* A custom shader attached to Translation/Scale/Opacity is retained by
         * AnimationEffect, but KWin only binds it while processing an explicit
         * Shader attribute. Keep the Shader animation in the same declarative
         * group so its lifetime follows the motion channels exactly. */
        if (options.fragmentShader) {
            animationSpecs.push({
                type: Effect.Shader,
                from: 0.0,
                to: 1.0,
                fragmentShader: options.fragmentShader,
            });
        }
        const state = {
            epoch: this.nextEpoch++,
            transactionId: options.transactionId === undefined
                ? null : options.transactionId,
            transactionEpoch: options.transactionEpoch === undefined
                ? null : options.transactionEpoch,
            type: options.type || MotionType.NONE,
            role: options.role || "static",
            viewport: options.viewport ? Object.assign({}, options.viewport) : null,
            startTime: now,
            duration,
            curve: options.curve || MotionCurves.standardDecel,
            channels,
            animationIds: [],
        };
        const animationRequest = {
            window,
            duration,
            curve: this.curveType(state.curve),
            animations: animationSpecs,
        };
        if (options.fragmentShader) {
            animationRequest.fragmentShader = options.fragmentShader;
        }
        this.states.set(window, state);
        this.setNativeViewportClip(window, state);
        state.animationIds = animate(animationRequest);
        window.ccNiriScrollAnimation = state.animationIds;

        const startSample = sampleMotionState(state, now);
        window.ccNiriIncomingVisual = visualRectFor(
            options.newGeometry,
            startSample,
            channels.scale ? channels.scale.anchor : "center"
        );
        this.owner.debug(`[MOTION] ${previous ? "retarget" : "start"}` +
            ` type=${state.type} epoch=${state.epoch}` +
            ` transaction=${state.transactionId === null ? "none" : state.transactionId}` +
            ` role=${state.role}` +
            ` duration=${duration} channels=${Object.keys(channels).join(",")}`);
        return state;
    }

    animationEnded(window, animationId) {
        const state = this.states.get(window);
        if (!state) return false;
        /* KWin 6.7 reports animationId=0 for declarative animation groups.
         * The signal is still scoped to the correct EffectWindow, and all
         * channels in a group share one duration, so the first group-end
         * signal completes the current epoch for that window. */
        if (Number(animationId) === 0) {
            this.states.delete(window);
            if (window.ccNiriScrollAnimation) delete window.ccNiriScrollAnimation;
            if (window.ccNiriIncomingVisual) delete window.ccNiriIncomingVisual;
            this.clearNativeViewportClip(window);
            this.owner.debug(`[MOTION] complete type=${state.type}` +
                ` epoch=${state.epoch} group=true`);
            return true;
        }
        if (state.animationIds.indexOf(animationId) < 0) return false;
        state.animationIds = state.animationIds.filter(id => id !== animationId);
        if (state.animationIds.length) {
            window.ccNiriScrollAnimation = state.animationIds;
            return false;
        }
        this.states.delete(window);
        if (window.ccNiriScrollAnimation) delete window.ccNiriScrollAnimation;
        if (window.ccNiriIncomingVisual) delete window.ccNiriIncomingVisual;
        this.clearNativeViewportClip(window);
        this.owner.debug(`[MOTION] complete type=${state.type} epoch=${state.epoch}`);
        return true;
    }
}

/* cjs:start */
module.exports = { MotionController };
/* cjs:end */
