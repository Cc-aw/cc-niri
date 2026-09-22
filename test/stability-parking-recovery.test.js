const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ParkingManager } = require("../src/kwin/stability/ParkingManager");
const { Recovery } = require("../src/kwin/stability/Recovery");

const root = path.join(__dirname, "..");
const mainSource = fs.readFileSync(
    path.join(root, "package/contents/code/main.js"),
    "utf8"
);
const installSource = fs.readFileSync(path.join(root, "install.sh"), "utf8");
const uninstallSource = fs.readFileSync(path.join(root, "uninstall.sh"), "utf8");
const bridgeHeader = fs.readFileSync(
    path.join(root, "bridge/src/ScrollDockBridge.h"), "utf8");
const bridgeSource = fs.readFileSync(
    path.join(root, "bridge/src/ScrollDockBridge.cpp"), "utf8");

assert.ok(mainSource.includes("function looksLikeInheritedParking(window)"));
assert.ok(mainSource.includes("Number(window.opacity) <= 0 && window.minimized"),
    "reload adoption requires the minimized+transparent parking fingerprint");
assert.ok(mainSource.includes("Number(rect.x) < virtualScreenLeft()"),
    "reload adoption also requires a left-of-virtual-screen parking geometry");
assert.ok(mainSource.includes("scrollParkedByScript"));
assert.ok(mainSource.includes("scrollLastVisibleGeometry"));
assert.ok(mainSource.includes("function releaseParkingOwnership("));
assert.ok(mainSource.includes("function emergencyRestoreAllWindows(reason)"));
assert.ok(mainSource.includes("mainScreenState.enabled = false"),
    "emergency recovery prevents signals from immediately parking windows again");

const parkingSource = mainSource.slice(
    mainSource.indexOf("class ParkingManager"),
    mainSource.indexOf("class Recovery")
);
const releaseSource = parkingSource.slice(parkingSource.indexOf("release(window,"));
assert.ok(releaseSource.indexOf("window.frameGeometry = target") <
    releaseSource.indexOf("window.opacity = state.scrollOriginalOpacity"),
"a parked window is moved on-screen before it becomes visible");
assert.ok(releaseSource.includes("state.scrollParkingMinimized && window.minimized"),
    "recovery only clears minimization owned by the script");

const events = [];
let geometry = { x: -6000, y: 50, width: 100, height: 100 };
let opacity = 0;
const parkedWindow = {
    caption: "parked",
    minimized: true,
    get frameGeometry() { return geometry; },
    set frameGeometry(value) { geometry = value; events.push("geometry"); },
    get opacity() { return opacity; },
    set opacity(value) { opacity = value; events.push(`opacity:${value}`); },
};
const parkedState = {
    internalChange: false,
    scrollOriginalOpacity: 0.8,
    scrollVisuallyHidden: true,
    scrollParkedByScript: true,
    scrollParkingMinimized: true,
    scrollLastVisibleGeometry: { x: 30, y: 60, width: 100, height: 100 },
};
const stateMap = new Map([[parkedWindow, parkedState]]);
const parking = new ParkingManager({
    stateFor: window => stateMap.get(window),
    getState: window => stateMap.get(window),
    refreshSafeArea: () => {},
    getSafeRect: () => ({ x: 24, y: 50, width: 500, height: 400 }),
    debug: () => {},
});
assert.equal(parking.owns(parkedWindow), true);
assert.equal(parking.release(parkedWindow, "test", true), true);
assert.ok(events.indexOf("geometry") < events.indexOf("opacity:0.8"));
assert.deepEqual(geometry, { x: 30, y: 60, width: 100, height: 100 });
assert.equal(parkedWindow.minimized, false);
assert.equal(parking.owns(parkedWindow), false);

const userMinimizedWindow = { caption: "user-minimized", minimized: true, opacity: 0 };
const userMinimizedState = {
    internalChange: false,
    scrollOriginalOpacity: 1,
    scrollVisuallyHidden: true,
    scrollParkedByScript: true,
    scrollParkingMinimized: false,
    scrollLastVisibleGeometry: null,
};
stateMap.set(userMinimizedWindow, userMinimizedState);
assert.equal(parking.release(userMinimizedWindow, "test"), true);
assert.equal(userMinimizedWindow.minimized, true,
    "recovery preserves minimization it does not own");

let prepared = false;
const recovery = new Recovery({
    appState: { columns: [{ window: parkedWindow }] },
    windowStates: { forEach: callback => callback(parkedState, parkedWindow) },
    parking: { release: () => true },
    indexOfWindow: () => 0,
    beforeRestore: () => { prepared = true; },
    debug: () => {},
});
assert.equal(recovery.restoreAll("test"), 1);
assert.equal(prepared, true, "recovery disables future layout work before restoring");

assert.ok(mainSource.includes("CCScrollEmergencyRestore"));
assert.ok(mainSource.includes('"Meta+Ctrl+Alt+Shift+F11"'),
    "the command pump needs an invokable non-empty internal binding");
assert.ok(mainSource.includes('"Meta+Ctrl+Alt+Shift+F12"'),
    "the direct emergency fallback needs an invokable non-empty binding");
assert.ok(mainSource.includes(
    '"emergency-restore": () => emergencyRestoreAllWindows("bridge-unload")'
));
assert.ok(mainSource.includes("this.handlers[command.type](command)"));
assert.ok(bridgeHeader.includes("bool RequestEmergencyRestore();"));
assert.ok(bridgeSource.includes("ScrollDockBridge::RequestEmergencyRestore()"));
for (const [name, source] of [
    ["install", installSource],
    ["uninstall", uninstallSource],
]) {
    assert.ok(source.includes("restore_parked_windows"),
        `${name} must request recovery before unloading the script`);
    assert.ok(source.includes("RequestEmergencyRestore"));
    assert.ok(source.includes("CCScrollApplyDockCommand"));
    assert.ok(source.includes("restore_attempt < 10"),
        `${name} waits for the bridge to acquire the current KWin session`);
    assert.ok(source.includes('restore_action="CCScrollEmergencyRestore"'),
        `${name} has a direct recovery fallback when the bridge is unavailable`);
}

console.log("PASS stability parking ownership and emergency recovery");
