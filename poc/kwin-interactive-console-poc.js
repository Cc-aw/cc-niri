/*
 * Temporary KWin 6 POC. Loaded directly through org.kde.KWin/Scripting.
 * This is deliberately not a packaged or persistent KWin script.
 */

const PREFIX = "[cc-niri-maximize-poc] ";
const GAP = { top: 42, right: 10, bottom: 70, left: 10 };
const pseudoStates = new Map();
const nativeStates = new Map();
let dockHelperState = null;

function log(message) {
    console.info(PREFIX + message);
}

function rectCopy(rect) {
    return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
    };
}

function rectText(rect) {
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function sameRect(a, b) {
    return a.x === b.x && a.y === b.y &&
        a.width === b.width && a.height === b.height;
}

function screens() {
    return workspace.screens.slice().sort((a, b) => {
        if (a.geometry.x !== b.geometry.x) {
            return a.geometry.x - b.geometry.x;
        }
        return a.geometry.y - b.geometry.y;
    });
}

function targetOutput() {
    return screens()[0] || null;
}

function secondaryOutput() {
    const target = targetOutput();
    return screens().find(output => output !== target) || null;
}

function pseudoGeometry(output) {
    const screen = output.geometry;
    return {
        x: screen.x + GAP.left,
        y: screen.y + GAP.top,
        width: screen.width - GAP.left - GAP.right,
        height: screen.height - GAP.top - GAP.bottom,
    };
}

function eligible(window) {
    return window && window.normalWindow && window.resizeable;
}

function windowText(window) {
    if (!window) {
        return "window=<none>";
    }
    return `caption=${window.caption} output=${window.output ? window.output.name : "<none>"}` +
        ` geometry=${rectText(window.frameGeometry)}` +
        ` maximized=${window.maximizeMode}` +
        ` fullScreen=${window.fullScreen}`;
}

function inspectArea(window) {
    if (!window) {
        return;
    }
    const maximize = workspace.clientArea(KWin.MaximizeArea, window);
    const fullscreen = workspace.clientArea(KWin.FullScreenArea, window);
    log(`areas caption=${window.caption}` +
        ` output=${rectText(window.output.geometry)}` +
        ` maximize=${rectText(maximize)}` +
        ` fullscreen=${rectText(fullscreen)}`);
}

function inspect() {
    const ordered = screens();
    log(`screens count=${ordered.length}`);
    ordered.forEach((output, index) => {
        log(`screen[${index}] name=${output.name} geometry=${rectText(output.geometry)}`);
    });

    log(`active ${windowText(workspace.activeWindow)}`);
    inspectArea(workspace.activeWindow);

    workspace.windowList().forEach(window => {
        if (window.normalWindow || window.dock) {
            log(`${window.dock ? "dock" : "normal"} ${windowText(window)}`);
        }
    });
}

function findWindowOn(output, excluded) {
    const candidates = workspace.windowList().filter(window =>
        eligible(window) && window.output === output && window !== excluded
    );
    return candidates.find(window =>
        !window.skipTaskbar &&
        !window.skipPager &&
        window.caption &&
        !window.caption.includes("Xwayland")
    ) || candidates[0] || null;
}

function activateTarget() {
    const output = targetOutput();
    const window = findWindowOn(output, null);
    if (!window) {
        log("FAIL activate-target: no eligible normal window on target output");
        return;
    }
    workspace.activeWindow = window;
    log(`PASS activate-target ${windowText(window)}`);
}

function activateSecondary() {
    const output = secondaryOutput();
    const window = output ? findWindowOn(output, null) : null;
    if (!window) {
        log("FAIL activate-secondary: no eligible normal window on secondary output");
        return;
    }
    workspace.activeWindow = window;
    log(`PASS activate-secondary ${windowText(window)}`);
}

function togglePseudo() {
    const window = workspace.activeWindow;
    const output = targetOutput();
    if (!eligible(window) || !output || window.output !== output || window.fullScreen) {
        log(`FAIL pseudo-toggle ineligible ${windowText(window)}`);
        return;
    }

    const prior = pseudoStates.get(window);
    if (prior) {
        window.setMaximize(false, false);
        window.frameGeometry = prior.restoreGeometry;
        const passed = sameRect(window.frameGeometry, prior.restoreGeometry);
        pseudoStates.delete(window);
        log(`${passed ? "PASS" : "FAIL"} pseudo-leave ` + windowText(window) +
            ` expected=${rectText(prior.restoreGeometry)}`);
        return;
    }

    const restoreGeometry = rectCopy(window.frameGeometry);
    const expected = pseudoGeometry(output);
    window.setMaximize(false, false);
    window.frameGeometry = expected;
    const passed = sameRect(window.frameGeometry, expected) && !window.fullScreen;
    pseudoStates.set(window, {
        restoreGeometry,
        pseudoGeometry: rectCopy(window.frameGeometry),
    });
    log(`${passed ? "PASS" : "FAIL"} pseudo-enter ` + windowText(window) +
        ` expected=${rectText(expected)} restore=${rectText(restoreGeometry)}`);
    inspectArea(window);
}

function toggleSecondaryNativeMaximize() {
    const window = workspace.activeWindow;
    const output = secondaryOutput();
    if (!eligible(window) || !output || window.output !== output || window.fullScreen) {
        log(`FAIL secondary-native-toggle ineligible ${windowText(window)}`);
        return;
    }

    const prior = nativeStates.get(window);
    if (prior) {
        window.setMaximize(false, false);
        window.frameGeometry = prior.restoreGeometry;
        nativeStates.delete(window);
        log(`PASS secondary-native-leave ${windowText(window)}`);
        return;
    }

    const restoreGeometry = rectCopy(window.frameGeometry);
    const expected = workspace.clientArea(KWin.MaximizeArea, window);
    window.setMaximize(true, true);
    const actual = window.frameGeometry;
    const passed = sameRect(actual, expected);
    nativeStates.set(window, { restoreGeometry });
    log(`${passed ? "PASS" : "FAIL"} secondary-native-enter ` + windowText(window) +
        ` expected=${rectText(expected)}`);
}

function verifyPseudo() {
    const entries = Array.from(pseudoStates.entries());
    if (!entries.length) {
        log("FAIL verify-pseudo: no pseudo-maximized window is tracked");
        return;
    }
    entries.forEach(([window, state]) => {
        const passed = sameRect(window.frameGeometry, state.pseudoGeometry);
        log(`${passed ? "PASS" : "FAIL"} pseudo-stable ${windowText(window)}` +
            ` expected=${rectText(state.pseudoGeometry)}`);
    });
}

function occupyDock() {
    if (dockHelperState) {
        log("FAIL dock-occupy: helper already active");
        return;
    }
    const output = targetOutput();
    const pseudoWindow = Array.from(pseudoStates.keys()).find(window => window.output === output);
    const helper = output ? (
        workspace.windowList().find(window =>
            eligible(window) &&
            window.output === output &&
            window !== pseudoWindow &&
            window.caption === "Desktop Shell Scripting Console"
        ) || findWindowOn(output, pseudoWindow)
    ) : null;
    if (!output || !pseudoWindow || !helper) {
        log("FAIL dock-occupy: need one pseudo window and a second normal window on target");
        return;
    }
    dockHelperState = {
        window: helper,
        geometry: rectCopy(helper.frameGeometry),
        maximized: helper.maximizeMode,
    };
    helper.setMaximize(false, false);
    const screen = output.geometry;
    helper.frameGeometry = {
        x: screen.x + Math.round((screen.width - dockHelperState.geometry.width) / 2),
        y: screen.y + screen.height - dockHelperState.geometry.height,
        width: dockHelperState.geometry.width,
        height: dockHelperState.geometry.height,
    };
    workspace.activeWindow = helper;
    log(`PASS dock-occupy helper=${windowText(helper)}`);
    verifyPseudo();
    workspace.windowList().filter(window => window.dock).forEach(window => {
        log(`dock-after-occupy ${windowText(window)}`);
    });
}

function releaseDock() {
    if (!dockHelperState) {
        log("FAIL dock-release: no helper active");
        return;
    }
    const state = dockHelperState;
    state.window.setMaximize(false, false);
    state.window.frameGeometry = state.geometry;
    dockHelperState = null;
    log(`PASS dock-release helper=${windowText(state.window)}`);
    verifyPseudo();
    workspace.windowList().filter(window => window.dock).forEach(window => {
        log(`dock-after-release ${windowText(window)}`);
    });
}

registerShortcut("CCNiriPOCInspect", "CC Niri POC Inspect", "", inspect);
registerShortcut("CCNiriPOCActivateTarget", "CC Niri POC Activate Target", "", activateTarget);
registerShortcut("CCNiriPOCActivateSecondary", "CC Niri POC Activate Secondary", "", activateSecondary);
registerShortcut("CCNiriPOCTogglePseudo", "CC Niri POC Toggle Pseudo", "", togglePseudo);
registerShortcut("CCNiriPOCToggleSecondaryNative", "CC Niri POC Toggle Secondary Native", "", toggleSecondaryNativeMaximize);
registerShortcut("CCNiriPOCVerifyPseudo", "CC Niri POC Verify Pseudo", "", verifyPseudo);
registerShortcut("CCNiriPOCOccupyDock", "CC Niri POC Occupy Dock", "", occupyDock);
registerShortcut("CCNiriPOCReleaseDock", "CC Niri POC Release Dock", "", releaseDock);

log("loaded");
inspect();
