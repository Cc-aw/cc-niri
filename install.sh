#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="${SCRIPT_DIR}/package"
EFFECT_DIR="${SCRIPT_DIR}/effect"
BRIDGE_DIR="${SCRIPT_DIR}/bridge"
BRIDGE_BUILD_DIR="${SCRIPT_DIR}/build/bridge"
NATIVE_CLIP_DIR="${SCRIPT_DIR}/native/viewport-clip"
NATIVE_CLIP_BUILD_DIR="${SCRIPT_DIR}/build/native-viewport-clip"
NATIVE_RING_DIR="${SCRIPT_DIR}/native/focus-ring"
NATIVE_RING_BUILD_DIR="${SCRIPT_DIR}/build/native-focus-ring"
PLASMOID_DIR="${SCRIPT_DIR}/plasmoid/com.cc.scrolltasks"
PLASMOID_BUILD_DIR="${SCRIPT_DIR}/build/plasmoid"
PLUGIN_ID="cc-niri-maximize"
EFFECT_ID="cc-niri-maximize-scroll-transition"
NATIVE_CLIP_EFFECT_ID="cc-niri-viewport-clip"
OBSOLETE_EFFECT_ID="cc-niri-v3-scroll-transition-poc"
GEOMETRY_EFFECT_ID="kwin4_effect_geometry_change"
SQUASH_EFFECT_ID="squash"
MAGIC_LAMP_EFFECT_ID="magiclamp"
FOCUS_RING_EFFECT_ID="kwin4_effect_cc_niri_focus_ring"
DIM_INACTIVE_EFFECT_ID="diminactive"
COMPAT_GROUP="CCNiriCompatibility"

command -v gdbus >/dev/null || { echo "gdbus is required." >&2; exit 1; }
node "${SCRIPT_DIR}/tools/build.js"

command -v kpackagetool6 >/dev/null || {
    echo "kpackagetool6 is required." >&2
    exit 1
}
command -v kwriteconfig6 >/dev/null || {
    echo "kwriteconfig6 is required." >&2
    exit 1
}
command -v kreadconfig6 >/dev/null || {
    echo "kreadconfig6 is required." >&2
    exit 1
}
command -v cmake >/dev/null || {
    echo "cmake is required." >&2
    exit 1
}
if [[ -z "$(find /usr/lib /usr/lib64 \
        -path '*/cmake/KWin/KWinConfig.cmake' -print -quit 2>/dev/null)" ]]; then
    echo "KWin development files are required (Fedora: kwin-devel)." >&2
    exit 1
fi


cmake -S "${NATIVE_CLIP_DIR}" -B "${NATIVE_CLIP_BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_INSTALL_PREFIX="${HOME}/.local" \
    -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins
cmake --build "${NATIVE_CLIP_BUILD_DIR}"

cmake -S "${NATIVE_RING_DIR}" -B "${NATIVE_RING_BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_INSTALL_PREFIX="${HOME}/.local" \
    -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins
cmake --build "${NATIVE_RING_BUILD_DIR}"

cmake -S "${BRIDGE_DIR}" -B "${BRIDGE_BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_INSTALL_PREFIX="${HOME}/.local"
cmake --build "${BRIDGE_BUILD_DIR}"

cmake -S "${PLASMOID_DIR}" -B "${PLASMOID_BUILD_DIR}" \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_INSTALL_PREFIX="${HOME}/.local" \
    -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins
cmake --build "${PLASMOID_BUILD_DIR}"

# Preserve protocol 1/2 data before stopping the old Bridge during an upgrade.
"${BRIDGE_BUILD_DIR}/cc-scroll-dock-bridge" --save-current-state
"${SCRIPT_DIR}/cc-niri" stop
python3 "${SCRIPT_DIR}/tools/install-native-clip.py" \
    "${NATIVE_CLIP_BUILD_DIR}" "${HOME}/.local"
python3 "${SCRIPT_DIR}/tools/install-native-clip.py" \
    "${NATIVE_RING_BUILD_DIR}" "${HOME}/.local" cc-niri-focus-ring
cmake --install "${BRIDGE_BUILD_DIR}"
cmake --install "${PLASMOID_BUILD_DIR}"
install -Dm755 "${SCRIPT_DIR}/cc-niri" "${HOME}/.local/bin/cc-niri"
command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 --noincremental >/dev/null

install -Dm644 \
    "${BRIDGE_DIR}/systemd/cc-scroll-dock-bridge.service" \
    "${HOME}/.config/systemd/user/cc-scroll-dock-bridge.service"
systemctl --user daemon-reload
systemctl --user enable --now cc-scroll-dock-bridge.service
systemctl --user restart cc-scroll-dock-bridge.service


if kpackagetool6 --type=KWin/Script --list | grep -Fxq "${PLUGIN_ID}"; then
    kpackagetool6 --type=KWin/Script --upgrade "${PACKAGE_DIR}"
else
    kpackagetool6 --type=KWin/Script --install "${PACKAGE_DIR}"
fi

if kpackagetool6 --type=KWin/Effect --list | grep -Fxq "${EFFECT_ID}"; then
    kpackagetool6 --type=KWin/Effect --upgrade "${EFFECT_DIR}"
else
    kpackagetool6 --type=KWin/Effect --install "${EFFECT_DIR}"
fi

