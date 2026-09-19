/*
 * Temporary V3 Phase 0 POC. Loaded directly through KWin's scripting D-Bus API.
 * It is intentionally not packaged and every destructive probe restores geometry.
 */

const TAG = "[cc-niri-v3-poc]";
const positions = ["left1000", "left2500", "right1000", "right2500"];
let offscreen = null;
let relayoutProbe = null;
let activeProbe = null;
let activeSignalCount = 0;

function copyRect(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function sameRect(a, b) {
    return a && b && Math.abs(a.x - b.x) < 0.01 &&
        Math.abs(a.y - b.y) < 0.01 &&
        Math.abs(a.width - b.width) < 0.01 &&
        Math.abs(a.height - b.height) < 0.01;
}

function rectText(rect) {
    return rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : "<none>";
}

function primaryOutput() {
    return workspace.screens.slice().sort((a, b) => a.geometry.x - b.geometry.x)[0] || null;
}

function findByClass(part) {
    const needle = part.toLowerCase();
    return workspace.windowList().find(window =>
        window.normalWindow && window.moveable && window.resizeable &&
        String(window.resourceClass || "").toLowerCase().includes(needle)
    ) || null;
}

function subjects() {
    return [
        { name: "Konsole", window: findByClass("org.kde.konsole") },
        { name: "Dolphin", window: findByClass("org.kde.dolphin") },
        { name: "Firefox/Zen", window: findByClass("zen_browser") },
        { name: "VS Code", window: findByClass("code") },
    ];
}

function relayoutSubjects() {
    return [
        findByClass("org.kde.dolphin"),
        findByClass("zen_browser"),
        findByClass("code"),
        findByClass("chatgpt"),
    ].filter(Boolean);
}

function geometryForPosition(window, position) {
    const screen = primaryOutput().geometry;
    const geometry = copyRect(window.frameGeometry);
    if (position === "left1000") geometry.x = screen.x - 1000;
    if (position === "left2500") geometry.x = screen.x - 2500;
    if (position === "right1000") geometry.x = screen.x + screen.width + 1000;
    if (position === "right2500") geometry.x = screen.x + screen.width + 2500;
    return geometry;
}

function finishOffscreen() {
    if (!offscreen) return;
    offscreen.items.forEach(item => {
        item.window.frameGeometry = item.restore;
    });
    console.info(`${TAG} POC1 DONE restored=${offscreen.items.length}`);
    offscreen = null;
}

function advanceOffscreen() {
    if (!offscreen) {
        const missing = subjects().filter(item => !item.window).map(item => item.name);
        if (missing.length) {
            console.info(`${TAG} POC1 FAIL missing=${missing.join(",")}`);
            return;
        }
        offscreen = {
            items: subjects().map(item => ({
                name: item.name,
                window: item.window,
                restore: copyRect(item.window.frameGeometry),
            })),
            itemIndex: 0,
            positionIndex: 0,
            expected: null,
        };
        console.info(`${TAG} POC1 BEGIN subjects=${offscreen.items.length}`);
    } else if (offscreen.expected) {
        const item = offscreen.items[offscreen.itemIndex];
        const actual = item.window.frameGeometry;
        console.info(`${TAG} POC1 ${sameRect(actual, offscreen.expected) ? "PASS" : "FAIL"}` +
            ` app=${item.name}` +
            ` position=${positions[offscreen.positionIndex]}` +
            ` expected=${rectText(offscreen.expected)}` +
            ` actual=${rectText(actual)}` +
            ` output=${item.window.output ? item.window.output.name : "<none>"}`);
        offscreen.positionIndex++;
        if (offscreen.positionIndex >= positions.length) {
            item.window.frameGeometry = item.restore;
            offscreen.itemIndex++;
            offscreen.positionIndex = 0;
        }
        offscreen.expected = null;
        if (offscreen.itemIndex >= offscreen.items.length) {
            finishOffscreen();
            return;
        }
    }

    const item = offscreen.items[offscreen.itemIndex];
    offscreen.expected = geometryForPosition(item.window, positions[offscreen.positionIndex]);
    item.window.frameGeometry = offscreen.expected;
    console.info(`${TAG} POC1 SET app=${item.name}` +
        ` position=${positions[offscreen.positionIndex]}` +
        ` requested=${rectText(offscreen.expected)}`);
}

function beginRelayout() {
    if (relayoutProbe) return;
    const windows = relayoutSubjects();
    const output = primaryOutput();
    if (!output || windows.length < 4) {
        console.info(`${TAG} POC2 FAIL subjects=${windows.length}`);
        return;
    }
    const safe = { x: output.geometry.x + 24, y: output.geometry.y + 50,
        width: output.geometry.width - 48, height: output.geometry.height - 120 };
    const width = Math.floor(safe.width / 2);
    relayoutProbe = {
        items: windows.map((window, index) => ({
            window,
            restore: copyRect(window.frameGeometry),
            expected: { x: safe.x + index * (width + 8), y: safe.y,
                width, height: safe.height },
            signals: 0,
        })),
    };
    relayoutProbe.items.forEach(item => {
        item.window.frameGeometryChanged.connect(() => item.signals++);
    });
    // This loop is the exact POC for one synchronous multi-window relayout.
    relayoutProbe.items.forEach(item => {
        item.window.frameGeometry = item.expected;
    });
    console.info(`${TAG} POC2 SET count=${relayoutProbe.items.length}`);
}

function verifyRelayout() {
    if (!relayoutProbe) {
        console.info(`${TAG} POC2 FAIL not-started`);
        return;
    }
    let passed = true;
    relayoutProbe.items.forEach((item, index) => {
        const actual = item.window.frameGeometry;
        const itemPassed = sameRect(actual, item.expected);
        passed = passed && itemPassed;
        console.info(`${TAG} POC2 ${itemPassed ? "PASS" : "FAIL"}` +
            ` index=${index} caption=${item.window.caption}` +
            ` expected=${rectText(item.expected)}` +
            ` actual=${rectText(actual)} signals=${item.signals}` +
            ` output=${item.window.output ? item.window.output.name : "<none>"}`);
    });
    relayoutProbe.items.forEach(item => {
        item.window.frameGeometry = item.restore;
    });
    console.info(`${TAG} POC2 DONE result=${passed ? "PASS" : "FAIL"}`);
    relayoutProbe = null;
}

const activeWindowSignal = workspace.activeWindowChanged || workspace.windowActivated;
if (!activeWindowSignal) {
    console.info(`${TAG} POC3 FAIL no-active-window-signal`);
}
if (activeWindowSignal) {
    activeWindowSignal.connect(() => {
        activeSignalCount++;
        if (activeProbe) {
            console.info(`${TAG} POC3 SIGNAL count=${activeSignalCount}` +
                ` active=${workspace.activeWindow ? workspace.activeWindow.caption : "<none>"}`);
        }
    });
}

function setupActiveProbe() {
    if (activeProbe) return;
    const target = findByClass("org.kde.dolphin");
    const anchor = findByClass("org.kde.konsole");
    const output = primaryOutput();
    if (!target || !anchor || !output) {
        console.info(`${TAG} POC3 FAIL missing-target-or-anchor`);
        return;
    }
    activeProbe = {
        target,
        anchor,
        restore: copyRect(target.frameGeometry),
        expected: copyRect(target.frameGeometry),
        baselineSignals: activeSignalCount,
    };
    activeProbe.expected.x = output.geometry.x - 2500;
    target.frameGeometry = activeProbe.expected;
    workspace.activeWindow = target;
    workspace.activeWindow = anchor;
    activeProbe.baselineSignals = activeSignalCount;
    console.info(`${TAG} POC3 READY target=${target.caption}` +
        ` geometry=${rectText(target.frameGeometry)}` +
        ` anchor=${anchor.caption} signals=${activeSignalCount}`);
}

function verifyActiveProbe() {
    if (!activeProbe) {
        console.info(`${TAG} POC3 FAIL not-started`);
        return;
    }
    const activePassed = workspace.activeWindow === activeProbe.target;
    const signalPassed = activeSignalCount > activeProbe.baselineSignals;
    const geometryPassed = sameRect(activeProbe.target.frameGeometry, activeProbe.expected);
    console.info(`${TAG} POC3 ${activePassed && signalPassed && geometryPassed ? "PASS" : "FAIL"}` +
        ` active=${workspace.activeWindow ? workspace.activeWindow.caption : "<none>"}` +
        ` target=${activeProbe.target.caption}` +
        ` signalDelta=${activeSignalCount - activeProbe.baselineSignals}` +
        ` geometry=${rectText(activeProbe.target.frameGeometry)}` +
        ` expected=${rectText(activeProbe.expected)}`);
    activeProbe.target.frameGeometry = activeProbe.restore;
    workspace.activeWindow = activeProbe.target;
    activeProbe = null;
}

registerShortcut("CCNiriV3POC1Step", "CC Niri V3 POC 1 Step", "", advanceOffscreen);
registerShortcut("CCNiriV3POC2Begin", "CC Niri V3 POC 2 Begin", "", beginRelayout);
registerShortcut("CCNiriV3POC2Verify", "CC Niri V3 POC 2 Verify", "", verifyRelayout);
registerShortcut("CCNiriV3POC3Setup", "CC Niri V3 POC 3 Setup", "", setupActiveProbe);
registerShortcut("CCNiriV3POC3Verify", "CC Niri V3 POC 3 Verify", "", verifyActiveProbe);
console.info(`${TAG} loaded`);
