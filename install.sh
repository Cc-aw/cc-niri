#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="${SCRIPT_DIR}/package"
EFFECT_DIR="${SCRIPT_DIR}/effect"
BRIDGE_DIR="${SCRIPT_DIR}/bridge"
BRIDGE_BUILD_DIR="${SCRIPT_DIR}/build/bridge"
PLASMOID_DIR="${SCRIPT_DIR}/plasmoid/com.cc.scrolltasks"
PLASMOID_BUILD_DIR="${SCRIPT_DIR}/build/plasmoid"
PLUGIN_ID="cc-niri-maximize"
EFFECT_ID="cc-niri-maximize-scroll-transition"
OBSOLETE_EFFECT_ID="cc-niri-v3-scroll-transition-poc"
GEOMETRY_EFFECT_ID="kwin4_effect_geometry_change"
FOCUS_RING_EFFECT_ID="kwin4_effect_cc_niri_focus_ring"
DIM_INACTIVE_EFFECT_ID="diminactive"
COMPAT_GROUP="CCNiriCompatibility"

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

cmake -S "${BRIDGE_DIR}" -B "${BRIDGE_BUILD_DIR}" -G Ninja \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_INSTALL_PREFIX="${HOME}/.local"
cmake --build "${BRIDGE_BUILD_DIR}"
cmake --install "${BRIDGE_BUILD_DIR}"

cmake -S "${PLASMOID_DIR}" -B "${PLASMOID_BUILD_DIR}" -G Ninja \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DCMAKE_INSTALL_PREFIX="${HOME}/.local" \
    -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins
cmake --build "${PLASMOID_BUILD_DIR}"
cmake --install "${PLASMOID_BUILD_DIR}"
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

kwriteconfig6 --file kwinrc --group Plugins --key "${PLUGIN_ID}Enabled" --type bool true
kwriteconfig6 --file kwinrc --group Plugins --key "${EFFECT_ID}Enabled" --type bool true
# Focus feedback is deliberately limited to TaskManager's native per-window
# IsActive role. Keep the abandoned custom ring and the global Dim Inactive
# effect disabled; KWin 6.7.5 cannot exclude the secondary output from dimming.
kwriteconfig6 --file kwinrc --group Plugins \
    --key "${FOCUS_RING_EFFECT_ID}Enabled" --type bool false
kwriteconfig6 --file kwinrc --group Plugins \
    --key "${DIM_INACTIVE_EFFECT_ID}Enabled" --type bool false
# Phase 9.5 is mouse-first for presentation. Remove the obsolete custom
# maximize action from KGlobalAccel's persisted KWin group as well as from the
# script, so reinstalling or logging in cannot resurrect its old binding.
kwriteconfig6 --file kglobalshortcutsrc --group kwin \
    --key CCNiriMaximizeToggle --delete
INSTALLED_MAIN="${XDG_DATA_HOME:-${HOME}/.local/share}/kwin/scripts/${PLUGIN_ID}/contents/code/main.js"

if command -v qdbus6 >/dev/null; then
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${PLUGIN_ID}" >/dev/null || true
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "${INSTALLED_MAIN}" "${PLUGIN_ID}" >/dev/null
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start >/dev/null
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${EFFECT_ID}" >/dev/null || true
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${OBSOLETE_EFFECT_ID}" >/dev/null || true
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${FOCUS_RING_EFFECT_ID}" >/dev/null || true
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${DIM_INACTIVE_EFFECT_ID}" >/dev/null || true
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${EFFECT_ID}" >/dev/null || true
elif command -v qdbus >/dev/null; then
    qdbus org.kde.KWin /KWin org.kde.KWin.reconfigure
    qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "${PLUGIN_ID}" >/dev/null || true
    qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "${INSTALLED_MAIN}" "${PLUGIN_ID}" >/dev/null
    qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.start >/dev/null
    qdbus org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${EFFECT_ID}" >/dev/null || true
    qdbus org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${OBSOLETE_EFFECT_ID}" >/dev/null || true
    qdbus org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
    qdbus org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${FOCUS_RING_EFFECT_ID}" >/dev/null || true
    qdbus org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${DIM_INACTIVE_EFFECT_ID}" >/dev/null || true
    qdbus org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${EFFECT_ID}" >/dev/null || true
elif command -v gdbus >/dev/null; then
    gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure >/dev/null
    gdbus call --session --dest org.kde.KWin --object-path /Scripting \
        --method org.kde.kwin.Scripting.unloadScript "${PLUGIN_ID}" >/dev/null || true
    gdbus call --session --dest org.kde.KWin --object-path /Scripting \
        --method org.kde.kwin.Scripting.loadScript "${INSTALLED_MAIN}" "${PLUGIN_ID}" >/dev/null
    gdbus call --session --dest org.kde.KWin --object-path /Scripting \
        --method org.kde.kwin.Scripting.start >/dev/null
    gdbus call --session --dest org.kde.KWin --object-path /Effects \
        --method org.kde.kwin.Effects.unloadEffect "${EFFECT_ID}" >/dev/null || true
    gdbus call --session --dest org.kde.KWin --object-path /Effects \
        --method org.kde.kwin.Effects.unloadEffect "${OBSOLETE_EFFECT_ID}" >/dev/null || true
    gdbus call --session --dest org.kde.KWin --object-path /Effects \
        --method org.kde.kwin.Effects.unloadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
    gdbus call --session --dest org.kde.KWin --object-path /Effects \
        --method org.kde.kwin.Effects.unloadEffect "${FOCUS_RING_EFFECT_ID}" >/dev/null || true
    gdbus call --session --dest org.kde.KWin --object-path /Effects \
        --method org.kde.kwin.Effects.unloadEffect "${DIM_INACTIVE_EFFECT_ID}" >/dev/null || true
    gdbus call --session --dest org.kde.KWin --object-path /Effects \
        --method org.kde.kwin.Effects.loadEffect "${EFFECT_ID}" >/dev/null || true
else
    echo "Installed and enabled. Log out and back in to load the script." >&2
fi

systemctl --user restart plasma-plasmashell.service

echo "Installed and enabled ${PLUGIN_ID}, ${EFFECT_ID}, bridge, and CC Scroll Tasks."
