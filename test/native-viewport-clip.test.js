const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../native/viewport-clip");
const header = fs.readFileSync(path.join(root, "ViewportClipEffect.h"), "utf8");
const source = fs.readFileSync(path.join(root, "ViewportClipEffect.cpp"), "utf8");
const cmake = fs.readFileSync(path.join(root, "CMakeLists.txt"), "utf8");
const install = fs.readFileSync(path.join(__dirname, "../install.sh"), "utf8");
const uninstall = fs.readFileSync(path.join(__dirname, "../uninstall.sh"), "utf8");

assert.match(header, /ViewportClipDataRole = 1001/);
assert.match(header, /CapabilityDataRole = 1002/);
assert.match(source, /advertiseCapability\(window, true\)/);
assert.match(source, /advertiseCapability\(window, false\)/);
assert.match(source, /setData\(CapabilityDataRole/);
assert.match(source, /\[VIEWPORT_CLIP_NATIVE\] READY/);
assert.match(source, /viewport\.mapToDeviceCoordinates\(logicalClip\)\.rounded\(\)/);
assert.match(source, /clipped &= deviceClip/);
assert.match(source, /blocksDirectScanout\(\) const/);
assert.match(source, /\[VIEWPORT_CLIP_NATIVE\] MAP/);
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
