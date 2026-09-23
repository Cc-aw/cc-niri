/* SPDX-License-Identifier: MIT
 * Visual transitions for the V3 scrolling-column geometry writer.
 */

"use strict";

/* BEGIN GENERATED EFFECT MODULES */
// Generated from src/kwin/runtime/RuntimeLogger.js
class RuntimeLogger {
    constructor(options) {
        this.tag = options.tag;
        this.enabled = Boolean(options.enabled);
        this.infoSink = options.infoSink;
        this.warnSink = options.warnSink;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
    }

    resolve(value) {
        return typeof value === "function" ? value() : String(value);
    }

    classify(message, requestedCategory) {
        if (requestedCategory) return requestedCategory;
        if (/^\[cc-adoption\]/.test(message)) return "adoption";
        if (/^\[cc-dock\]/.test(message)) return "dock";
        if (/^\[cc-presentation\]/.test(message)) return "presentation";
        if (/^\[cc-stability\].*EMERGENCY_RESTORE/.test(message)) return "recovery";
        if (/^\[cc-stability\]/.test(message)) return "stability";
        if (/^\[cc-scroll\].*(FLOAT|MANAGE|REMEMBER_FLOAT)/.test(message)) {
            return "floating";
        }
        if (/^\[cc-scroll\]/.test(message)) return "layout";
        if (/^(FULLSCREEN|NATIVE-TRANSFER)/.test(message)) return "lifecycle";
        if (/^(INVARIANT|RECOVERY|TIMEOUT|SCHEMA REJECT|QUEUE FULL)/.test(message)) {
            return "stability";
        }
        return "runtime";
    }

    stripLegacyPrefix(message) {
        return message.replace(/^\[cc-[^\]]+\]\s*/u, "");
    }

    format(category, message) {
        return `${this.tag} [${category}] ${this.stripLegacyPrefix(message)}`;
    }

    debug(value, category = "") {
        if (!this.enabled) return false;
        const message = this.resolve(value);
        this.infoSink(this.format(this.classify(message, category), message));
        return true;
    }

    warn(value, category = "") {
        const message = this.resolve(value);
        this.warnSink(this.format(this.classify(message, category), message));
        return true;
    }
}

// Generated from src/effect/MotionTokens.js
const SAFE_RIGHT_EDGE_SLIDE_X = 20;
const UNARMED_TRANSACTION_TTL_MS = 80;
const PRESENTATION_MIN_WIDTH_RATIO = 0.65;
const PRESENTATION_MAX_WIDTH_RATIO = 0.85;
/* KWin reserves EffectWindow data roles 0..999. This role is the in-process
 * handoff from the scripted motion effect to the native viewport clip effect. */
const CC_NIRI_VIEWPORT_CLIP_ROLE = 1001;
const CC_NIRI_VIEWPORT_CLIP_CAPABILITY_ROLE = 1002;
const CC_NIRI_MOTION_PLAN_ROLE = 1003;
const CC_NIRI_MOTION_COMPLETE_ROLE = 1004;

const MotionTokens = Object.freeze({
    microPressMs: 90,
    microHoverMs: 110,
    fastMs: 170,
    spatialMs: 220,
    spatialFastMs: 190,
    resizeMs: 300,
    expressiveEnterMs: 320,
    expressiveExitMs: 240,
    subtleIncomingScale: 0.985,
    subtleIncomingOpacity: 0.85,
    retargetMinMs: 110,
    retargetMidMs: 160,
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
    WIDE_TO_PAIR: "WIDE_TO_PAIR",
    PAIR_TO_WIDE: "PAIR_TO_WIDE",
});

// Generated from src/effect/MotionSampler.js
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

function channelDistance(channel) {
    if (!channel) return 0;
    if (typeof channel.from === "number" && typeof channel.to === "number") {
        return Math.abs(channel.to - channel.from);
    }
    if (!channel.from || !channel.to) return 0;
    const delta1 = channel.to.value1 - channel.from.value1;
    const delta2 = channel.to.value2 - channel.from.value2;
    return Math.sqrt(delta1 * delta1 + delta2 * delta2);
}

function distanceAwareDuration(baseDuration, remainingDistance, fullDistance) {
    const base = Math.max(1, Number(baseDuration) || 1);
    const full = Math.max(1, Number(fullDistance) || 1);
    const ratio = clampUnit((Number(remainingDistance) || 0) / full);
    const minimum = base * MotionTokens.retargetMinMs / MotionTokens.spatialMs;
    const midpoint = base * MotionTokens.retargetMidMs / MotionTokens.spatialMs;
    if (ratio <= 0.2) return Math.max(1, Math.round(minimum));
    if (ratio <= 0.5) {
        return Math.max(1, Math.round(
            minimum + (midpoint - minimum) * ((ratio - 0.2) / 0.3)
        ));
    }
    return Math.max(1, Math.round(
        midpoint + (base - midpoint) * ((ratio - 0.5) / 0.5)
    ));
}

