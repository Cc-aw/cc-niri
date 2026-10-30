#!/usr/bin/env python3
"""Pixel-level workspace return checks on the guarded private KWin only."""
import json
import time
from pathlib import Path


def run(e):
    root = Path(__file__).resolve().parents[1]
    call, native, wait, records = (e[k] for k in ("call", "native", "wait", "records"))
    checks, report = e["checks"], e["report"]
    serial = 0

    def bridge(method, *args):
        assert e["owned"]("org.cc.CCNiriBridge", e["bridge"])
        return call("/CCNiriBridge", "org.cc.CCNiriBridge1." + method, *args,
                    service="org.cc.CCNiriBridge")

    def latest(label, before):
        return wait(lambda: next((row for row in records()[before:]
                    if row.get("kind") == "p5-checkpoint" and row.get("label") == label), None), 5)

    def action(name):
        nonlocal serial
        serial += 1
        state = json.loads(bridge("GetState"))
        before = len(records())
        command = dict(protocol=1, type="focus-column-right", commandId=f"visibility-{serial}",
                       sessionId=state["sessionId"], baseGeneration=state["generation"],
                       windowUuid="p5-private", p5Action=name)
        assert bridge("RequestCommand", json.dumps(command))
        row = latest(name, before)
        if name != "stop":
            assert row["enabled"] and not row["errors"], row
        return row

    source = (root / "package/contents/code/main.js").read_text()
    source = '''function visibilityReadConfig(key, fallback) {
        const values = { ScrollLayoutV2Enabled: true, ScrollLayoutGap: 16, ScrollLayoutTopGap: 8,
            DebugLogging: true, DockIntegration: false, DynamicTrailingWorkspace: false,
            AutoRecycleWorkspaces: false, TargetOutputName: "Virtual-0" };
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    }\n''' + source.replace("loadRuntimeConfig(readConfig)", "loadRuntimeConfig(visibilityReadConfig)")
    source += "\n" + (root / "test/fixtures/p5-runtime-entry.js").read_text()
    path = e["base"] / "visibility-entry.js"
    path.write_text(source)
    before = len(records())
    sid = call("/Scripting", "org.kde.kwin.Scripting.loadScript", str(path), "visibility-entry")
    call(f"/Scripting/Script{sid}", "org.kde.kwin.Script.run")
    latest("initial", before)

    # D has server-side decorations like the incident's Dolphin; B is frameless
    # like kitty. Keep their content static so client damage cannot mask a stale
    # redirected texture. No synthetic damage or focus is sent to the left client.
    for name in ("CC_NIRI_P0_A", "CC_NIRI_P0_C"):
        assert e["recorder"]("CloseClient", name)
    wait(lambda: len(json.loads(bridge("GetState"))["columns"]) == 2)
    wait(lambda: json.loads(native("GetColumnGeometrySource")).get("valid"))
    row = action("inspect")
    focused = next(c for c in row["columns"] if c["uuid"] == row["focusedUuid"])
    if focused["caption"] != "CC_NIRI_P0_D":
        row = action("focus-next")
    row = action("cycle")
    row = action("move-left")
    row = action("focus-next")
    assert [c["caption"] for c in row["columns"]] == ["CC_NIRI_P0_D", "CC_NIRI_P0_B"], row
    assert [c["widthMode"] for c in row["columns"]] == ["twoThirds", "half"], row
    e["send"]("move", x=2000, y=300)
    checks["rounded_corners_loaded"] = call("/Effects", "org.kde.kwin.Effects.isEffectLoaded", "kwin4_effect_shapecorners")
    assert checks["rounded_corners_loaded"]

    def capture(label):
        # Check final pixels, not just a successful Native paint callback.
        ok = e["capture"](label, {0: [(100, 300, "#994499"), (1100, 300, "#994499"),
                                      (1400, 300, "#32a060")]})
        observed = json.loads(native("GetColumnGeometrySource"))
        report.setdefault("visibility_returns", []).append(dict(label=label, pixels=ok, source=observed))
        checks[label] = ok
        if not ok:
            report["status"] = "FAIL"
            assert e["recorder"]("RepaintClient", "CC_NIRI_P0_D")
            time.sleep(.15)
            repaired = e["capture"]("visibility-after-client-damage", {
                0: [(100, 300, "#994499"), (1100, 300, "#994499"), (1400, 300, "#32a060")]})
            report["visibility_client_damage_restored_pixels"] = repaired
            raise AssertionError(f"Missing client pixels after {label}; client damage restored={repaired}; "
                                 f"Native source valid={observed.get('valid')}")

    time.sleep(.5)
    capture("visibility-initial")
    def opacity(value):
        # Test-only platform stimulus: no minimize, geometry, camera or focus
        # change. Run in the already guarded disposable compositor.
        label = f"visibility-opacity-{value}"
        script = e["base"] / (label + ".js")
        script.write_text('''const window = workspace.windowList().find(w => w.caption === "CC_NIRI_P0_D");
            if (!window) throw new Error("missing private client");
            window.opacity = VALUE;
            callDBus("org.cc.CCNiriP0Fixture", "/P0", "org.cc.CCNiriP0Fixture1", "Record",
                JSON.stringify({kind:"visibility-opacity",value:VALUE}), function(){});
        '''.replace("VALUE", str(value)))
        start = len(records())
        observer = call("/Scripting", "org.kde.kwin.Scripting.loadScript", str(script), label)
        try:
            call(f"/Scripting/Script{observer}", "org.kde.kwin.Script.run")
            wait(lambda: any(r.get("kind") == "visibility-opacity" and r.get("value") == value
                            for r in records()[start:]))
        finally:
            call("/Scripting", "org.kde.kwin.Scripting.unloadScript", label)

    report["opacity_control_before"] = json.loads(native("GetColumnGeometrySource"))
    opacity(0)
    time.sleep(.1)
    checks["opacity_zero_hides_without_client_damage"] = e["capture"]("visibility-zero-before-damage", {
        0: [(100, 300, "#000000"), (1100, 300, "#000000"), (1400, 300, "#32a060")]})
    assert e["recorder"]("RepaintClient", "CC_NIRI_P0_D")
    time.sleep(.15)
    checks["opacity_zero_capture_is_transparent"] = e["capture"]("visibility-zero-alpha", {
        0: [(100, 300, "#000000"), (1100, 300, "#000000"), (1400, 300, "#32a060")]})
    opacity(1)
    time.sleep(.15)
    expected = {0: [(100, 300, "#994499"), (1100, 300, "#994499"), (1400, 300, "#32a060")]}
    restored = e["capture"]("visibility-opacity-restored", expected)
    report["opacity_control_restored"] = json.loads(native("GetColumnGeometrySource"))
    checks["opacity_restore_refreshes_cached_pixels"] = restored
    if not restored:
        assert e["recorder"]("RepaintClient", "CC_NIRI_P0_D")
        time.sleep(.15)
        checks["client_damage_restores_cached_pixels"] = e["capture"]("visibility-damage-restored", expected)
        report["visibility_opacity_cache_reproduced"] = checks["client_damage_restores_cached_pixels"]
        call("/Effects", "org.kde.kwin.Effects.unloadEffect", "kwin4_effect_shapecorners")
        try:
            opacity(0)
            assert e["recorder"]("RepaintClient", "CC_NIRI_P0_D")
            time.sleep(.15)
            e["capture"]("visibility-no-corners-zero", {0: [(100, 300, "#000000")]})
            opacity(1)
            time.sleep(.15)
            checks["without_corners_opacity_restore_refreshes_pixels"] = e["capture"](
                "visibility-no-corners-restored", expected)
        finally:
            assert call("/Effects", "org.kde.kwin.Effects.loadEffect", "kwin4_effect_shapecorners")
        stopped = action("stop")
        checks["visibility_stop_confirmed"] = stopped["stopConfirmed"]
        call(f"/Scripting/Script{sid}", "org.kde.kwin.Script.stop")
        return
    for cycle in range(12):
        action("workspace-next")
        # Alternate a completed desktop animation with a rapid reverse.
        time.sleep(.5 if cycle % 2 == 0 else .04)
        action("workspace-prev")
        time.sleep(.5)
        capture(f"visibility-return-{chr(ord('a') + cycle)}")
    idle_before = json.loads(native("GetScrollMotionStatus"))
    time.sleep(.2)
    idle_after = json.loads(native("GetScrollMotionStatus"))
    checks["visibility_idle_has_no_native_continuation_repaints"] = all(
        idle_before[key] == idle_after[key] for key in (
            "scrollOutputRepaintRequests", "scrollContinuousFullRepaintRequests",
            "scrollRepaintFallbackFullRequests"))
    stopped = action("stop")
    checks["visibility_stop_confirmed"] = stopped["stopConfirmed"]
    call(f"/Scripting/Script{sid}", "org.kde.kwin.Script.stop")
