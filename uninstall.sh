#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="cc-niri-maximize"
EFFECT_ID="cc-niri-maximize-scroll-transition"
GEOMETRY_EFFECT_ID="kwin4_effect_geometry_change"
COMPAT_GROUP="CCNiriCompatibility"

systemctl --user disable --now cc-scroll-dock-bridge.service >/dev/null 2>&1 || true

command -v kpackagetool6 >/dev/null || {
    echo "kpackagetool6 is required." >&2
    exit 1
}
command -v kwriteconfig6 >/dev/null || {
    echo "kwriteconfig6 is required." >&2
    exit 1
}

RESTORE_GEOMETRY_CHANGE=false
if command -v kreadconfig6 >/dev/null &&
        [[ "$(kreadconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
            --key GeometryChangeWasEnabled --default false)" == "true" ]]; then
    RESTORE_GEOMETRY_CHANGE=true
    kwriteconfig6 --file kwinrc --group Plugins \
        --key "${GEOMETRY_EFFECT_ID}Enabled" --type bool true
    kwriteconfig6 --file kwinrc --group "${COMPAT_GROUP}" \
        --key GeometryChangeWasEnabled --delete
fi

kwriteconfig6 --file kwinrc --group Plugins --key "${PLUGIN_ID}Enabled" --type bool false
kwriteconfig6 --file kwinrc --group Plugins --key "${EFFECT_ID}Enabled" --type bool false

if kpackagetool6 --type=KWin/Script --list | grep -Fxq "${PLUGIN_ID}"; then
    kpackagetool6 --type=KWin/Script --remove "${PLUGIN_ID}"
fi

if kpackagetool6 --type=KWin/Effect --list | grep -Fxq "${EFFECT_ID}"; then
    kpackagetool6 --type=KWin/Effect --remove "${EFFECT_ID}"
fi

if command -v qdbus6 >/dev/null; then
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
    [[ "${RESTORE_GEOMETRY_CHANGE}" == "false" ]] || \
        qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
elif command -v qdbus >/dev/null; then
    qdbus org.kde.KWin /KWin org.kde.KWin.reconfigure
    [[ "${RESTORE_GEOMETRY_CHANGE}" == "false" ]] || \
        qdbus org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
elif command -v gdbus >/dev/null; then
    gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure >/dev/null
    if [[ "${RESTORE_GEOMETRY_CHANGE}" == "true" ]]; then
        gdbus call --session --dest org.kde.KWin --object-path /Effects \
            --method org.kde.kwin.Effects.loadEffect "${GEOMETRY_EFFECT_ID}" >/dev/null || true
    fi
else
    echo "Removed. Log out and back in to finish unloading the script." >&2
fi

echo "Disabled and removed ${PLUGIN_ID} and ${EFFECT_ID}."
