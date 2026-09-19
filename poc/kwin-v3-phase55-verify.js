/* Read-only Phase 5.5 runtime verifier. Never packaged. */

const TAG = "[cc-niri-v3-phase55-verify]";
const SAFE = { x: 24, y: 50, width: 2512, height: 1320 };
let snapshotIndex = 0;
let outputChangeCount = 0;
let activeSignalCount = 0;
let altTabState = null;

function near(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.01;
}

function rectText(rect) {
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function likelyColumn(window) {
    return window.normalWindow && near(window.frameGeometry.width, 1252) &&
        near(window.frameGeometry.height, SAFE.height);
}

function validPlacement(window) {
    const rect = window.frameGeometry;
    const visible = rect.x >= SAFE.x && rect.y >= SAFE.y &&
        rect.x + rect.width <= SAFE.x + SAFE.width &&
        rect.y + rect.height <= SAFE.y + SAFE.height;
    const parked = rect.x + rect.width < 0;
    return { visible, parked, valid: visible || parked };
}

const candidates = workspace.windowList().filter(likelyColumn);
candidates.forEach(window => {
    window.outputChanged.connect(() => {
        outputChangeCount++;
        console.info(`${TAG} OUTPUT_CHANGED caption=${window.caption}` +
            ` output=${window.output ? window.output.name : "<none>"}` +
            ` geometry=${rectText(window.frameGeometry)}`);
    });
});

const activeSignal = workspace.activeWindowChanged || workspace.windowActivated;
if (activeSignal) activeSignal.connect(() => activeSignalCount++);

function snapshot() {
    snapshotIndex++;
    let passed = true;
    candidates.forEach((window, index) => {
        const placement = validPlacement(window);
        const output = window.output ? window.output.name : "<none>";
        const itemPassed = output === "DP-1" && placement.valid;
        passed = passed && itemPassed;
        console.info(`${TAG} ITEM step=${snapshotIndex} index=${index}` +
            ` result=${itemPassed ? "PASS" : "FAIL"}` +
            ` kind=${placement.visible ? "visible" : (placement.parked ? "parked" : "partial")}` +
            ` output=${output} geometry=${rectText(window.frameGeometry)}` +
            ` caption=${window.caption}`);
    });
    console.info(`${TAG} SNAPSHOT step=${snapshotIndex}` +
        ` result=${passed ? "PASS" : "FAIL"}` +
        ` columns=${candidates.length} outputChanges=${outputChangeCount}`);
}

function setupParkedAltTab() {
    const target = candidates.find(window => window.frameGeometry.x + window.frameGeometry.width < 0);
    const anchor = candidates.find(window => validPlacement(window).visible);
    if (!target || !anchor || target === anchor) {
        console.info(`${TAG} ALTTAB_SETUP FAIL`);
        return;
    }
    workspace.activeWindow = target;
    workspace.activeWindow = anchor;
    altTabState = {
        target,
        geometry: {
            x: target.frameGeometry.x,
            y: target.frameGeometry.y,
            width: target.frameGeometry.width,
            height: target.frameGeometry.height,
        },
        baselineSignals: activeSignalCount,
        baselineOutputChanges: outputChangeCount,
    };
    console.info(`${TAG} ALTTAB_READY target=${target.caption}` +
        ` geometry=${rectText(target.frameGeometry)}` +
        ` output=${target.output ? target.output.name : "<none>"}`);
}

function verifyParkedAltTab() {
    if (!altTabState) {
        console.info(`${TAG} ALTTAB FAIL not-ready`);
        return;
    }
    const geometry = altTabState.target.frameGeometry;
    const passed = workspace.activeWindow === altTabState.target &&
        activeSignalCount > altTabState.baselineSignals &&
        geometry.x + geometry.width < 0 &&
        altTabState.target.output && altTabState.target.output.name === "DP-1" &&
        outputChangeCount === altTabState.baselineOutputChanges;
    console.info(`${TAG} ALTTAB ${passed ? "PASS" : "FAIL"}` +
        ` active=${workspace.activeWindow ? workspace.activeWindow.caption : "<none>"}` +
        ` signalDelta=${activeSignalCount - altTabState.baselineSignals}` +
        ` outputChanges=${outputChangeCount - altTabState.baselineOutputChanges}` +
        ` geometry=${rectText(geometry)}` +
        ` output=${altTabState.target.output ? altTabState.target.output.name : "<none>"}`);
    altTabState = null;
}

registerShortcut("CCNiriV3Phase55Snapshot", "CC Niri V3 Phase 5.5 Snapshot", "", snapshot);
registerShortcut("CCNiriV3Phase55AltTabSetup", "CC Niri V3 Phase 5.5 AltTab Setup", "", setupParkedAltTab);
registerShortcut("CCNiriV3Phase55AltTabVerify", "CC Niri V3 Phase 5.5 AltTab Verify", "", verifyParkedAltTab);
console.info(`${TAG} loaded columns=${candidates.length}`);
