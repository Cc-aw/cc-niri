/* Temporary POC: can a window stay right of the virtual desktop but belong to DP-1? */

const TAG = "[cc-niri-v3-right-parking-poc]";
const PRIMARY_NAME = "DP-1";
const PARKING_MARGIN = 4096;
let probe = null;

function copyRect(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function rectText(rect) {
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function outputName(window) {
    return window.output ? window.output.name : "<none>";
}

function primaryOutput() {
    return workspace.screens.find(output => output.name === PRIMARY_NAME) || null;
}

function rightParkingX() {
    const virtualRect = workspace.virtualScreenGeometry;
    return virtualRect.x + virtualRect.width + PARKING_MARGIN;
}

function findSubject() {
    return workspace.windowList().find(window =>
        window.normalWindow && window.moveable && window.resizeable &&
        window.output && window.output.name === PRIMARY_NAME &&
        window.frameGeometry.x < workspace.virtualScreenGeometry.x
    ) || null;
}

function begin() {
    if (probe) {
        console.info(`${TAG} FAIL already-running`);
        return;
    }
    const target = findSubject();
    const output = primaryOutput();
    if (!target || !output) {
        console.info(`${TAG} FAIL missing-subject-or-primary`);
        return;
    }
    probe = { target, output, restore: copyRect(target.frameGeometry) };
    const targetRect = copyRect(target.frameGeometry);
    targetRect.x = rightParkingX();
    target.frameGeometry = targetRect;
    console.info(`${TAG} BEGIN caption=${target.caption}` +
        ` requested=${rectText(targetRect)}` +
        ` actual=${rectText(target.frameGeometry)} output=${outputName(target)}`);
}

function forcePrimary() {
    if (!probe) {
        console.info(`${TAG} FAIL no-running-probe`);
        return;
    }
    console.info(`${TAG} BEFORE_SEND geometry=${rectText(probe.target.frameGeometry)}` +
        ` output=${outputName(probe.target)}`);
    workspace.sendClientToScreen(probe.target, probe.output);
    console.info(`${TAG} AFTER_SEND geometry=${rectText(probe.target.frameGeometry)}` +
        ` output=${outputName(probe.target)}`);
}

function verifyAndRestore() {
    if (!probe) {
        console.info(`${TAG} FAIL no-running-probe`);
        return;
    }
    const rightX = rightParkingX();
    const rect = probe.target.frameGeometry;
    const retainedRight = Math.abs(rect.x - rightX) < 0.01;
    const retainedPrimary = outputName(probe.target) === PRIMARY_NAME;
    console.info(`${TAG} VERIFY ${retainedRight && retainedPrimary ? "PASS" : "FAIL"}` +
        ` retainedRight=${retainedRight} retainedPrimary=${retainedPrimary}` +
        ` geometry=${rectText(rect)} output=${outputName(probe.target)}`);
    workspace.sendClientToScreen(probe.target, probe.output);
    probe.target.frameGeometry = probe.restore;
    console.info(`${TAG} RESTORE geometry=${rectText(probe.target.frameGeometry)}` +
        ` output=${outputName(probe.target)}`);
    probe = null;
}

registerShortcut("CCNiriV3RightParkingBegin", "CC Niri V3 Right Parking Begin", "", begin);
registerShortcut("CCNiriV3RightParkingForcePrimary", "CC Niri V3 Right Parking Force Primary", "", forcePrimary);
registerShortcut("CCNiriV3RightParkingVerify", "CC Niri V3 Right Parking Verify", "", verifyAndRestore);
console.info(`${TAG} loaded`);
