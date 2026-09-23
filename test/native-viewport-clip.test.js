const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../native/viewport-clip");
const header = fs.readFileSync(path.join(root, "ViewportClipEffect.h"), "utf8");
const source = fs.readFileSync(path.join(root, "ViewportClipEffect.cpp"), "utf8");
const cmake = fs.readFileSync(path.join(root, "CMakeLists.txt"), "utf8");
const install = fs.readFileSync(path.join(__dirname, "../install.sh"), "utf8");
const uninstall = fs.readFileSync(path.join(__dirname, "../uninstall.sh"), "utf8");
const scriptRoles = fs.readFileSync(path.join(__dirname,
    "../src/effect/MotionTokens.js"), "utf8");

assert.match(header, /ViewportClipDataRole = 1001/);
assert.match(header, /CapabilityDataRole = 1002/);
assert.match(header, /MotionPlanDataRole = 1003/);
assert.match(header, /MotionCompleteDataRole = 1004/);
for (const [script, role] of [
    ["CC_NIRI_VIEWPORT_CLIP_ROLE", "ViewportClipDataRole"],
    ["CC_NIRI_VIEWPORT_CLIP_CAPABILITY_ROLE", "CapabilityDataRole"],
    ["CC_NIRI_MOTION_PLAN_ROLE", "MotionPlanDataRole"],
    ["CC_NIRI_MOTION_COMPLETE_ROLE", "MotionCompleteDataRole"],
]) {
    const scriptValue = Number(scriptRoles.match(new RegExp(`${script} = (\\d+)`))[1]);
    const nativeValue = Number(header.match(new RegExp(`${role} = (\\d+)`))[1]);
    assert.equal(scriptValue, nativeValue, `${script} matches ${role}`);
}
assert.match(source, /advertiseCapability\(window, true\)/);
assert.match(source, /advertiseCapability\(window, false\)/);
assert.match(source, /setData\(CapabilityDataRole/);
assert.match(source, /\[VIEWPORT_CLIP_NATIVE\] READY/);
assert.match(source, /viewport\.mapToDeviceCoordinates\(logicalClip\)\.rounded\(\)/);
assert.match(source, /clipped &= deviceClip/);
assert.match(source, /blocksDirectScanout\(\) const/);
assert.match(source, /\[VIEWPORT_CLIP_NATIVE\] MAP/);
assert.match(source, /MotionPlanChanged/);
assert.match(source, /setData\(MotionPlanDataRole, marker\)/);
assert.match(source, /windowDataChanged[\s\S]*?role == MotionCompleteDataRole[\s\S]*?forwardMotionCompletion\(window\)/);
assert.match(source, /onMotionParked[\s\S]*?setData\(MotionPlanDataRole, QVariant\(\)\)[\s\S]*?addRepaintFull\(\)/);
assert.match(source, /ReportMotionComplete/);
assert.match(source,
    /QStringLiteral\("outgoing"\)[\s\S]*?QStringLiteral\("PAIR_TO_WIDE"\)[\s\S]*?effects->addRepaintFull\(\)/,
    "outgoing Pair-to-Wide motion repaints its compositor-only translation");
assert.match(cmake, /KWin::kwin/);
assert.match(cmake, /INSTALL_NAMESPACE "kwin\/effects\/plugins"/);
assert.match(install, /cmake --install "\$\{NATIVE_CLIP_BUILD_DIR\}"/);
assert.match(install, /loadEffect "\$\{NATIVE_CLIP_EFFECT_ID\}"/);
assert.match(
    install,
    /Effects\.loadEffect "\$\{NATIVE_CLIP_EFFECT_ID\}"[\s\S]*?Effects\.loadEffect "\$\{EFFECT_ID\}"/,
    "the native effect loads before the scripted effect reads capability markers"
);
assert.match(uninstall, /unloadEffect "\$\{NATIVE_CLIP_EFFECT_ID\}"/);
assert.match(uninstall, /rm -f -- "\$\{NATIVE_CLIP_EFFECT_PATH\}"/);

console.log("PASS native viewport clip uses KWin device-space paint region");
