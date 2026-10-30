#!/usr/bin/bash
# Test-only substitutes. All state and fault injection stay in a temporary tree.
set -euo pipefail
root=${CC_NIRI_CORNERS_TEST_ROOT:?}
name=${0##*/}
args=("$@")
printf '%s' "$name" >> "$root/calls"
printf '\t%s' "$@" >> "$root/calls"
printf '\n' >> "$root/calls"
argument() {
    local i
    for i in "${!args[@]}"; do
        if [[ "${args[$i]}" == "$1" ]]; then printf '%s' "${args[$((i+1))]}"; return; fi
    done
    return 1
}
reject() {
    local file="$root/faults/$1/$2" count=0 occurrence
    [[ -f "$file" ]] || return 1
    [[ ! -f "$file.count" ]] || count=$(<"$file.count")
    count=$((count+1))
    printf '%s' "$count" > "$file.count"
    for occurrence in $(<"$file"); do
        if [[ "$occurrence" == "$count" ]]; then return 0; fi
    done
    return 1
}
case "$name" in
    kreadconfig6)
        key="$(argument --group)/$(argument --key)"
        if reject read "$key"; then exit 1; fi
        if [[ -f "$root/config/$key" ]]; then cat "$root/config/$key"; else argument --default; fi
        ;;
    kwriteconfig6)
        group=$(argument --group); key="$group/$(argument --key)"
        if reject write "$key"; then exit 1; fi
        if [[ " $* " == *' --delete '* ]]; then rm -f "$root/config/$key"
        else
            [[ -d "$root/config/$group" ]] || mkdir -p "$root/config/$group"
            printf '%s' "${args[-1]}" > "$root/config/$key"
        fi
        ;;
    systemctl)
        if [[ " $* " == *' disable '* ]]; then : > "$root/bridge-disabled"; fi
        if [[ " $* " == *' is-active '* ]]; then printf 'active\n'; fi
        ;;
    sleep) ;;
    gdbus)
        method=$(argument --method); value=${args[-1]}
        if reject dbus "${method##*.}"; then exit 1; fi
        case "$method" in
            *.isScriptLoaded) printf '(%s,)\n' "$(<"$root/loaded")" ;;
            *.isEffectLoaded)
                if [[ -f "$root/effects/$value" ]]; then printf '(true,)\n'; else printf '(false,)\n'; fi ;;
            *.loadScript) printf '(7,)\n' ;;
            *.Script.run) printf true > "$root/loaded"; printf '()\n' ;;
            *.unloadScript) printf false > "$root/loaded"; printf '(true,)\n' ;;
            *.loadEffect) : > "$root/effects/$value"; printf '(true,)\n' ;;
            *.unloadEffect) rm -f "$root/effects/$value"; printf '()\n' ;;
            *.shortcutNames) printf "(['CCScrollEmergencyRestore', 'CCScrollApplyRuntimeCommand'],)\n" ;;
            *.GetRecoveryStatus)
                if [[ -f "$root/blocked-recovery" ]]; then
                    printf "('{\"protocol\":1,\"type\":\"recovery-status\",\"sessionId\":\"test\",\"state\":\"blocked\"}',)\n"
                else printf "('',)\n"; fi ;;
            *.GetState) printf "('{\"sessionId\":\"test\",\"generation\":1}',)\n" ;;
            *.RequestCommand) printf '(false,)\n' ;;
            *.reconfigureEffect)
                if [[ "$value" == kwin4_effect_shapecorners ]]; then
                    for key in DisableRoundTile UseSquircleShape; do
                        if [[ -f "$root/config/Round-Corners/$key" ]]; then
                            cp "$root/config/Round-Corners/$key" "$root/applied/$key"
                        else rm -f "$root/applied/$key"; fi
                    done
                fi
                printf '()\n' ;;
            *) printf '()\n' ;;
        esac
        ;;
    *) exit 2 ;;
esac