# Phase 5.5 used a temporary transition POC. It must never run alongside the
# production effect because both animate the same geometry-change signal.
kwriteconfig6 --file kwinrc --group Plugins --key "${OBSOLETE_EFFECT_ID}Enabled" --type bool false
if kpackagetool6 --type=KWin/Effect --list | grep -Fxq "${OBSOLETE_EFFECT_ID}"; then
    kpackagetool6 --type=KWin/Effect --remove "${OBSOLETE_EFFECT_ID}"
fi

# Geometry Change animates the large real jump between the left parking area
# and the primary viewport. It conflicts with the output-safe logical
# transition and makes L visibly enter from the physical left. Preserve the
# user's previous setting so uninstall can restore it.
if [[ "$(kreadconfig6 --file kwinrc --group Plugins \
        --key "${GEOMETRY_EFFECT_ID}Enabled" --default false)" == "true" ]]; then
    kwriteconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
        --key GeometryChangeWasEnabled --type bool true
fi
kwriteconfig6 --file kwinrc --group Plugins \
    --key "${GEOMETRY_EFFECT_ID}Enabled" --type bool false

# KWin 6.7 exposes minimize/unminimize grab roles, and the CC effect uses
# them for script-owned parking transitions. Its bundled Squash and Magic Lamp
# effects do not consult those roles, however, so they still animate an internal
# unminimize from the Task Manager icon. Preserve and disable either active
# minimize effect as the documented compatibility fallback. User minimize
# animation can be restored on uninstall or when KWin ships grab-aware effects.
if [[ "$(kreadconfig6 --file kwinrc --group Plugins \
        --key "${SQUASH_EFFECT_ID}Enabled" --default true)" == "true" ]]; then
    kwriteconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
        --key SquashWasEnabled --type bool true
fi
if [[ "$(kreadconfig6 --file kwinrc --group Plugins \
        --key "${MAGIC_LAMP_EFFECT_ID}Enabled" --default false)" == "true" ]]; then
    kwriteconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
        --key MagicLampWasEnabled --type bool true
fi
kwriteconfig6 --file kwinrc --group Plugins \
    --key "${SQUASH_EFFECT_ID}Enabled" --type bool false
kwriteconfig6 --file kwinrc --group Plugins \
    --key "${MAGIC_LAMP_EFFECT_ID}Enabled" --type bool false

kwriteconfig6 --file kwinrc --group Plugins --key "${PLUGIN_ID}Enabled" --type bool true
kwriteconfig6 --file kwinrc --group Plugins --key "${EFFECT_ID}Enabled" --type bool true
kwriteconfig6 --file kwinrc --group Plugins --key "${NATIVE_CLIP_EFFECT_ID}Enabled" --type bool true
# Keep the abandoned Script Effect ring and global dimming disabled.
# The new native POC is installed but remains opt-in via cc-niri focus-ring on.
kwriteconfig6 --file kwinrc --group Plugins \
    --key "${FOCUS_RING_EFFECT_ID}Enabled" --type bool false
kwriteconfig6 --file kwinrc --group Plugins \
    --key "${DIM_INACTIVE_EFFECT_ID}Enabled" --type bool false
# Phase 9.5 is mouse-first for presentation. Remove the obsolete custom
# maximize action from KGlobalAccel's persisted KWin group as well as from the
# script, so reinstalling or logging in cannot resurrect its old binding.
kwriteconfig6 --file kglobalshortcutsrc --group kwin \
    --key CCNiriMaximizeToggle --delete
# Qt distinguishes the main keyboard Return key from keypad Enter. Migrate the
# original Enter-only binding and keep a second action for keypad users.
kwriteconfig6 --file kglobalshortcutsrc --group kwin \
    --key CCScrollToggleFloating \
    "Meta+Shift+Return,none,CC Scroll: Toggle Floating"
kwriteconfig6 --file kglobalshortcutsrc --group kwin \
    --key CCScrollToggleFloatingKeypad \
    "Meta+Shift+Enter,none,CC Scroll: Toggle Floating Keypad Enter"
"${SCRIPT_DIR}/cc-niri" start

# registerShortcut() preserves an already loaded KGlobalAccel binding, so
# editing kglobalshortcutsrc alone cannot repair the old Enter-only action in
# the running session. Force the two distinct Qt key codes after both actions
# have registered: 0x13000004 is Meta+Shift+Return and 0x13000005 is
# Meta+Shift+keypad Enter.
if command -v gdbus >/dev/null; then
    gdbus call --session --dest org.kde.kglobalaccel \
        --object-path /kglobalaccel \
        --method org.kde.KGlobalAccel.setShortcut \
        "['kwin','CCScrollToggleFloating','KWin','CC Scroll: Toggle Floating']" \
        "[318767108]" 4 >/dev/null || true
    gdbus call --session --dest org.kde.kglobalaccel \
        --object-path /kglobalaccel \
        --method org.kde.KGlobalAccel.setShortcut \
        "['kwin','CCScrollToggleFloatingKeypad','KWin','CC Scroll: Toggle Floating Keypad Enter']" \
        "[318767109]" 4 >/dev/null || true
fi

systemctl --user restart plasma-plasmashell.service

echo "Terminal control: cc-niri start | stop | restart | status"
echo "Installed and enabled ${PLUGIN_ID}, ${EFFECT_ID}, ${NATIVE_CLIP_EFFECT_ID}, bridge, and CC Scroll Tasks."
