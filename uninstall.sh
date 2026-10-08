#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="cc-niri-maximize"
EFFECT_ID="cc-niri-maximize-scroll-transition"
NATIVE_CLIP_EFFECT_ID="cc-niri-viewport-clip"
NATIVE_CLIP_EFFECT_PATH="${HOME}/.local/lib64/qt6/plugins/kwin/effects/plugins/${NATIVE_CLIP_EFFECT_ID}.so"
GEOMETRY_EFFECT_ID="kwin4_effect_geometry_change"
SQUASH_EFFECT_ID="squash"
MAGIC_LAMP_EFFECT_ID="magiclamp"
COMPAT_GROUP="CCNiriCompatibility"

command -v kpackagetool6 >/dev/null || {
    echo "kpackagetool6 is required." >&2
    exit 1
}
command -v kwriteconfig6 >/dev/null || {
    echo "kwriteconfig6 is required." >&2
    exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/cc-niri" stop
systemctl --user disable --now cc-scroll-dock-bridge.service >/dev/null 2>&1 || true
systemctl --user disable --now cc-niri-bridge.service >/dev/null 2>&1 || true

RESTORE_GEOMETRY_CHANGE=false
RESTORE_SQUASH=false
RESTORE_MAGIC_LAMP=false
if command -v kreadconfig6 >/dev/null &&
        [[ "$(kreadconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
            --key GeometryChangeWasEnabled --default false)" == "true" ]]; then
    RESTORE_GEOMETRY_CHANGE=true
    kwriteconfig6 --file kwinrc --group Plugins \
        --key "${GEOMETRY_EFFECT_ID}Enabled" --type bool true
    kwriteconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
        --key GeometryChangeWasEnabled --delete
fi
if command -v kreadconfig6 >/dev/null &&
        [[ "$(kreadconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
            --key SquashWasEnabled --default false)" == "true" ]]; then
    RESTORE_SQUASH=true
    kwriteconfig6 --file kwinrc --group Plugins \
        --key "${SQUASH_EFFECT_ID}Enabled" --type bool true
    kwriteconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
        --key SquashWasEnabled --delete
fi
if command -v kreadconfig6 >/dev/null &&
        [[ "$(kreadconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
            --key MagicLampWasEnabled --default false)" == "true" ]]; then
    RESTORE_MAGIC_LAMP=true
    kwriteconfig6 --file kwinrc --group Plugins \
        --key "${MAGIC_LAMP_EFFECT_ID}Enabled" --type bool true
    kwriteconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
        --key MagicLampWasEnabled --delete
fi

kwriteconfig6 --file kwinrc --group Plugins --key "${PLUGIN_ID}Enabled" --type bool false
kwriteconfig6 --file kwinrc --group Plugins --key "${EFFECT_ID}Enabled" --type bool false
kwriteconfig6 --file kwinrc --group Plugins --key "${NATIVE_CLIP_EFFECT_ID}Enabled" --type bool false

if kpackagetool6 --type=KWin/Script --list | grep -Fxq "${PLUGIN_ID}"; then
    kpackagetool6 --type=KWin/Script --remove "${PLUGIN_ID}"
fi

if kpackagetool6 --type=KWin/Effect --list | grep -Fxq "${EFFECT_ID}"; then
    kpackagetool6 --type=KWin/Effect --remove "${EFFECT_ID}"
fi

if command -v qdbus6 >/dev/null; then
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${NATIVE_CLIP_EFFECT_ID}" >/dev/null || true
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
    [[ "${RESTORE_GEOMETRY_CHANGE}" == "false" ]] || \
        qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
    [[ "${RESTORE_SQUASH}" == "false" ]] || \
        qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${SQUASH_EFFECT_ID}" >/dev/null || true
    [[ "${RESTORE_MAGIC_LAMP}" == "false" ]] || \
        qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${MAGIC_LAMP_EFFECT_ID}" >/dev/null || true
elif command -v qdbus >/dev/null; then
    qdbus org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "${NATIVE_CLIP_EFFECT_ID}" >/dev/null || true
    qdbus org.kde.KWin /KWin org.kde.KWin.reconfigure
    [[ "${RESTORE_GEOMETRY_CHANGE}" == "false" ]] || \
        qdbus org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
    [[ "${RESTORE_SQUASH}" == "false" ]] || \
        qdbus org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${SQUASH_EFFECT_ID}" >/dev/null || true
    [[ "${RESTORE_MAGIC_LAMP}" == "false" ]] || \
        qdbus org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${MAGIC_LAMP_EFFECT_ID}" >/dev/null || true
elif command -v gdbus >/dev/null; then
    gdbus call --session --dest org.kde.KWin --object-path /Effects \
        --method org.kde.kwin.Effects.unloadEffect "${NATIVE_CLIP_EFFECT_ID}" >/dev/null || true
    gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure >/dev/null
    if [[ "${RESTORE_GEOMETRY_CHANGE}" == "true" ]]; then
        gdbus call --session --dest org.kde.KWin --object-path /Effects \
            --method org.kde.kwin.Effects.loadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
    fi
    if [[ "${RESTORE_SQUASH}" == "true" ]]; then
        gdbus call --session --dest org.kde.KWin --object-path /Effects \
            --method org.kde.kwin.Effects.loadEffect "${SQUASH_EFFECT_ID}" >/dev/null || true
    fi
    if [[ "${RESTORE_MAGIC_LAMP}" == "true" ]]; then
        gdbus call --session --dest org.kde.KWin --object-path /Effects \
            --method org.kde.kwin.Effects.loadEffect "${MAGIC_LAMP_EFFECT_ID}" >/dev/null || true
    fi
else
    echo "Removed. Log out and back in to finish unloading the script." >&2
fi

kwriteconfig6 --file kwinrc --group CCNiriFocusRing --key EnabledByUser --delete
rm -f -- "${HOME}/.local/lib64/qt6/plugins/kwin/effects/plugins/cc-niri-focus-ring.so"
rm -f -- "${NATIVE_CLIP_EFFECT_PATH}"
rm -f -- "${HOME}/.local/bin/cc-niri"

echo "Disabled and removed ${PLUGIN_ID}, ${EFFECT_ID}, and ${NATIVE_CLIP_EFFECT_ID}."
