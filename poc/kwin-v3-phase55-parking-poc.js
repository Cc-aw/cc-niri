/* Temporary Phase 5.5 parking-zone POC. Never packaged. */

const TAG = "[cc-niri-v3-phase55-poc]";
const TEST_X = [-2500, -5000, -10000];
let state = null;
let activeSignalCount = 0;

function copyRect(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function rectText(rect) {
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function sameX(actual, expected) {
    return Math.abs(actual - expected) < 0.01;
}

const activeSignal = workspace.activeWindowChanged || workspace.windowActivated;
if (activeSignal) {
    activeSignal.connect(() => {
        activeSignalCount++;
        if (state) {
            console.info(`${TAG} SIGNAL count=${activeSignalCount}` +
                ` active=${workspace.activeWindow ? workspace.activeWindow.caption : "<none>"}`);
        }
    });
}

function findWindow(part) {
    const needle = part.toLowerCase();
    return workspace.windowList().find(window =>
        window.normalWindow && window.moveable && window.resizeable &&
        String(window.resourceClass || "").toLowerCase().includes(needle)
    ) || null;
}

function step() {
    if (!state) {
        const target = findWindow("zen_browser");
        const anchor = findWindow("org.kde.konsole");
        if (!target || !anchor) {
            console.info(`${TAG} FAIL missing-target-or-anchor`);
            return;
        }
        state = {
            target,
            anchor,
            restore: copyRect(target.frameGeometry),
            testIndex: 0,
            expectedX: TEST_X[0],
            waitingForAltTab: false,
            baselineSignals: 0,
        };
        target.frameGeometry = {
            x: state.expectedX,
            y: state.restore.y,
            width: state.restore.width,
            height: state.restore.height,
        };
        console.info(`${TAG} SET x=${state.expectedX}`);
        return;
    }

    if (state.waitingForAltTab) {
        const activePassed = workspace.activeWindow === state.target;
        const signalPassed = activeSignalCount > state.baselineSignals;
        const output = state.target.output ? state.target.output.name : "<none>";
        console.info(`${TAG} ALTTAB ${activePassed && signalPassed && output === "DP-1" ? "PASS" : "FAIL"}` +
            ` active=${workspace.activeWindow ? workspace.activeWindow.caption : "<none>"}` +
            ` signalDelta=${activeSignalCount - state.baselineSignals}` +
            ` geometry=${rectText(state.target.frameGeometry)} output=${output}`);
        state.target.frameGeometry = state.restore;
        workspace.activeWindow = state.target;
        console.info(`${TAG} DONE restored=${rectText(state.target.frameGeometry)}`);
        state = null;
        return;
    }

    const actual = state.target.frameGeometry;
    const output = state.target.output ? state.target.output.name : "<none>";
    const passed = sameX(actual.x, state.expectedX) && output === "DP-1";
    console.info(`${TAG} PARK ${passed ? "PASS" : "FAIL"}` +
        ` requestedX=${state.expectedX} actual=${rectText(actual)} output=${output}`);

    state.testIndex++;
    if (state.testIndex < TEST_X.length) {
        state.expectedX = TEST_X[state.testIndex];
        state.target.frameGeometry = {
            x: state.expectedX,
            y: state.restore.y,
            width: state.restore.width,
            height: state.restore.height,
        };
        console.info(`${TAG} SET x=${state.expectedX}`);
        return;
    }

    workspace.activeWindow = state.target;
    workspace.activeWindow = state.anchor;
    state.baselineSignals = activeSignalCount;
    state.waitingForAltTab = true;
    console.info(`${TAG} ALTTAB_READY target=${state.target.caption}` +
        ` geometry=${rectText(state.target.frameGeometry)} output=${output}`);
}

registerShortcut("CCNiriV3Phase55POCStep", "CC Niri V3 Phase 5.5 POC Step", "", step);
console.info(`${TAG} loaded`);
