const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const taskSource = fs.readFileSync(
    path.join(__dirname, "../plasmoid/com.cc.scrolltasks/qml/Task.qml"), "utf8"
);
const mainSource = fs.readFileSync(
    path.join(__dirname, "../plasmoid/com.cc.scrolltasks/qml/main.qml"), "utf8"
);
const appearanceSource = fs.readFileSync(
    path.join(__dirname, "../plasmoid/com.cc.scrolltasks/qml/cc/DockAppearance.qml"),
    "utf8"
);
const taskToolsSource = fs.readFileSync(
    path.join(__dirname, "../plasmoid/com.cc.scrolltasks/qml/code/TaskTools.js"), "utf8"
);
const installSource = fs.readFileSync(
    path.join(__dirname, "../install.sh"), "utf8"
);
const kwinSource = fs.readFileSync(
    path.join(__dirname, "../package/contents/code/main.js"), "utf8"
);

assert.ok(appearanceSource.includes(
    "readonly property bool activeWindowFeedback: !inPopup && isWindow && isActive"
) && taskSource.includes("isActive: task.model.IsActive"),
"native per-window IsActive is the feedback authority");
assert.ok(!taskSource.includes("focusedUuid"),
    "Task feedback does not use the Bridge focused UUID");
assert.ok(appearanceSource.includes(
    "readonly property real iconOpacity: isWindow && !isActive ? 0.9 : 1"
) && taskSource.includes("opacity: ccAppearance.iconOpacity"),
"inactive window icons are 90% and the active icon is 100%");
assert.ok(appearanceSource.includes('activeBackgroundColor: "#66DCEBDD"'),
    "active background is translucent light green");
assert.ok(appearanceSource.includes('activeIndicatorColor: "#4F7657"'));
assert.ok(appearanceSource.includes("activeIndicatorHeight: 3"));
assert.ok(appearanceSource.includes("activeIndicatorWidthRatio: 0.48"),
    "active bottom indicator occupies 48% of the item/icon dimension");
assert.equal(
    (taskSource.match(/visible: ccAppearance\.activeWindowFeedback/g) || []).length,
    2,
    "the exclusive active background and indicator switch immediately"
);
assert.ok(!taskSource.includes("opacity: ccAppearance.activeWindowFeedback"),
    "active markers cannot overlap during an opacity cross-fade");
assert.ok(!taskSource.includes('frame.basePrefix: "focus"'),
    "the theme focus block does not compete with the lightweight indicator");

assert.ok(mainSource.includes("groupMode: TaskManager.TasksModel.GroupDisabled"),
    "same-application windows stay as separate per-window delegates");
assert.ok(mainSource.includes("sortMode: TaskManager.TasksModel.SortManual"),
    "active changes cannot replace the Phase 8.5 logical order");
assert.ok(taskToolsSource.includes("tasks.tasksModel.requestActivate(index)"),
    "Dock activation continues through KDE TaskManager");

assert.ok(!fs.existsSync(path.join(__dirname, "../focus-ring")),
    "custom Focus Ring source remains removed");
assert.ok(!kwinSource.includes("workspace.showOutline(") &&
    !kwinSource.includes("workspace.hideOutline("),
    "the layout script does not own or mutate a KWin outline");

assert.ok(installSource.includes('DIM_INACTIVE_EFFECT_ID="diminactive"'));
assert.ok(installSource.includes(
    '--key "${DIM_INACTIVE_EFFECT_ID}Enabled" --type bool false'
), "global Dim Inactive stays disabled so the secondary output is unaffected");
assert.ok(!/Effects\.loadEffect\s+"?\$\{DIM_INACTIVE_EFFECT_ID\}/.test(installSource),
    "installation never reloads the disabled global dim effect");
assert.ok(installSource.includes('FOCUS_RING_EFFECT_ID="kwin4_effect_cc_niri_focus_ring"'));

console.log("PASS native per-window focused feedback and lightweight Dock visuals");
