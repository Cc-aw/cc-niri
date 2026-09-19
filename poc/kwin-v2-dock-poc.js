const TAG = "[cc-niri-v2-dock-poc]";
let helperState = null;

function copyRect(rect) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function rectText(rect) {
    return `${rect.x},${rect.y} ${rect.width}x${rect.height}`;
}

function targetOutput() {
    return workspace.screens.slice().sort((a, b) => a.geometry.x - b.geometry.x)[0] || null;
}

function chatgpt() {
    return workspace.windowList().find(window =>
        window.normalWindow && window.caption === "ChatGPT"
    );
}

function dockWindow() {
    const output = targetOutput();
    return workspace.windowList().find(window =>
        window.dock && output && window.output === output &&
        window.frameGeometry.y + window.frameGeometry.height >=
            output.geometry.y + output.geometry.height - 2
    );
}

function verify(label) {
    const window = chatgpt();
    const dock = dockWindow();
    console.info(`${TAG} ${label}` +
        ` chatgpt=${window ? rectText(window.frameGeometry) : "none"}` +
        ` dock=${dock ? rectText(dock.frameGeometry) : "hidden/offscreen"}`);
}

function occupy() {
    if (helperState) return;
    const output = targetOutput();
    const subject = chatgpt();
    const helper = workspace.windowList().find(window =>
        window !== subject && window.normalWindow && window.resizeable &&
        output && window.output === output && !window.skipTaskbar && window.caption
    );
    if (!output || !subject || !helper) {
        console.info(`${TAG} FAIL occupy missing subject/helper`);
        return;
    }
    helperState = {
        window: helper,
        geometry: copyRect(helper.frameGeometry),
        maximizeMode: Number(helper.maximizeMode),
    };
    helper.setMaximize(false, false);
    helper.frameGeometry = {
        x: output.geometry.x + Math.round((output.geometry.width - helperState.geometry.width) / 2),
        y: output.geometry.y + output.geometry.height - helperState.geometry.height,
        width: helperState.geometry.width,
        height: helperState.geometry.height,
    };
    workspace.activeWindow = helper;
    console.info(`${TAG} OCCUPY helper=${helper.caption}` +
        ` geometry=${rectText(helper.frameGeometry)}`);
    verify("after-occupy");
}

function release() {
    if (!helperState) return;
    const saved = helperState;
    helperState = null;
    saved.window.setMaximize(false, false);
    saved.window.frameGeometry = saved.geometry;
    if (saved.maximizeMode === 3) saved.window.setMaximize(true, true);
    const subject = chatgpt();
    if (subject) workspace.activeWindow = subject;
    console.info(`${TAG} RELEASE helper=${saved.window.caption}` +
        ` geometry=${rectText(saved.window.frameGeometry)}`);
    verify("after-release");
}

registerShortcut("CCNiriV2DockOccupy", "CC Niri V2 Dock Occupy", "", occupy);
registerShortcut("CCNiriV2DockVerify", "CC Niri V2 Dock Verify", "", () => verify("verify"));
registerShortcut("CCNiriV2DockRelease", "CC Niri V2 Dock Release", "", release);
console.info(`${TAG} loaded`);