function motionValuesEqual(a, b, tolerance = 0.0001) {
    if (typeof a === "number" || typeof b === "number") {
        return typeof a === "number" && typeof b === "number" &&
            Math.abs(a - b) < tolerance;
    }
    return Boolean(a && b &&
        Math.abs(a.value1 - b.value1) < tolerance &&
        Math.abs(a.value2 - b.value2) < tolerance);
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

// Generated from src/effect/MotionTransaction.js
class MotionTransaction {
    constructor(ttlMs) {
        this.ttlMs = Math.max(1, Number(ttlMs) || 1);
        this.nextId = 1;
        this.activeTransaction = null;
    }

    begin(options) {
        const now = options.now === undefined ? Date.now() : options.now;
        const id = this.nextId++;
        this.activeTransaction = {
            id,
            layoutEpoch: options.layoutEpoch === undefined ? id : options.layoutEpoch,
            type: options.type || MotionType.SCROLL,
            deltaX: Number(options.deltaX) || 0,
            direction: options.direction ||
                (Number(options.deltaX) > 0 ? "left" :
                    (Number(options.deltaX) < 0 ? "right" : "none")),
            oldScrollOffsetX: options.oldScrollOffsetX === undefined
                ? null : Number(options.oldScrollOffsetX),
            newScrollOffsetX: options.newScrollOffsetX === undefined
                ? null : Number(options.newScrollOffsetX),
            viewport: options.viewport ? Object.assign({}, options.viewport) : null,
            continuing: [],
            incoming: [],
            outgoing: [],
            roleByWindow: new Map(),
            armedAt: now,
        };
        if (options.window && options.role) {
            this.record(options.role, options.window);
        }
        return this.activeTransaction;
    }

    arm(deltaX, window, now = Date.now(), options = {}) {
        const current = this.current(now);
        const normalizedDelta = Number(deltaX) || 0;
        const transaction = !current || current.type !== (options.type || MotionType.SCROLL) ||
                Math.abs(current.deltaX - normalizedDelta) >= 1
            ? this.begin({
                deltaX: normalizedDelta,
                type: options.type || MotionType.SCROLL,
                layoutEpoch: options.layoutEpoch,
                direction: options.direction,
                oldScrollOffsetX: options.oldScrollOffsetX,
                newScrollOffsetX: options.newScrollOffsetX,
                viewport: options.viewport,
                now,
            })
            : current;
        transaction.armedAt = now;
        if (window) this.record("continuing", window);
        return transaction;
    }

    record(role, window) {
        const transaction = this.activeTransaction;
        if (!transaction ||
                ["continuing", "incoming", "outgoing"].indexOf(role) < 0) {
            return false;
        }
        const previousRole = transaction.roleByWindow.get(window);
        if (previousRole && previousRole !== role) {
            transaction[previousRole] = transaction[previousRole]
                .filter(item => item !== window);
        }
        if (transaction[role].indexOf(window) < 0) transaction[role].push(window);
        transaction.roleByWindow.set(window, role);
        return true;
    }

    roleFor(window) {
        const transaction = this.activeTransaction;
        return transaction ? transaction.roleByWindow.get(window) || null : null;
    }

    current(now = Date.now()) {
        this.expire(now);
        return this.activeTransaction;
    }

    expire(now = Date.now()) {
        const transaction = this.activeTransaction;
        const ttl = transaction && (transaction.type === MotionType.WIDE_TO_PAIR ||
            transaction.type === MotionType.PAIR_TO_WIDE)
            ? Math.max(this.ttlMs, 500) : this.ttlMs;
        if (!transaction || now - transaction.armedAt <= ttl) return null;
        this.activeTransaction = null;
        return transaction;
    }

    clear() {
        const transaction = this.activeTransaction;
        this.activeTransaction = null;
        return transaction;
    }

    complete(id) {
        if (!this.activeTransaction || this.activeTransaction.id !== id) return null;
        return this.clear();
    }
}

// Generated from src/effect/ParkingAnimationGrabber.js
class ParkingAnimationGrabber {
    constructor(options) {
        this.effect = options.effect;
        this.minimizedRole = options.minimizedRole;
        this.unminimizedRole = options.unminimizedRole;
        this.debug = options.debug;
        this.grabbedWindows = new Set();
    }

    has(window) {
        return this.grabbedWindows.has(window);
    }

    grab(window, reason) {
        if (!window) return false;
        if (this.has(window)) return true;

        const minimized = this.effect.grab(window, this.minimizedRole, true);
        const unminimized = this.effect.grab(window, this.unminimizedRole, true);
        if (!minimized || !unminimized) {
            if (minimized) this.effect.ungrab(window, this.minimizedRole);
            if (unminimized) this.effect.ungrab(window, this.unminimizedRole);
            this.debug(`[PARK_GRAB] failed reason=${reason}` +
                ` minimize=${minimized} unminimize=${unminimized}`);
            return false;
        }

        this.grabbedWindows.add(window);
        this.debug(`[PARK_GRAB] grab reason=${reason}` +
            " minimize=true unminimize=true");
        return true;
    }

    release(window, reason) {
        if (!window || !this.has(window)) return false;
        this.grabbedWindows.delete(window);
        const minimized = this.effect.ungrab(window, this.minimizedRole);
        const unminimized = this.effect.ungrab(window, this.unminimizedRole);
        this.debug(`[PARK_GRAB] release reason=${reason}` +
            ` minimize=${minimized} unminimize=${unminimized}`);
        return minimized && unminimized;
    }

    releaseAll(reason) {
        Array.from(this.grabbedWindows).forEach(window =>
            this.release(window, reason));
    }
}

// Generated from src/effect/ViewportClipController.js
class ViewportClipController {
    constructor(options) {
        this.effect = options.effect;
        this.mapTextureTrait = options.mapTextureTrait;
        this.debug = options.debug;
        this.enabled = false;
        this.shaderId = 0;
        this.failed = false;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (this.enabled) this.ensureShader();
    }

    ensureShader() {
        if (this.shaderId || this.failed) return this.shaderId;
        try {
            this.shaderId = Number(this.effect.addFragmentShader(
                this.mapTextureTrait,
                "viewport_clip.frag"
            )) || 0;
        } catch (error) {
            this.failed = true;
            this.debug(`[VIEWPORT_CLIP] shader-load-failed error=${String(error)}`);
            return 0;
        }
        if (!this.shaderId) {
            this.failed = true;
            this.debug("[VIEWPORT_CLIP] shader-load-failed id=0");
            return 0;
        }
        this.effect.setUniform(this.shaderId, "debugTint", 1.0);
        this.debug(`[VIEWPORT_CLIP] shader-loaded id=${this.shaderId}`);
        return this.shaderId;
    }

    shaderFor(viewport) {
        if (!this.enabled || !viewport) return 0;
        const shaderId = this.ensureShader();
        if (!shaderId) return 0;
        this.effect.setUniform(shaderId, "viewportRect", [
            Number(viewport.x),
            Number(viewport.y),
            Number(viewport.width),
            Number(viewport.height),
        ]);
        this.debug(`[VIEWPORT_CLIP] tint viewport=${viewport.x},${viewport.y}` +
            ` ${viewport.width}x${viewport.height}`);
        return shaderId;
    }
}

// Generated from src/effect/MotionController.js
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

// Generated from src/effect/MotionClassifier.js
function sameSize(a, b) {
    return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

function rectNear(a, b, tolerance = 3) {
    return Boolean(a && b &&
        Math.abs(a.x - b.x) < tolerance &&
        Math.abs(a.y - b.y) < tolerance &&
        Math.abs(a.width - b.width) < tolerance &&
        Math.abs(a.height - b.height) < tolerance);
}

function isColumnSize(rect, screenRect) {
    return rect.width > screenRect.width * 0.35 &&
        rect.width < screenRect.width * 0.65 &&
        rect.height > screenRect.height * 0.75;
}

function visibleSlot(rect, screenRect) {
    if (!isColumnSize(rect, screenRect) ||
            rect.x < screenRect.x || rect.y < screenRect.y ||
            rect.x + rect.width > screenRect.x + screenRect.width ||
            rect.y + rect.height > screenRect.y + screenRect.height) {
        return null;
    }
    const center = rect.x + rect.width / 2;
    return center < screenRect.x + screenRect.width / 2 ? "left" : "right";
}

function isFocusWide(rect, screenRect) {
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

function presentationTransition(oldGeometry, newGeometry, screenRect) {
    /* A real Focus Wide transition only changes horizontal position and
     * width. Newly mapped applications often start as a centered large
     * window but also change height when adopted; never classify those
     * first-layout changes as Presentation animation. */
    if (Math.abs(oldGeometry.y - newGeometry.y) >= 1 ||
            Math.abs(oldGeometry.height - newGeometry.height) >= 1) {
        return false;
    }
    const oldSlot = visibleSlot(oldGeometry, screenRect);
    const newSlot = visibleSlot(newGeometry, screenRect);
    const oldWide = isFocusWide(oldGeometry, screenRect);
    const newWide = isFocusWide(newGeometry, screenRect);
    return (oldSlot && newWide) || (oldWide && newSlot);
}

function wideExitNeighborMatches(wide, neighborRect, innerGap) {
    if (!wide || !wide.pairRect || !neighborRect) return false;
    const neighborSide = wide.side === "left" ? "right" : "left";
    const expectedX = neighborSide === "right"
        ? wide.pairRect.x + wide.pairRect.width + innerGap
        : wide.pairRect.x - neighborRect.width - innerGap;
    return Math.abs(neighborRect.x - expectedX) < 3 &&
        Math.abs(neighborRect.y - wide.pairRect.y) < 2 &&
        Math.abs(neighborRect.width - wide.pairRect.width) < 3 &&
        Math.abs(neighborRect.height - wide.pairRect.height) < 2;
}

function parked(rect, screenRect) {
    return isColumnSize(rect, screenRect) &&
        (rect.x + rect.width < screenRect.x ||
         (rect.x < screenRect.x &&
          rect.x + rect.width <= screenRect.x + screenRect.width * 0.25));
}

function incomingVisualStart(rect, translationX, scaleX, anchor, opacity) {
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

function viewportFromSlot(rect, slot, innerGap) {
    const gap = Math.max(0, Number(innerGap) || 0);
    const width = rect.width * 2 + gap;
    return {
        x: slot === "right" ? rect.x - rect.width - gap : rect.x,
        y: rect.y,
        width,
        height: rect.height,
    };
}

// Generated from src/effect/WideMotionGeometry.js
function wideNeighborStart(wideRect, neighborWidth, side, gap) {
    return side === "left"
        ? wideRect.x - gap - neighborWidth
        : wideRect.x + wideRect.width + gap;
}

function anchoredScaleTranslation(source, target, anchor) {
    const scaleX = source.width / target.width;
    const paintedX = anchor === "right"
        ? target.x + target.width - source.width
        : target.x;
    return {
        scaleX,
        translationX: source.x - paintedX,
    };
}

function widePairEdgeError(wide, neighbor, side, gap) {
    return side === "left"
        ? wide.x - (neighbor.x + neighbor.width) - gap
        : neighbor.x - (wide.x + wide.width) - gap;
}

function wideTimelineSample(armedAt, now, duration) {
    const total = Math.max(1, Number(duration) || 1);
    const elapsed = Math.max(0, Math.min(total, Number(now) - Number(armedAt)));
    const progress = standardDecelProgress(elapsed / total);
    return {
        progress,
        remainingDuration: Math.max(1, total - elapsed),
    };
}

function widePairMotionSnapshot(type, wideRect, pairRect, side, gap) {
    const neighborSide = side === "left" ? "right" : "left";
    const pairNeighbor = {
        x: neighborSide === "right"
            ? pairRect.x + pairRect.width + gap
            : pairRect.x - pairRect.width - gap,
        y: pairRect.y,
        width: pairRect.width,
        height: pairRect.height,
    };
    const virtualNeighbor = Object.assign({}, pairNeighbor, {
        x: wideNeighborStart(wideRect, pairNeighbor.width,
            neighborSide, gap),
    });
    const entering = type === "PAIR_TO_WIDE";
    return {
        type,
        side,
        target: {
            oldVisualRect: Object.assign({}, entering ? pairRect : wideRect),
            newVisualRect: Object.assign({}, entering ? wideRect : pairRect),
        },
        neighbor: {
            oldVisualRect: Object.assign({}, entering
                ? pairNeighbor : virtualNeighbor),
            newVisualRect: Object.assign({}, entering
                ? virtualNeighbor : pairNeighbor),
            oldOpacity: entering ? 1 : 0,
            newOpacity: entering ? 0 : 1,
        },
    };
}
/* END GENERATED EFFECT MODULES */

class CCNiriScrollTransition {
    constructor() {
        this.logger = new RuntimeLogger({
            tag: "[cc-niri-scroll-transition]",
            enabled: false,
            infoSink: message => console.info(message),
            warnSink: message => console.warn(message),
        });
        this.motionTransaction = new MotionTransaction(UNARMED_TRANSACTION_TTL_MS);
        this.parkingGrabber = new ParkingAnimationGrabber({
            effect,
            minimizedRole: Effect.WindowMinimizedGrabRole,
            unminimizedRole: Effect.WindowUnminimizedGrabRole,
            debug: message => this.debug(message),
        });
        this.viewportClip = new ViewportClipController({
            effect,
            mapTextureTrait: Effect.MapTexture,
            debug: message => this.debug(message),
        });
        this.motion = new MotionController(this);
        this.wideIsolationHolds = new Map();
        this.pendingWideExit = null;
        this.loadConfig();
        effect.configChanged.connect(this.loadConfig.bind(this));
        effect.animationEnded.connect((window, animationId) => {
            this.debug(`[MOTION] ended animationId=${String(animationId)}`);
            const completed = this.motion.states.get(window) || null;
            if (this.motion.animationEnded(window, animationId)) {
                if (completed && completed.type === MotionType.PAIR_TO_WIDE &&
                        completed.role === "outgoing") {
                    this.holdWideIsolation(window);
                    this.reportWideMotionComplete(window, completed);
                }
                this.parkingGrabber.release(window, "motion-complete");
            }
        });
        effects.windowAdded.connect(this.manage.bind(this));
        effects.windowClosed.connect(window => {
            this.motion.cancel(window);
            this.releaseWideIsolation(window, "window-closed");
            this.parkingGrabber.release(window, "window-closed");
        });
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
        this.logger.setEnabled(this.debugLogging);
        this.viewportClip.setEnabled(Boolean(
            effect.readConfig("DebugViewportClipTint", false)
        ));
    }

    manage(window) {
        window.windowFrameGeometryChanged.connect(this.geometryChanged.bind(this));
    }

    debug(message) {
        this.logger.debug(message, "motion");
    }

    holdWideIsolation(window) {
        if (!window || this.wideIsolationHolds.has(window) ||
                typeof set !== "function") return false;
        const screenRect = window.screen && window.screen.geometry;
        if (!screenRect || !visibleSlot(window.geometry, screenRect)) return false;
        const ids = set({
            window,
            duration: 1,
            animations: [{ type: Effect.Opacity, from: 0, to: 0 }],
        });
        this.wideIsolationHolds.set(window, ids);
        // A one-frame opacity hold may not schedule its own final repaint.
        // Without this, the last pre-isolation frame can remain visible until
        // an unrelated desktop click or screenshot invalidates the scene.
        effects.addRepaintFull();
        this.debug("[WIDE_ISOLATION] hold until real parking");
        return true;
    }

    releaseWideIsolation(window, reason) {
        if (!this.wideIsolationHolds.has(window)) return false;
        const ids = this.wideIsolationHolds.get(window);
        this.wideIsolationHolds.delete(window);
        if (ids) cancel(ids);
        effects.addRepaintFull();
        this.debug(`[WIDE_ISOLATION] release reason=${reason}`);
        return true;
    }

    releaseAllWideIsolation(reason) {
        for (const window of this.wideIsolationHolds.keys()) {
            this.releaseWideIsolation(window, reason);
        }
    }

    reportWideMotionComplete(window, motionState) {
        if (!window || typeof window.data !== "function" ||
                typeof window.setData !== "function") return false;
        let marker;
        try {
            marker = window.data(CC_NIRI_MOTION_PLAN_ROLE);
        } catch (_) {
            return false;
        }
        if (!marker || marker.type !== MotionType.PAIR_TO_WIDE ||
                marker.role !== "neighbor" ||
                Number(marker.epoch) !== motionState.transactionEpoch ||
                !marker.transitionToken || !marker.sessionId ||
                !marker.targetWindowUuid) return false;
        window.setData(CC_NIRI_MOTION_COMPLETE_ROLE, {
            type: marker.type,
            sessionId: marker.sessionId,
            transitionToken: marker.transitionToken,
            targetWindowUuid: marker.targetWindowUuid,
        });
        this.debug(`[MOTION_TX] completion sent epoch=${marker.epoch}`);
        return true;
    }

    nativeViewportClipAvailable(window) {
        try {
            if (typeof window.data !== "function") {
                this.debug("[VIEWPORT_CLIP_CAPABILITY] unavailable data-method=false");
                return false;
            }
            const capability = window.data(CC_NIRI_VIEWPORT_CLIP_CAPABILITY_ROLE);
            this.debug(`[VIEWPORT_CLIP_CAPABILITY] type=${typeof capability}` +
                ` value=${String(capability)}`);
            return Boolean(capability);
        } catch (_) {
            return false;
        }
    }

    readMotionPlan(window, oldGeometry, newGeometry, screenRect) {
        if (!window || typeof window.data !== "function") return null;
        let marker;
        try {
            marker = window.data(CC_NIRI_MOTION_PLAN_ROLE);
        } catch (_) {
            return null;
        }
        // KWin exposes the native QVariantList as an array-like QJSValue,
        // not necessarily as a JavaScript Array.
        if (!marker || !marker.entries || marker.entries.length !== 2 ||
                !Number.isFinite(Number(marker.issuedAt)) ||
                Math.abs(Date.now() - Number(marker.issuedAt)) > 5000 ||
                (marker.type !== MotionType.WIDE_TO_PAIR &&
                 marker.type !== MotionType.PAIR_TO_WIDE)) return null;
        const geometryMatches = marker.role === "target"
            ? (rectNear(oldGeometry, marker.oldVisualRect) ||
                (marker.type === MotionType.PAIR_TO_WIDE &&
                    parked(oldGeometry, screenRect))) &&
                rectNear(newGeometry, marker.newVisualRect)
            : marker.role === "neighbor" &&
                (marker.type === MotionType.WIDE_TO_PAIR &&
                    parked(oldGeometry, screenRect) &&
                    rectNear(newGeometry, marker.newVisualRect));
        if (!geometryMatches) return null;
        const entries = [marker.entries[0], marker.entries[1]];
        const target = entries.find(entry => entry && entry.role === "target");
        const neighbor = entries.find(entry => entry && entry.role === "neighbor");
        if (!target || !neighbor) return null;
        this.debug(`[MOTION_PLAN] consume epoch=${marker.epoch}` +
            ` type=${marker.type} role=${marker.role}`);
        return Object.assign({}, marker, {
            snapshot: { type: marker.type, side: marker.side,
                target, neighbor },
        });
    }

    clearPendingDelta() {
        return this.motionTransaction.clear();
    }

    expireStalePendingDelta() {
        const expired = this.motionTransaction.expire(Date.now());
        if (expired) this.debug(`EXPIRE transaction=${expired.id}` +
            ` staleDelta=${expired.deltaX}`);
    }

    pairNeighbor(window, targetRect, side) {
        const opposite = side === "left" ? "right" : "left";
        const viewport = viewportFromSlot(targetRect, side, this.innerGap);
        for (const candidate of effects.stackingOrder) {
            if (candidate === window || !candidate.screen ||
                    candidate.screen.name !== this.targetOutputName) continue;
            const rect = candidate.geometry;
            if (visibleSlot(rect, viewport) === opposite &&
                Math.abs(rect.y - targetRect.y) < 2 &&
                Math.abs(rect.height - targetRect.height) < 2 &&
                (opposite === "right"
                    ? Math.abs(rect.x - targetRect.x - targetRect.width -
                        this.innerGap) < 3
                    : Math.abs(rect.x + rect.width + this.innerGap -
                        targetRect.x) < 3)) return candidate;
        }
        return null;
    }

    plannedNeighbor(plan) {
        if (!plan) return null;
        for (const candidate of effects.stackingOrder) {
            if (!candidate || typeof candidate.data !== "function") continue;
            const marker = candidate.data(CC_NIRI_MOTION_PLAN_ROLE);
            if (marker && marker.role === "neighbor" &&
                    marker.type === plan.type &&
                    Number(marker.epoch) === Number(plan.epoch)) return candidate;
        }
        return null;
    }

    virtualPairEntry(window, wideRect, screenRect, motionTime) {
        for (const candidate of effects.stackingOrder) {
            if (candidate === window || !candidate.screen ||
                    candidate.screen.name !== this.targetOutputName) continue;
            const neighborRect = candidate.geometry;
            const neighborSlot = visibleSlot(neighborRect, screenRect);
            if (!neighborSlot ||
                    Math.abs(neighborRect.y - wideRect.y) >= 2 ||
                    Math.abs(neighborRect.height - wideRect.height) >= 2) continue;
            const targetX = neighborSlot === "left"
                ? neighborRect.x + neighborRect.width + this.innerGap
                : neighborRect.x - neighborRect.width - this.innerGap;
            const pairRect = {
                x: targetX,
                y: neighborRect.y,
                width: neighborRect.width,
                height: neighborRect.height,
            };
            if (visibleSlot(pairRect, screenRect)) {
                const neighborVisual = this.motion.states.has(candidate)
                    ? this.motion.visualSnapshot(candidate, neighborRect, motionTime)
                    : neighborRect;
                const visualPairRect = Object.assign({}, pairRect, {
                    x: neighborSlot === "left"
                        ? neighborVisual.x + neighborVisual.width + this.innerGap
                        : neighborVisual.x - pairRect.width - this.innerGap,
                });
                return { pairRect, visualPairRect, neighbor: candidate };
            }
        }
        return null;
    }

    geometryChanged(window, oldGeometry) {
        this.releaseWideIsolation(window, "geometry-changed");
        if (!window.screen || window.screen.name !== this.targetOutputName) {
            return;
        }
        const screenRect = window.screen.geometry;
        const newGeometry = window.geometry;
        const motionTime = Date.now();
        const explicitPlan = this.readMotionPlan(window, oldGeometry,
            newGeometry, screenRect);

        const virtualEntry = parked(oldGeometry, screenRect) &&
            isFocusWide(newGeometry, screenRect)
            ? this.virtualPairEntry(window, newGeometry, screenRect,
                motionTime) : null;
        if ((explicitPlan && explicitPlan.role === "target") ||
                presentationTransition(oldGeometry, newGeometry, screenRect) ||
                virtualEntry) {
            const entering = explicitPlan
                ? explicitPlan.type === MotionType.PAIR_TO_WIDE
                : isFocusWide(newGeometry, screenRect);
            if (!entering) this.releaseAllWideIsolation("wide-exit");
            const pairRect = explicitPlan
                ? (entering ? explicitPlan.oldVisualRect :
                    explicitPlan.newVisualRect)
                : virtualEntry
                ? virtualEntry.pairRect
                : (entering ? oldGeometry : newGeometry);
            const wideRect = explicitPlan
                ? (entering ? explicitPlan.newVisualRect :
                    explicitPlan.oldVisualRect)
                : entering ? newGeometry : oldGeometry;
            const viewport = viewportFromSlot(pairRect,
                visibleSlot(pairRect, screenRect), this.innerGap);
            const side = explicitPlan ? explicitPlan.side :
                (pairRect.x + pairRect.width / 2 <
                    viewport.x + viewport.width / 2 ? "left" : "right");
            const anchor = side;
            const parkedWideEntry = entering && parked(oldGeometry, screenRect);
            const source = virtualEntry ? virtualEntry.visualPairRect :
                explicitPlan && parkedWideEntry
                ? explicitPlan.oldVisualRect :
                this.motion.states.has(window)
                ? this.motion.visualSnapshot(window, oldGeometry, motionTime)
                : oldGeometry;
            if (parkedWideEntry) {
                this.parkingGrabber.grab(window, "wide-virtual-entry");
            }
            const transform = anchoredScaleTranslation(source, newGeometry, anchor);
            const transaction = this.motionTransaction.begin({
                type: entering ? MotionType.PAIR_TO_WIDE : MotionType.WIDE_TO_PAIR,
                viewport,
                deltaX: 0,
                layoutEpoch: explicitPlan ? Number(explicitPlan.epoch) : undefined,
                now: motionTime,
            });
            transaction.wide = {
                wideRect,
                pairRect,
                side,
                target: window,
                snapshot: explicitPlan ? explicitPlan.snapshot :
                    widePairMotionSnapshot(transaction.type,
                        wideRect, pairRect, side, this.innerGap),
            };
            this.pendingWideExit = entering ? null : {
                wide: transaction.wide,
                viewport,
                armedAt: motionTime,
                transactionId: transaction.id,
            };
            this.motionTransaction.record("continuing", window);
            const targetMotion = this.motion.startTransaction(window,
                transaction, "continuing", {
                type: transaction.type,
                duration: this.presentationDuration,
                synchronizeDuration: true,
                startTime: transaction.armedAt,
                curve: MotionCurves.expressiveSpatial,
                oldGeometry,
                newGeometry,
                channels: [{
                    type: Effect.Scale,
                    anchor,
                    from: { value1: transform.scaleX, value2: 1 },
                    to: { value1: 1, value2: 1 },
                }, {
                    type: Effect.Translation,
                    from: { value1: transform.translationX, value2: 0 },
                    to: { value1: 0, value2: 0 },
                }].concat(parkedWideEntry ? [{
                    type: Effect.Opacity,
                    from: 0,
                    to: 1,
                }] : []),
                fragmentShader: this.viewportClip.shaderFor(viewport),
            });
            if (!targetMotion && parkedWideEntry) {
                this.parkingGrabber.release(window, "wide-virtual-no-op");
            }
            if (entering) {
                const neighbor = virtualEntry
                    ? virtualEntry.neighbor
                    : this.plannedNeighbor(explicitPlan) ||
                        this.pairNeighbor(window, pairRect, side);
                if (neighbor) {
                    const neighborRect = explicitPlan
                        ? explicitPlan.snapshot.neighbor.oldVisualRect
                        : neighbor.geometry;
                    const virtualRect = transaction.wide.snapshot.neighbor
                        .newVisualRect;
                    this.motionTransaction.record("outgoing", neighbor);
                    this.motion.startTransaction(neighbor, transaction, "outgoing", {
                        type: transaction.type,
                        duration: this.presentationDuration,
                        synchronizeDuration: true,
                        startTime: transaction.armedAt,
                        curve: MotionCurves.expressiveSpatial,
                        oldGeometry: neighborRect,
                        newGeometry: neighborRect,
                        channels: [{
                            type: Effect.Translation,
                            from: { value1: 0, value2: 0 },
                            to: { value1: virtualRect.x - neighborRect.x,
                                value2: 0 },
                        }, {
                            type: Effect.Opacity,
                            from: 1,
                            to: 0,
                        }],
                        fragmentShader: this.viewportClip.shaderFor(viewport),
                    });
                }
            }
            this.debug(`[MOTION_TX] BEGIN id=${transaction.id}` +
                ` type=${transaction.type} target=${side}`);
            if (entering) this.motionTransaction.clear();
            return;
        }

        if (!sameSize(oldGeometry, newGeometry)) return;
        const oldSlot = visibleSlot(oldGeometry, screenRect);
        const newSlot = visibleSlot(newGeometry, screenRect);
        const oldParked = parked(oldGeometry, screenRect);
        const newParked = parked(newGeometry, screenRect);
        this.expireStalePendingDelta();
        if (!(oldSlot || oldParked) || !(newSlot || newParked) ||
                Math.abs(oldGeometry.x - newGeometry.x) < 1) {
            return;
        }

        let animations;
        let incomingVisual = null;
        let motionType = MotionType.SCROLL;
        let activeTransaction = null;
        let motionRole = "static";
        let wideTiming = null;
        if (oldSlot && newSlot) {
            /*
             * Script commits the continuing column first. Both coordinates
             * are projections, never parking coordinates, so this is exactly
             * oldProjectedX - newProjectedX == scrollDeltaX.
             */
            const transaction = this.motionTransaction.arm(
                oldGeometry.x - newGeometry.x,
                window,
                Date.now(),
                {
                    type: MotionType.SCROLL,
                    viewport: viewportFromSlot(newGeometry, newSlot, this.innerGap),
                }
            );
            activeTransaction = transaction;
            motionRole = "continuing";
            this.debug(`[MOTION_TX] BEGIN id=${transaction.id}` +
                ` epoch=${transaction.layoutEpoch} type=${transaction.type}` +
                ` direction=${transaction.direction} delta=${transaction.deltaX}` +
                ` viewport=${transaction.viewport.x},${transaction.viewport.y}` +
                ` ${transaction.viewport.width}x${transaction.viewport.height}`);
            this.debug(`[MOTION_TX] ROLE id=${transaction.id} role=continuing`);
            animations = [{
                type: Effect.Translation,
                from: { value1: transaction.deltaX, value2: 0 },
                to: { value1: 0, value2: 0 }
            }];
            this.debug(`ARM transaction=${transaction.id} delta=${transaction.deltaX}` +
                ` oldProjectedX=${oldGeometry.x} newProjectedX=${newGeometry.x}`);
        } else if (oldParked && newSlot) {
            this.parkingGrabber.grab(window, "incoming");
            let transaction = this.motionTransaction.current(motionTime);
            const rememberedWide = this.pendingWideExit &&
                motionTime - this.pendingWideExit.armedAt <= 2000 &&
                wideExitNeighborMatches(this.pendingWideExit.wide,
                    newGeometry, this.innerGap)
                ? this.pendingWideExit : null;
            const pendingWide = rememberedWide ||
                (explicitPlan && explicitPlan.role === "neighbor" ? {
                    wide: {
                        wideRect: explicitPlan.snapshot.target.oldVisualRect,
                        pairRect: explicitPlan.snapshot.target.newVisualRect,
                        side: explicitPlan.side,
                        snapshot: explicitPlan.snapshot,
                    },
                    viewport: viewportFromSlot(
                        explicitPlan.snapshot.target.newVisualRect,
                        explicitPlan.side, this.innerGap),
                    armedAt: motionTime,
                    transactionId: -1,
                } : null);
            if (pendingWide && (!transaction ||
                    transaction.id !== pendingWide.transactionId)) {
                transaction = this.motionTransaction.begin({
                    type: MotionType.WIDE_TO_PAIR,
                    viewport: pendingWide.viewport,
                    deltaX: 0,
                    now: pendingWide.armedAt,
                });
                transaction.wide = pendingWide.wide;
                this.debug(`[MOTION_TX] recover wide exit id=${transaction.id}`);
            }
            const pendingDeltaX = transaction ? transaction.deltaX : null;
            if (transaction && transaction.type === MotionType.WIDE_TO_PAIR &&
                    transaction.wide) {
                const wide = transaction.wide;
                if (!wideExitNeighborMatches(wide, newGeometry, this.innerGap)) {
                    this.parkingGrabber.release(window, "wide-non-neighbor");
                    return;
                }
                const virtualX = wide.snapshot.neighbor.oldVisualRect.x;
                wideTiming = wideTimelineSample(transaction.armedAt,
                    motionTime, this.presentationDuration);
                const translationX = (virtualX - newGeometry.x) *
                    (1 - wideTiming.progress);
                this.motionTransaction.record("incoming", window);
                activeTransaction = transaction;
                motionRole = "incoming";
                motionType = transaction.type;
                animations = [{
                    type: Effect.Translation,
                    from: { value1: translationX, value2: 0 },
                    to: { value1: 0, value2: 0 },
                }, {
                    type: Effect.Opacity,
                    from: wideTiming.progress,
                    to: 1,
                }];
                incomingVisual = incomingVisualStart(newGeometry,
                    translationX, 1, "center", wideTiming.progress);
                this.debug(`[MOTION_TX] ROLE id=${transaction.id}` +
                    ` role=incoming virtualX=${virtualX}` +
                    ` progress=${wideTiming.progress.toFixed(3)}`);
                this.pendingWideExit = null;
            } else if (!transaction) {
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
                    from: { value1: MotionTokens.subtleIncomingScale, value2: 1 },
                    to: { value1: 1, value2: 1 }
                }, {
                    type: Effect.Opacity,
                    from: MotionTokens.subtleIncomingOpacity,
                    to: 1.0
                }];
                incomingVisual = incomingVisualStart(
                    newGeometry,
                    fromX,
                    MotionTokens.subtleIncomingScale,
                    newSlot === "right" ? "right" : "left",
                    MotionTokens.subtleIncomingOpacity
                );
                const closeTransaction = this.motionTransaction.begin({
                    type: MotionType.CLOSE_REFILL,
                    deltaX: 0,
                    viewport: viewportFromSlot(newGeometry, newSlot, this.innerGap),
                    role: "incoming",
                    window,
                });
                activeTransaction = closeTransaction;
                motionRole = "incoming";
                motionType = closeTransaction.type;
                this.debug(`[MOTION_TX] BEGIN id=${closeTransaction.id}` +
                    ` epoch=${closeTransaction.layoutEpoch}` +
                    ` type=${closeTransaction.type} direction=none delta=0`);
                this.debug(`[MOTION_TX] ROLE id=${closeTransaction.id} role=incoming`);
                this.debug(`INCOMING_UNARMED transaction=${closeTransaction.id}` +
                    ` slot=${newSlot}` +
                    ` newProjectedX=${newGeometry.x}`);
            } else if (pendingDeltaX > 0) {
                this.motionTransaction.record("incoming", window);
                activeTransaction = transaction;
                motionRole = "incoming";
                motionType = transaction.type;
                this.debug(`[MOTION_TX] ROLE id=${transaction.id} role=incoming`);
                const nativeClip = this.nativeViewportClipAvailable(window);
                if (nativeClip) {
                    animations = [{
                        type: Effect.Translation,
                        from: { value1: pendingDeltaX, value2: 0 },
                        to: { value1: 0, value2: 0 }
                    }];
                    incomingVisual = incomingVisualStart(
                        newGeometry,
                        pendingDeltaX,
                        1,
                        "center",
                        1
                    );
                    this.debug(`INCOMING_FULL_DELTA transaction=${transaction.id}` +
                        ` delta=${pendingDeltaX}` +
                        ` newProjectedX=${newGeometry.x}`);
                } else {
                    /* Keep the historical in-slot reveal when the native
                     * device-space clip effect is not actually available. */
                    animations = [{
                        type: Effect.Translation,
                        from: { value1: SAFE_RIGHT_EDGE_SLIDE_X, value2: 0 },
                        to: { value1: 0, value2: 0 }
                    }, {
                        type: Effect.Scale,
                        anchor: "right",
                        sourceAnchor: Effect.Right,
                        targetAnchor: Effect.Right,
                        from: { value1: MotionTokens.subtleIncomingScale, value2: 1 },
                        to: { value1: 1, value2: 1 }
                    }, {
                        type: Effect.Opacity,
                        from: MotionTokens.subtleIncomingOpacity,
                        to: 1.0
                    }];
                    incomingVisual = incomingVisualStart(
                        newGeometry,
                        SAFE_RIGHT_EDGE_SLIDE_X,
                        MotionTokens.subtleIncomingScale,
                        "right",
                        MotionTokens.subtleIncomingOpacity
                    );
                    this.debug(`INCOMING_RIGHT_SAFE transaction=${transaction.id}` +
                        ` delta=${pendingDeltaX}` +
                        ` newProjectedX=${newGeometry.x}`);
                }
            } else {
                this.motionTransaction.record("incoming", window);
                activeTransaction = transaction;
                motionRole = "incoming";
                motionType = transaction.type;
                this.debug(`[MOTION_TX] ROLE id=${transaction.id} role=incoming`);
                animations = [{
                    type: Effect.Translation,
                    from: { value1: pendingDeltaX, value2: 0 },
                    to: { value1: 0, value2: 0 }
                }];
                incomingVisual = incomingVisualStart(
                    newGeometry,
                    pendingDeltaX,
                    1,
                    "center",
                    1
                );
                this.debug(`INCOMING transaction=${transaction.id}` +
                    ` delta=${pendingDeltaX}` +
                    ` newProjectedX=${newGeometry.x}`);
            }
        } else if (oldSlot && newParked) {
            const transaction = this.motionTransaction.current(Date.now());
            if (!transaction) return;
            this.parkingGrabber.grab(window, "outgoing");
            const pendingDeltaX = transaction.deltaX;
            this.motionTransaction.record("outgoing", window);
            activeTransaction = transaction;
            motionRole = "outgoing";
            motionType = transaction.type;
            this.debug(`[MOTION_TX] ROLE id=${transaction.id} role=outgoing`);
            const oldProjectedX = oldGeometry.x;
            const newProjectedX = oldProjectedX - pendingDeltaX;
            if (pendingDeltaX < 0) {
                if (this.nativeViewportClipAvailable(window)) {
                    animations = [{
                        type: Effect.Translation,
                        from: { value1: oldGeometry.x - newGeometry.x, value2: 0 },
                        to: { value1: newProjectedX - newGeometry.x, value2: 0 }
                    }];
                    this.debug(`OUTGOING_FULL_DELTA` +
                        ` transaction=${transaction.id}` +
                        ` delta=${pendingDeltaX}` +
                        ` oldProjectedX=${oldProjectedX}` +
                        ` newProjectedX=${newProjectedX}`);
                } else {
                    /* Move only inside the 24 px primary right margin, then
                     * fade to its already-committed parking geometry. */
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
                    this.debug(`OUTGOING_RIGHT_SAFE transaction=${transaction.id}` +
                        ` delta=${pendingDeltaX}` +
                        ` holdProjectedX=${oldProjectedX}`);
                }
            } else {
                animations = [{
                    type: Effect.Translation,
                    from: { value1: oldGeometry.x - newGeometry.x, value2: 0 },
                    to: { value1: newProjectedX - newGeometry.x, value2: 0 }
                }];
                this.debug(`OUTGOING transaction=${transaction.id}` +
                    ` delta=${pendingDeltaX}` +
                    ` oldProjectedX=${oldProjectedX} newProjectedX=${newProjectedX}`);
            }
            const completedTransaction = this.clearPendingDelta();
            if (completedTransaction) {
                this.debug(`[MOTION_TX] COMPLETE id=${completedTransaction.id}`);
            }
        } else {
            return;
        }

        if (incomingVisual) window.ccNiriIncomingVisual = incomingVisual;
        const motionOptions = {
            type: motionType,
            duration: wideTiming ? wideTiming.remainingDuration : this.duration,
            curve: wideTiming ? MotionCurves.expressiveSpatial :
                MotionCurves.standardDecel,
            synchronizeDuration: Boolean(wideTiming),
            oldGeometry,
            newGeometry,
            channels: animations,
        };
        if (wideTiming) motionOptions.startTime = motionTime;
        if (activeTransaction) {
            motionOptions.fragmentShader = this.viewportClip.shaderFor(
                activeTransaction.viewport
            );
        }
        const motionState = activeTransaction
            ? this.motion.startTransaction(
                window,
                activeTransaction,
                motionRole,
                motionOptions
            )
            : this.motion.start(window, motionOptions);
        if (motionType === MotionType.WIDE_TO_PAIR &&
                motionRole === "incoming") this.motionTransaction.clear();
        if (!motionState) this.parkingGrabber.release(window, "motion-no-op");
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
        channelDistance,
        distanceAwareDuration,
        motionValuesEqual,
        retargetedTranslation,
        sampleMotionState,
        visualRectFor,
        MotionTransaction,
        MotionController,
        sameSize,
        isColumnSize,
        visibleSlot,
        isFocusWide,
        presentationTransition,
        wideExitNeighborMatches,
        parked,
        incomingVisualStart,
        CCNiriScrollTransition,
    };
} else {
    new CCNiriScrollTransition();
}
