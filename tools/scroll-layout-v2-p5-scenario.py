#!/usr/bin/env python3
"""Full generated runtime entry on the existing guarded private KWin bus."""
import json
import os
import shutil
import sys
import subprocess
from pathlib import Path
import time


def run(e):
    root = Path(__file__).resolve().parents[1]
    base, call, native, recorder, wait, records = [e[k] for k in ["base", "call", "native", "recorder", "wait", "records"]]
    checks, report = e["checks"], e["report"]
    serial = 0
    script = None
    mode = True
    def bridge(method, *args):
        assert e["owned"]("org.cc.CCNiriBridge", e["bridge"])
        return call("/CCNiriBridge", "org.cc.CCNiriBridge1." + method, *args, service="org.cc.CCNiriBridge")

    def latest(label, before, timeout=5):
        return wait(lambda: next((r for r in records()[before:] if r.get("kind") == "p5-checkpoint" and r.get("label") == label), None), timeout)

    def load(v2):
        nonlocal serial, script, mode
        serial += 1; mode = v2
        source = (root / "package/contents/code/main.js").read_text()
        # Same composition; only readConfig is fixture-local. The production
        # default remains false and no installed configuration is touched.
        source = '''function p5ReadConfig(key, fallback) {
            const values = { ScrollLayoutV2Enabled: V2_VALUE, ScrollLayoutGap: 16,
                DebugLogging: true, DockIntegration: false, DynamicTrailingWorkspace: false,
                AutoRecycleWorkspaces: false, TargetOutputName: "Virtual-0" };
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
        }\n'''.replace("V2_VALUE", "true" if v2 else "false") + source.replace("loadRuntimeConfig(readConfig)", "loadRuntimeConfig(p5ReadConfig)")
        source += "\n" + (root / "test/fixtures/p5-runtime-entry.js").read_text()
        path = base / f"p5-entry-{serial}.js"; path.write_text(source)
        before = len(records())
        plugin_name = "cc-niri-maximize" if e.get("scenario") == "p6" and len(report.get("p5_runs", [])) >= 2 else f"p5-entry-{serial}"
        script = call("/Scripting", "org.kde.kwin.Scripting.loadScript", path, plugin_name)
        call(f"/Scripting/Script{script}", "org.kde.kwin.Script.run")
        row = latest("initial", before, 7)
        report.setdefault("p5_runs", []).append(row)
        assert row["enabled"] and not row["errors"], row
        return row

    def action(name, timeout=5, **fields):
        nonlocal serial
        serial += 1
        state = json.loads(bridge("GetState"))
        before = len(records())
        command = dict(protocol=1, type="focus-column-right", commandId=f"p5-{serial}",
            sessionId=state["sessionId"], baseGeneration=state["generation"], windowUuid="p5-private",
            p5Action=name, **fields)
        assert bridge("RequestCommand", json.dumps(command))
        row = latest(name, before, timeout); report.setdefault("p5_actions", []).append(row)
        if name != "stop": assert row["enabled"] and not row["errors"], row
        return row

    def stop():
        row = action("stop")
        if mode:
            checks[f"stop_{len(report.get('p5_runs', []))}_confirmed"] = row["stopConfirmed"] and all(
                c["opacity"] > 0 and not c["minimized"] for c in row["columns"])
            assert checks[f"stop_{len(report.get('p5_runs', []))}_confirmed"], row
        call(f"/Scripting/Script{script}", "org.kde.kwin.Script.stop")
        return row

    native("StartScrollFrameCapture")
    first = load(True)
    checks["full_generated_entry_owns_live_four_client_model"] = len(first["columns"]) == 4 and first["workspaceId"] == first["currentWorkspaceId"]
    cycle = action("cycle")
    target = next(c for c in cycle["columns"] if c["uuid"] == cycle["focusedUuid"])
    checks["real_entry_r_changes_active_to_two_thirds"] = target["widthMode"] == "twoThirds" and target["frame"]["width"] == 1680
    checks["actual_output_scale_preserved_in_snapshot"] = cycle["snapshot"]["viewportAnchorV2"]["basis"]["physicalScale"] == e["scale"]
    checks["versioned_negative_anchor_published"] = cycle["snapshot"]["viewportAnchorV2"]["delta"] == -440
    full = action("full"); back = action("full")
    checks["real_entry_f_restores_previous_two_thirds"] = next(c for c in full["columns"] if c["uuid"] == full["focusedUuid"])["widthMode"] == "full" and next(c for c in back["columns"] if c["uuid"] == back["focusedUuid"])["widthMode"] == "twoThirds"
    if e["ime"]:
        before = len(e["signals"]("PartialFocusRequested"))
        recorder("Mark", "p-five-ime"); recorder("BeginIME"); time.sleep(.15)
        subprocess.run(["fcitx5-remote", "--check", "-s", "pinyin"], check=True, timeout=3)
        subprocess.run(["fcitx5-remote", "--check", "-o"], check=True, timeout=3)
        for code in [49, 23, 35, 30, 24]:
            e["send"]("key", code=code, pressed=True); e["send"]("key", code=code, pressed=False)
        time.sleep(.25)
        status = json.loads(e["fixture"]("Status")); report["p5_ime_candidate"] = status
        candidates = [w for w in status["auxiliary"] if w["width"] > 0]
        checks["full_entry_real_fcitx5_candidate"] = bool(candidates)
        assert candidates
        candidate = candidates[0]
        e["send"]("move", x=candidate["x"]+20, y=candidate["y"]+min(15, candidate["height"]/2))
        e["send"]("press"); e["send"]("release")
        checks["full_entry_candidate_avoids_partial_focus"] = len(e["signals"]("PartialFocusRequested")) == before
        e["send"]("key", code=28, pressed=True); e["send"]("key", code=28, pressed=False)
        checks["full_entry_candidate_commits_real_text"] = any(r.get("kind") == "ime-text" and any(ord(c)>127 for c in r["text"]) for r in records())
        e["send"]("key", code=1, pressed=True); e["send"]("key", code=1, pressed=False)
        subprocess.run(["fcitx5-remote", "--check", "-c"], check=True, timeout=3)
    focused = action("focus-next")
    swapped = action("move-left")
    half = next(c for c in swapped["columns"] if c["uuid"] == focused["focusedUuid"])
    checks["half_swapped_left_of_two_thirds_fits_left_edge"] = half["widthMode"] == "half" and half["frame"]["x"] == 16 and half["frame"]["width"] == 1256 and swapped["activeUuid"] == half["uuid"] and not swapped["pending"]
    intent = next(r["intent"] for r in reversed(records()) if r.get("kind") == "p5-target" and r["intent"]["epoch"] == swapped["epoch"])
    request = json.dumps(dict(entries=[dict(windowId=row["uuid"], columnId=row["columnId"]) for row in intent["entries"]]))
    def reorder_source():
        # Same live membership-bound query used by production. Unbound telemetry
        # can be invalid once outgoing clients are parked after completion.
        source = json.loads(native("GetColumnGeometrySourceFor", request))
        return source if source.get("valid") and source.get("epoch") == swapped["epoch"] else None
    report["half_reorder_source"] = wait(reorder_source)
    checks["half_reorder_native_source_valid"] = report["half_reorder_source"]["valid"]
    checks["half_reorder_no_secondary_leak"] = e["capture"]("half-reorder-left", {})
    swapped_back = action("move-right")
    checks["half_swapped_right_fits_right_edge"] = next(c for c in swapped_back["columns"] if c["uuid"] == half["uuid"])["frame"]["x"] == 1288
    action("focus-prev")
    checks["hl_uses_actual_client_paint_before_activation"] = focused["focusedUuid"] == focused["activeUuid"] and not focused["pending"]
    center = action("center")
    checks["meta_z_only_centers_without_wide_mutation"] = [c["widthMode"] for c in center["columns"]] == [c["widthMode"] for c in back["columns"]] and not any(c["persistentWide"] for c in center["columns"])
    entered = action("fullscreen-enter")
    checks["fullscreen_native_suspended"] = any(c["fullScreen"] for c in entered["columns"]) and not json.loads(native("GetScrollMotionStatus"))["active"]
    exited = action("fullscreen-exit")
    checks["fullscreen_exact_width_restored"] = next(c for c in exited["columns"] if c["uuid"] == exited["focusedUuid"])["widthMode"] == "twoThirds"
    maximized = action("maximize"); normal = action("normal")
    checks["safe_area_maximize_separate_from_v2_full"] = next(c for c in maximized["columns"] if c["uuid"] == maximized["focusedUuid"])["frame"]["width"] == 2512 and normal["snapshot"]["presentation"]["mode"] == "normal"
    recorder("OpenDialog"); time.sleep(.15)
    dialog = action("inspect")
    checks["dialog_never_adopted_or_reframed"] = len(dialog["columns"]) == 4 and all(c["caption"] != "CC_NIRI_P0_DIALOG" for c in dialog["columns"])
    recorder("CloseDialog"); time.sleep(.1)
    action("workspace-next"); returned = action("workspace-prev")
    checks["jk_restores_signed_anchor_and_width"] = returned["workspaceId"] == first["workspaceId"] and any(c["widthMode"] == "twoThirds" for c in returned["columns"])
    moved = action("move-workspace-next")
    checks["move_and_follow_preserves_versioned_width"] = len(moved["columns"]) == 1 and moved["columns"][0]["widthMode"] == "twoThirds" and moved["activeUuid"] == moved["focusedUuid"]
    stop()
    v1 = load(False)
    checks["v1_reads_projection_and_retains_v2_preference"] = v1["columns"][0]["widthMode"] == "half" and v1["snapshot"]["columns"][0]["widthV2"]["widthMode"] == "twoThirds"
    stop()
    v2 = load(True)
    checks["v2_reenable_recovers_two_thirds_and_signed_view"] = v2["columns"][0]["widthMode"] == "twoThirds" and v2["snapshot"]["viewportAnchorV2"]["delta"] == -440
    checks["root_and_active_workspace_width_metadata_identical"] = v2["snapshot"]["columns"] == next(w["columns"] for w in v2["snapshot"]["workspaces"] if w["id"] == v2["workspaceId"])
    action("workspace-prev")
    action("move-workspace-next")
    action("move-left")
    action("focus-next")
    for delay in [40]:
        action("workspace-prev")
        interrupted = action("workspace-next-focus-prev", p5Delay=delay)
        report.setdefault("workspace_focus_interruptions", []).append(interrupted)
        half = next(c for c in interrupted["columns"] if c["uuid"] == interrupted["focusedUuid"])
        interruption = next(r for r in reversed(records()) if r.get("kind") == "p5-workspace-interruption")
        report.setdefault("workspace_interruption_status", []).append(interruption)
        checks[f"h_during_workspace_animation_{delay}ms"] = interruption["status"]["workspaceAnimationActive"]
        checks[f"half_fits_left_after_workspace_h_{delay}ms"] = (
            half["widthMode"] == "half" and half["frame"]["x"] == 16 and
            interrupted["activeUuid"] == half["uuid"] and not interrupted["pending"])
        assert checks[f"half_fits_left_after_workspace_h_{delay}ms"], interrupted
        action("focus-next")
    checks["full_entry_secondary_output_stays_black"] = e["capture"]("p-five-final", {})
    ring = json.loads(call("/ccNiriFocusRing", "org.cc.NiriFocusRing1.GetFocusRingStatus")); report["p5_ring"] = ring
    checks["real_ring_still_draws_with_shared_native_frame"] = ring["drawCount"] > 0 and ring["sharedFrameSamples"] > 0
    session_before = json.loads(bridge("GetState"))
    for cycle in range(3):
        assert e["fixture"]("ObserveSessionLockForTest", "true")
        wait(lambda: json.loads(bridge("GetRuntimeHealth")).get("state") == "locked")
        facts = json.loads(native("GetSessionState"))
        assert facts["locked"] is True
        wait(lambda: not json.loads(native("GetScrollMotionStatus"))["active"])
        assert e["fixture"]("ObserveSessionLockForTest", "false")
        wait(lambda: json.loads(bridge("GetRuntimeHealth")).get("state") == "running")
        wait(lambda: json.loads(native("GetColumnGeometrySource")).get("valid"))
        resumed = action("inspect")
        checks[f"synthetic_lock_cycle_{cycle}_resumes_current_session"] = resumed["enabled"] and not resumed["pending"] and not resumed["errors"]
        restored = json.loads(bridge("GetState"))
        checks[f"synthetic_lock_cycle_{cycle}_preserves_width_order_workspace"] = all(
            restored[key] == session_before[key] for key in ["columns", "workspaceId", "targetOutput"])
    report["session_lifecycle_scope"] = "Synthetic KWin lock signals on private Virtual outputs; real screen lock acceptance remains Pending"
    if e.get("scenario") == "p6":
        action("recovery-probe")
        report["scroll_capture"] = json.loads(native("GetScrollFrameCapture"))
        wrapper = base / "cli-bin"; wrapper.mkdir()
        real_gdbus = shutil.which("gdbus")
        wrapper_source = "#!" + sys.executable + "\n" + """import os,sys
args=sys.argv[1:]
method=args[args.index("--method")+1]
if method.endswith(".shortcutNames"): print("(['CCScrollApplyRuntimeCommand'],)")
elif method.endswith(".invokeShortcut"): print("()")
else:
""" + "    os.execv(" + repr(real_gdbus) + ", [" + repr(real_gdbus) + ",*args])\n"
        (wrapper / "gdbus").write_text(wrapper_source)
        (wrapper / "gdbus").chmod(0o700)
        # Private shortcuts are disabled. Only shortcut delivery is stubbed;
        # the bounded fixture pump delivers the real Bridge request to main.
        home = base / "cli-home"; home.mkdir()
        environment = dict(os.environ, HOME=str(home), PATH=str(wrapper)+":"+os.environ["PATH"])
        cli = subprocess.run(["bash", str(root/"cc-niri"), "stop"], env=environment, capture_output=True, text=True, timeout=15)
        report["p6_cli_stop"] = dict(exit_code=cli.returncode, stdout=cli.stdout, stderr=cli.stderr)
        checks["p6_real_cli_stop_succeeds_after_js_native_and_client_proof"] = cli.returncode == 0
        assert cli.returncode == 0, cli.stderr
        proof = json.loads(bridge("GetRecoveryStatus")); report["p6_recovery_proof"] = proof
        checks["p6_proof_matches_exact_live_cli_request"] = proof["state"] == "restored" and proof["requestId"].startswith("stop-") and proof["restoredCount"] >= 1
        checks["p6_cli_unloads_script_only_after_recovery"] = not call("/Scripting", "org.kde.kwin.Scripting.isScriptLoaded", "cc-niri-maximize")
        checks["p6_cli_unloads_both_native_plugins_without_kwin_crash"] = e["owned"]("org.kde.KWin", e["kwin"]) and all(not call("/Effects", "org.kde.kwin.Effects.isEffectLoaded", plugin) for plugin in ["cc-niri-viewport-clip","cc-niri-focus-ring"])
        checks["p6_recovery_ack_not_in_durable_workspace_snapshot"] = "recovery-status" not in (base/"state/cc-niri/workspaces.json").read_text()
        client = next(r for r in reversed(records()) if r.get("kind") == "p5-recovery-client")
        actual = next(r for r in e["geometry"]("recovery-accepted-frame")["rows"] if r["uuid"] == client["uuid"])
        checks["recovery_preserves_accepted_size_despite_stale_odd_height"] = all(actual["rect"][k] == client["accepted"][k] for k in ["width", "height"]) and not actual["minimized"]
        report["p6_repeat_stops"] = []
        sessions = {proof["sessionId"]}
        for iteration in range(2):
            for plugin in ["cc-niri-viewport-clip", "cc-niri-focus-ring"]:
                assert call("/Effects", "org.kde.kwin.Effects.loadEffect", plugin)
            load(True)
            action("recovery-probe")
            cli = subprocess.run(["bash", str(root/"cc-niri"), "stop"], env=environment, capture_output=True, text=True, timeout=15)
            proof = json.loads(bridge("GetRecoveryStatus"))
            report["p6_repeat_stops"].append(dict(exit_code=cli.returncode, stdout=cli.stdout, stderr=cli.stderr, proof=proof))
            checks[f"p6_repeat_stop_{iteration+1}_fresh_session_and_exact_proof"] = cli.returncode == 0 and proof["state"] == "restored" and proof["sessionId"] not in sessions and proof["requestId"].startswith("stop-")
            assert checks[f"p6_repeat_stop_{iteration+1}_fresh_session_and_exact_proof"], report["p6_repeat_stops"][-1]
            sessions.add(proof["sessionId"])
    else: stop()
    checks["no_fixture_faults"] = not any(r.get("kind") == "p5-fault" for r in records())
    if e.get("scenario") != "p6": report["scroll_capture"] = json.loads(native("GetScrollFrameCapture"))
