const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const qmlRoot = path.join(
    __dirname,
    "../plasmoid/com.cc.scrolltasks/qml"
);
const read = relativePath => fs.readFileSync(path.join(qmlRoot, relativePath), "utf8");
const main = read("main.qml");
const task = read("Task.qml");
const mouse = read("MouseHandler.qml");
const menu = read("ContextMenu.qml");
const state = read("cc/DockState.qml");
const bridge = read("cc/DockBridge.qml");
const order = read("cc/DockOrder.qml");
const presentation = read("cc/DockPresentation.qml");
const appearance = read("cc/DockAppearance.qml");
const facade = read("cc/DockController.qml");
const cmake = fs.readFileSync(
    path.join(qmlRoot, "../CMakeLists.txt"),
    "utf8"
);

assert.match(main, /TaskManagerApplet\.DockController/);
assert.match(main, /property alias dockController: ccDockController/);
for (const protocolDetail of [
    "org.cc.ScrollDockBridge",
    "JSON.parse",
    "set-column-order",
    "set-presentation-mode",
    "focus-column-right",
    "baseGeneration",
]) {
    assert.equal(main.includes(protocolDetail), false,
        `main.qml no longer owns ${protocolDetail}`);
}

assert.match(state, /function parse\(json\)/);
assert.match(state, /property string sessionId/);
assert.match(state, /property int generation/);
assert.match(bridge, /org\.cc\.ScrollDockBridge/);
assert.match(bridge, /DBus\.SignalWatcher/);
assert.match(order, /tasksModel\.move\(currentRow, targetRow\)/);
assert.match(order, /type: "set-column-order"/);
assert.match(presentation, /type: "set-presentation-mode"/);
assert.match(presentation, /type: "focus-column-right"/);
assert.match(appearance, /activeWindowFeedback/);
assert.match(facade, /DockState \{ id: state \}/);
assert.match(facade, /DockBridge/);
assert.match(facade, /DockOrder/);
assert.match(facade, /DockPresentation/);

assert.match(task, /tasksRoot\.dockController\.requestFocusRight/);
assert.match(mouse, /tasks\.dockController\.requestReorder/);
assert.match(mouse, /tasks\.dockController\.userReorderEnabled/);
assert.equal(mouse.includes("tasks.dockUserReorderEnabled"), false,
    "drag movement cannot depend on the removed pre-Phase-10 property");
assert.match(menu, /tasksRoot\.dockController\.requestPresentationMode/);
for (const source of [task, mouse, menu]) {
    assert.equal(source.includes("org.cc.ScrollDockBridge"), false);
}

for (const component of [
    "DockAppearance.qml",
    "DockBridge.qml",
    "DockController.qml",
    "DockOrder.qml",
    "DockPresentation.qml",
    "DockState.qml",
]) {
    assert.ok(cmake.includes(`qml/cc/${component}`), `${component} is packaged`);
}

console.log("PASS Phase 10 isolates Dock fork state, IPC, order, presentation, and appearance");
