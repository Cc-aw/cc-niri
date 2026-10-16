"use strict";

// Load ONLY in the disposable virtual compositor created by the P0 runner.
// This fixture manages only its two titled, frameless test clients.
function rect(value) {
    return { x: value.x, y: value.y, width: value.width, height: value.height };
}
function record(kind, value) {
    const message = JSON.stringify(Object.assign({ kind: kind }, value));
    callDBus("org.cc.CCNiriP0Fixture", "/P0", "org.cc.CCNiriP0Fixture1", "Record", message, function() {});
}
const screens = Array.from(workspace.screens);
if (screens.length !== 2 || screens.some(output => !/^Virtual-[01]$/.test(output.name))) {
    throw new Error("P0 fixture requires the runner's two virtual outputs");
}
record("api", { clientArea: typeof workspace.clientArea,
    maximizeArea: KWin.MaximizeArea, screens: screens.map(output => ({ name: output.name,
        geometry: rect(output.geometry), scale: output.devicePixelRatio })) });
screens.forEach(output => {
    try {
        const desktop = typeof workspace.currentDesktopForScreen === "function"
            ? workspace.currentDesktopForScreen(output) : workspace.currentDesktop;
        record("working-area", { output: output.name,
            area: rect(workspace.clientArea(KWin.MaximizeArea, output, desktop)) });
    } catch (error) { record("api-error", { message: String(error) }); }
});
const clients = workspace.windowList().filter(window => /^CC_NIRI_P0_[AB]$/.test(window.caption));
record("clients", { count: clients.length });
clients.forEach(window => {
    function snapshot(kind) {
        record(kind, { title: window.caption, frame: rect(window.frameGeometry),
            output: window.output ? window.output.name : null });
    }
    window.frameGeometryChanged.connect(() => snapshot("frame-changed"));
    window.outputChanged.connect(() => snapshot("output-changed"));
    snapshot("initial");
});
const timer = new QTimer();
timer.interval = 600;
let phase = 0;
timer.timeout.connect(() => {
    phase++;
    const b = clients.find(window => window.caption === "CC_NIRI_P0_B");
    if (!b || !screens.length) { timer.stop(); record("fixture-error", { message: "missing clients/output" }); return; }
    const primary = screens.slice().sort((a, b) => a.geometry.x - b.geometry.x)[0];
    const origin = primary.geometry;
    if (phase === 1 || phase === 3) {
        // Safe anchor before and after the intentional test-client counterexample.
        const target = { x: origin.x + 1304, y: origin.y + 66, width: 1256, height: 1358 };
        record("request-anchor", { phase, before: rect(b.frameGeometry), target });
        b.frameGeometry = target;
        record("after-request", { phase, frame: rect(b.frameGeometry), output: b.output.name });
    } else if (phase === 2) {
        const target = { x: origin.x + 2136, y: origin.y + 66, width: 1256, height: 1358 };
        record("request-unsafe-test-client-only", { before: rect(b.frameGeometry), target });
        b.frameGeometry = target;
        record("after-request", { phase, frame: rect(b.frameGeometry), output: b.output.name });
    } else if (phase === 4 || phase === 5) {
        const target = { x: origin.x + (phase === 4 ? 440 : 1304), y: origin.y + 66,
            width: phase === 4 ? 1680 : 1256, height: 1358 };
        record("request-resize", { phase: phase, before: rect(b.frameGeometry), target: target });
        b.frameGeometry = target;
        record("after-resize-request", { phase: phase, frame: rect(b.frameGeometry), output: b.output.name });
    } else {
        timer.stop();
        record("complete", { frame: rect(b.frameGeometry), output: b.output.name });
    }
});
timer.start();
