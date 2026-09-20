const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

const releaseSource = mainSource.slice(
    mainSource.indexOf("function releaseParkingOwnership"),
    mainSource.indexOf("function emergencyRestoreAllWindows")
);
assert.ok(releaseSource.indexOf("window.frameGeometry = target") <
    releaseSource.indexOf("window.opacity = windowState.scrollOriginalOpacity"),
"a parked window is moved on-screen before it becomes visible");
assert.ok(releaseSource.includes("windowState.scrollParkingMinimized && window.minimized"),
    "recovery only clears minimization owned by the script");

assert.ok(mainSource.includes("CCScrollEmergencyRestore"));
assert.ok(mainSource.includes('"Meta+Ctrl+Alt+Shift+F11"'),
    "the command pump needs an invokable non-empty internal binding");
assert.ok(mainSource.includes('"Meta+Ctrl+Alt+Shift+F12"'),
    "the direct emergency fallback needs an invokable non-empty binding");
assert.ok(mainSource.includes('command.type !== "emergency-restore"'));
assert.ok(mainSource.includes('command.type === "emergency-restore"'));
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
