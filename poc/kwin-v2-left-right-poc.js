/*
 * Phase 2/3 POC: safe-area Quick Tile layouts.
 * This is loaded directly through org.kde.KWin/Scripting and is not packaged.
 */

const TAG = "[cc-niri-v2-layout-poc]";
const FULL_MAXIMIZE_MODE = 3;
const GAP = { top: 50, right: 24, bottom: 70, left: 24, inner: 8 };
const states = new Map();

function rectCopy(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function rectText(rect) {
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function sameRect(a, b) {
    return a && b && a.x === b.x && a.y === b.y &&
        a.width === b.width && a.height === b.height;
}

function safeRectFor(output) {
    const screen = output.geometry;
    const xInset = Math.min(GAP.left, Math.max(0, screen.width - 1));
    const yInset = Math.min(GAP.top, Math.max(0, screen.height - 1));
    return {
        x: screen.x + xInset,
        y: screen.y + yInset,
        width: Math.max(1, screen.width - GAP.left - GAP.right),
        height: Math.max(1, screen.height - GAP.top - GAP.bottom),
    };
}

function rectForLayout(mode, safeRect, innerGap) {
    const gap = Math.min(
        Math.max(0, innerGap),
        Math.max(0, Math.min(safeRect.width, safeRect.height) - 2)
    );
    const leftWidth = Math.floor((safeRect.width - gap) / 2);
    const rightWidth = safeRect.width - gap - leftWidth;
    const topHeight = Math.floor((safeRect.height - gap) / 2);
    const bottomHeight = safeRect.height - gap - topHeight;
    const rightX = safeRect.x + leftWidth + gap;
    const bottomY = safeRect.y + topHeight + gap;

    if (mode === "left" || mode === "topLeft" || mode === "bottomLeft") {
        return {
            x: safeRect.x,
            y: mode === "bottomLeft" ? bottomY : safeRect.y,
            width: leftWidth,
            height: mode === "left" ? safeRect.height :
                (mode === "topLeft" ? topHeight : bottomHeight),
        };
    }
    if (mode === "right" || mode === "topRight" || mode === "bottomRight") {
        return {
            x: rightX,
            y: mode === "bottomRight" ? bottomY : safeRect.y,
            width: rightWidth,
            height: mode === "right" ? safeRect.height :
                (mode === "topRight" ? topHeight : bottomHeight),
        };
    }
    if (mode === "top" || mode === "bottom") {
        return {
            x: safeRect.x,
            y: mode === "top" ? safeRect.y : bottomY,
            width: safeRect.width,
            height: mode === "top" ? topHeight : bottomHeight,
        };
    }
    return null;
}

function orderedOutputs() {
    return workspace.screens.slice().sort((a, b) =>
        a.geometry.x === b.geometry.x
            ? a.geometry.y - b.geometry.y
            : a.geometry.x - b.geometry.x
    );
}

function targetOutput() {
    return orderedOutputs()[0] || null;
}

function near(actual, expected) {
    return Math.abs(Number(actual) - expected) < 0.01;
}

function detectedMode(window) {
    const relative = window.tile ? window.tile.relativeGeometry : null;
    if (!relative) return "normal";
    const key = [relative.x, relative.y, relative.width, relative.height]
        .map(value => Number(value).toFixed(2)).join(",");
    const modes = {
        "0.00,0.00,0.50,1.00": "left",
        "0.50,0.00,0.50,1.00": "right",
        "0.00,0.00,1.00,0.50": "top",
        "0.00,0.50,1.00,0.50": "bottom",
        "0.00,0.00,0.50,0.50": "topLeft",
        "0.50,0.00,0.50,0.50": "topRight",
        "0.00,0.50,0.50,0.50": "bottomLeft",
        "0.50,0.50,0.50,0.50": "bottomRight",
    };
    if (modes[key]) return modes[key];
    return "unsupported";
}

function isTileMode(mode) {
    return mode !== "normal" && mode !== "unsupported";
}

function stateFor(window) {
    let state = states.get(window);
    if (!state) {
        state = {
            layoutMode: "normal",
            restoreGeometry: null,
            restoreOutput: null,
            layoutModeBeforeFullscreen: "normal",
            pendingAction: null,
            internalChange: false,
        };
        states.set(window, state);
    }
    return state;
}

function eligible(window) {
    return window && window.normalWindow && window.resizeable && !window.fullScreen;
}

function captureNativeTransition(window, oldGeometry) {
    const output = targetOutput();
    const state = stateFor(window);
    if (state.internalChange || state.layoutMode !== "normal" || !eligible(window)) {
        return;
    }
    const mode = detectedMode(window);
    if (isTileMode(mode)) {
        state.restoreGeometry = rectCopy(oldGeometry);
        state.restoreOutput = window.output;
        console.info(`${TAG} CAPTURE ${window.caption}` +
            ` mode=${mode} restore=${rectText(state.restoreGeometry)}`);
    }
}

function applyDetectedTile(window, signalName) {
    const state = stateFor(window);
    if (state.internalChange || !eligible(window)) return;

    const output = targetOutput();
    const mode = detectedMode(window);
    if (!output || window.output !== output) {
        if (isTileMode(mode)) {
            state.layoutMode = mode;
        } else if (mode === "normal" && isTileMode(state.layoutMode)) {
            state.layoutMode = "normal";
            state.restoreGeometry = null;
            state.restoreOutput = null;
        }
        return;
    }

    if (isTileMode(mode)) {
        if (!state.restoreGeometry && state.layoutMode === "normal") {
            // frameGeometryChanged(oldGeometry) normally captured this first.
            // This fallback is only for a POC loaded after a window was tiled.
            state.restoreGeometry = rectCopy(window.frameGeometry);
            state.restoreOutput = window.output;
        }
        const expected = rectForLayout(mode, safeRectFor(output), GAP.inner);
        state.internalChange = true;
        try {
            window.frameGeometry = expected;
            state.layoutMode = mode;
        } finally {
            state.internalChange = false;
        }
        console.info(`${TAG} ${sameRect(window.frameGeometry, expected) ? "PASS" : "FAIL"}` +
            ` signal=${signalName} mode=${mode}` +
            ` geometry=${rectText(window.frameGeometry)}` +
            ` expected=${rectText(expected)}` +
            ` restore=${rectText(state.restoreGeometry)}`);
        return;
    }

    if (mode === "normal" && isTileMode(state.layoutMode)) {
        if (state.pendingAction === "enterMaximize") return;
        const restore = state.restoreGeometry ? rectCopy(state.restoreGeometry) : null;
        state.internalChange = true;
        try {
            if (restore) window.frameGeometry = restore;
            state.layoutMode = "normal";
            state.restoreGeometry = null;
            state.restoreOutput = null;
        } finally {
            state.internalChange = false;
        }
        console.info(`${TAG} RESTORE signal=${signalName}` +
            ` geometry=${rectText(window.frameGeometry)}`);
    }
}

function enterPseudoMaximize(window, state, reason) {
    const output = targetOutput();
    if (!output || window.output !== output || window.fullScreen) return;
    const expected = safeRectFor(output);
    state.internalChange = true;
    try {
        window.setMaximize(false, false);
        window.frameGeometry = expected;
        state.layoutMode = "maximize";
        state.pendingAction = null;
    } finally {
        state.internalChange = false;
    }
    console.info(`${TAG} ${sameRect(window.frameGeometry, expected) ? "PASS" : "FAIL"}` +
        ` ${reason} mode=maximize geometry=${rectText(window.frameGeometry)}` +
        ` restore=${state.restoreGeometry ? rectText(state.restoreGeometry) : "none"}`);
}

function leavePseudoMaximize(window, state) {
    const restore = state.restoreGeometry ? rectCopy(state.restoreGeometry) : null;
    state.internalChange = true;
    try {
        window.setMaximize(false, false);
        if (restore) window.frameGeometry = restore;
        state.layoutMode = "normal";
        state.restoreGeometry = null;
        state.restoreOutput = null;
        state.pendingAction = null;
    } finally {
        state.internalChange = false;
    }
    console.info(`${TAG} RESTORE maximize geometry=${rectText(window.frameGeometry)}`);
}

function onMaximizedAboutToChange(window, mode) {
    const state = stateFor(window);
    if (state.internalChange || window.fullScreen) return;
    const target = targetOutput();
    const onTarget = target && window.output === target;
    if (Number(mode) === FULL_MAXIMIZE_MODE) {
        if (state.layoutMode === "normal" && !state.restoreGeometry) {
            state.restoreGeometry = rectCopy(window.frameGeometry);
            state.restoreOutput = window.output;
        }
        if (onTarget && state.layoutMode === "maximize") {
            state.pendingAction = "leaveMaximize";
        } else {
            state.pendingAction = onTarget ? "enterMaximize" : "nativeMaximize";
        }
    } else if (!onTarget && state.layoutMode === "maximize") {
        state.pendingAction = "nativeRestore";
    }
}

function onMaximizedChanged(window) {
    const state = stateFor(window);
    if (state.internalChange || !state.pendingAction) return;
    const action = state.pendingAction;
    state.pendingAction = null;
    if (action === "enterMaximize") {
        enterPseudoMaximize(window, state, "ENTER");
    } else if (action === "leaveMaximize") {
        leavePseudoMaximize(window, state);
    } else if (action === "nativeMaximize") {
        state.layoutMode = "maximize";
        console.info(`${TAG} NATIVE mode=maximize output=${window.output.name}` +
            ` geometry=${rectText(window.frameGeometry)}`);
    } else if (action === "nativeRestore") {
        state.layoutMode = "normal";
        state.restoreGeometry = null;
        state.restoreOutput = null;
    }
}

function translateRestoreGeometry(state, newOutput) {
    if (!state.restoreGeometry || !newOutput) return;
    if (!state.restoreOutput) {
        state.restoreOutput = newOutput;
        return;
    }
    if (state.restoreOutput === newOutput) return;
    const oldScreen = state.restoreOutput.geometry;
    const newScreen = newOutput.geometry;
    state.restoreGeometry.x += newScreen.x - oldScreen.x;
    state.restoreGeometry.y += newScreen.y - oldScreen.y;
    state.restoreOutput = newOutput;
    console.info(`${TAG} TRANSLATE restore=${rectText(state.restoreGeometry)}` +
        ` output=${newOutput.name}`);
}

function onOutputChanged(window) {
    const state = stateFor(window);
    if (state.internalChange || window.fullScreen) return;
    const output = targetOutput();
    if (!output) return;
    translateRestoreGeometry(state, window.output);

    if (window.output === output) {
        if (Number(window.maximizeMode) === FULL_MAXIMIZE_MODE) {
            enterPseudoMaximize(window, state, "ADOPT");
            return;
        }
        if (isTileMode(detectedMode(window))) {
            applyDetectedTile(window, "outputChanged-adopt");
        }
        return;
    }

    if (state.layoutMode === "maximize" && Number(window.maximizeMode) !== FULL_MAXIMIZE_MODE) {
        state.internalChange = true;
        try {
            window.setMaximize(true, true);
        } finally {
            state.internalChange = false;
        }
        console.info(`${TAG} NATIVE-TRANSFER mode=maximize output=${window.output.name}` +
            ` geometry=${rectText(window.frameGeometry)}`);
    } else if (isTileMode(detectedMode(window))) {
        state.layoutMode = detectedMode(window);
        console.info(`${TAG} NATIVE-TRANSFER mode=${state.layoutMode}` +
            ` output=${window.output.name} geometry=${rectText(window.frameGeometry)}`);
    }
}

function applySavedLayout(window, state, reason) {
    const output = targetOutput();
    if (!output || window.output !== output || window.fullScreen) return;
    const mode = state.layoutModeBeforeFullscreen;
    const expected = mode === "maximize"
        ? safeRectFor(output)
        : rectForLayout(mode, safeRectFor(output), GAP.inner);
    if (!expected) return;
    state.internalChange = true;
    try {
        window.setMaximize(false, false);
        window.frameGeometry = expected;
        state.layoutMode = mode;
    } finally {
        state.internalChange = false;
    }
    console.info(`${TAG} ${sameRect(window.frameGeometry, expected) ? "PASS" : "FAIL"}` +
        ` ${reason} mode=${mode} geometry=${rectText(window.frameGeometry)}`);
}

function onFullScreenChanged(window) {
    const state = stateFor(window);
    if (state.internalChange) return;
    if (window.fullScreen) {
        state.layoutModeBeforeFullscreen = state.layoutMode;
        console.info(`${TAG} FULLSCREEN enter prior=${state.layoutMode}` +
            ` geometry=${rectText(window.frameGeometry)}`);
        return;
    }
    applySavedLayout(window, state, "FULLSCREEN-RESTORE");
}

function setup(window) {
    if (!window || states.has(window)) return;
    stateFor(window);
    window.frameGeometryChanged.connect(oldGeometry =>
        captureNativeTransition(window, oldGeometry));
    window.tileChanged.connect(() => applyDetectedTile(window, "tileChanged"));
    window.quickTileModeChanged.connect(() =>
        applyDetectedTile(window, "quickTileModeChanged"));
    window.maximizedAboutToChange.connect(mode =>
        onMaximizedAboutToChange(window, mode));
    window.maximizedChanged.connect(() => onMaximizedChanged(window));
    window.outputChanged.connect(() => onOutputChanged(window));
    window.fullScreenChanged.connect(() => onFullScreenChanged(window));
    window.closed.connect(() => states.delete(window));
}

workspace.windowList().forEach(setup);
workspace.windowAdded.connect(setup);
console.info(`${TAG} loaded safe=${rectText(safeRectFor(targetOutput()))}` +
    ` inner=${GAP.inner}`);
