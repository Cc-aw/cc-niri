#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="cc-niri-maximize"
EFFECT_ID="cc-niri-maximize-scroll-transition"
GEOMETRY_EFFECT_ID="kwin4_effect_geometry_change"
COMPAT_GROUP="CCNiriCompatibility"

command -v kpackagetool6 >/dev/null || {
    echo "kpackagetool6 is required." >&2
    exit 1
}
command -v kwriteconfig6 >/dev/null || {
    echo "kwriteconfig6 is required." >&2
    exit 1
}

restore_parked_windows() {
    local restore_requested=false
    local restore_reply=""
    local restore_attempt=0
    for ((restore_attempt = 0; restore_attempt < 10; restore_attempt += 1)); do
        if command -v qdbus6 >/dev/null; then
            restore_reply="$(qdbus6 org.cc.ScrollDockBridge /ScrollDock \
                org.cc.ScrollDockBridge1.RequestEmergencyRestore \
                2>/dev/null || true)"
        elif command -v qdbus >/dev/null; then
            restore_reply="$(qdbus org.cc.ScrollDockBridge /ScrollDock \
                org.cc.ScrollDockBridge1.RequestEmergencyRestore \
                2>/dev/null || true)"
        elif command -v gdbus >/dev/null; then
            restore_reply="$(gdbus call --session --dest org.cc.ScrollDockBridge \
                --object-path /ScrollDock \
                --method org.cc.ScrollDockBridge1.RequestEmergencyRestore \
                2>/dev/null || true)"
        fi
        if [[ "${restore_reply}" == *true* ]]; then
            restore_requested=true
            break
        fi
        sleep 0.1
    done

    local restore_action="CCScrollEmergencyRestore"
    [[ "${restore_requested}" == "false" ]] || \
        restore_action="CCScrollApplyDockCommand"
    if command -v qdbus6 >/dev/null; then
        qdbus6 org.kde.kglobalaccel /component/kwin \
            org.kde.kglobalaccel.Component.invokeShortcut \
            "${restore_action}" >/dev/null 2>&1 || true
    elif command -v qdbus >/dev/null; then
        qdbus org.kde.kglobalaccel /component/kwin \
            org.kde.kglobalaccel.Component.invokeShortcut \
            "${restore_action}" >/dev/null 2>&1 || true
    elif command -v gdbus >/dev/null; then
        gdbus call --session --dest org.kde.kglobalaccel \
            --object-path /component/kwin \
            --method org.kde.kglobalaccel.Component.invokeShortcut \
            "${restore_action}" >/dev/null 2>&1 || true
    fi
    sleep 0.3
}

restore_parked_windows
systemctl --user disable --now cc-scroll-dock-bridge.service >/dev/null 2>&1 || true

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
