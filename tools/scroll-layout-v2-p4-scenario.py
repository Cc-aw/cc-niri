#!/usr/bin/env python3
"""P4 scenario inside the P3 guarded private virtual compositor harness."""
import json
import re
import subprocess
from pathlib import Path

def run(e):
    root=Path(__file__).resolve().parents[1]
    base, call, native, recorder, wait = [e[k] for k in ["base","call","native","recorder","wait"]]
    checks, report, rows, records, capture = [e[k] for k in ["checks","report","rows","records","capture"]]
    capability=json.loads(native("GetColumnGeometryCapability"))
    checks["protocol4_runtime_capability"] = capability == dict(protocol=4,type="COLUMN_GEOMETRY",enabled=True,inputPolicy="two-click",sourcePolicy="painted-client-frames")
    assert checks["protocol4_runtime_capability"]
    modules=["model/ColumnStore","layout/ContinuousColumnLayout","layout/ViewportPolicy","layout/ContinuousViewportController",
        "layout/ColumnWidthController","stability/LayoutTransaction","layout/ColumnGeometryPlan","layout/PartialScrollPlan",
        "layout/ColumnGeometryClientGate","layout/ScrollPlanCommitGate","layout/ColumnGeometryCoordinator",
        "integration/RuntimeBridge","layout/GeometryCommitter","stability/ParkingManager"]
    source="\n".join(re.sub(r'/\* cjs:start \*/[\s\S]*?/\* cjs:end \*/','', (root/('src/kwin/'+m+'.js')).read_text()) for m in modules)
    script=base/'p4-coordinator.js'
    source += (root/'test/fixtures/p4-coordinator.js').read_text().replace("__P4_IME__", "true" if e["ime"] else "false")
    script.write_text(source)
    eligibility=dict(protocol=1,type="focus-ring-eligibility",sessionId="p4-private-ring",generation=1,enabled=True,
        targetOutput="Virtual-0",workspaceId=e["state"]["workspaceId"],windows=[rows[n]["uuid"] for n in ["A","B"]])
    assert call("/ccNiriFocusRing", "org.cc.NiriFocusRing1.PublishEligibility",json.dumps(eligibility))
    native("StartScrollFrameCapture")
    script_id=call("/Scripting", "org.kde.kwin.Scripting.loadScript",script,"p4-coordinator")
    call(f"/Scripting/Script{script_id}","org.kde.kwin.Script.run")
    def marked(label): return next((r for r in records() if r.get("kind")=="p4-checkpoint" and r.get("label")==label),None)
    r12=wait(lambda:marked("r12"),18)
    report["r12"]=r12
    checks["real_js_r12_cycle_exactly_once_per_action"]=r12["modes"]==["half","half"] and r12["epoch"]==14
    checks["r12_no_secondary_surface_leak"]=capture("column-r-twelve",{})
    rapid=wait(lambda:marked("rapid"),5);report["rapid"]=rapid
    checks["real_js_rapid_model_epochs_and_focus"]=rapid["focus"]==rapid["focusedUuid"] and rapid["epoch"]==33 and rapid["count"]==2
    checks["rapid_reorder_no_secondary_leak"]=capture("column-rapid",{})
    # The stable mixed-width geometry endpoint keeps Native two-click policy.
    # The fixture leaves this checkpoint idle for 1.5 s; no geometry mutation
    # is used to manufacture the input coordinates.
    send, events, signals = [e[k] for k in ["send","events","signals"]]
    recorder("Mark","p4-shifted-input")
    before=len(signals("PartialFocusRequested"))
    send("move",x=2400,y=300);send("press");send("release");send("axis")
    checks["geometry_shifted_visual_click_and_wheel_consumed"] = not events("p4-shifted-input",{"MouseButtonPress","MouseButtonRelease","Wheel"}) and len(signals("PartialFocusRequested"))==before+1
    recorder("Mark","p4-natural-input")
    send("move",x=100,y=300);send("press");send("release")
    click=events("p4-natural-input",{"MouseButtonPress","MouseButtonRelease"})
    checks["geometry_natural_client_native_coordinates"] = len(click)==2 and all(r["title"]=="CC_NIRI_P0_A" and r["x"]==84 and r["y"]==234 and r["spontaneous"] for r in click)
    reverse=wait(lambda:marked("reverse"),5);report["reverse"]=reverse
    checks["real_js_mid_motion_reverse_completes"]=reverse["focus"]==reverse["focusedUuid"] and reverse["epoch"]>rapid["epoch"]
    checks["reverse_no_secondary_surface_leak"]=capture("column-reverse",{})
    if e["ime"]:
        import time
        before=len(signals("PartialFocusRequested"))
        recorder("Mark","p4-ime-candidate");recorder("BeginIME");time.sleep(.15)
        subprocess.run(["fcitx5-remote","--check","-s","pinyin"],check=True,timeout=3)
        subprocess.run(["fcitx5-remote","--check","-o"],check=True,timeout=3)
        for code in [49,23,35,30,24]:
            send("key",code=code,pressed=True);send("key",code=code,pressed=False)
        time.sleep(.25)
        status=json.loads(e["fixture"]("Status"));report["geometry_ime_candidate"]=status
        candidates=[w for w in status["auxiliary"] if w["width"]>0]
        checks["geometry_fcitx5_candidate_observed"]=bool(candidates)
        if candidates:
            c=candidates[0]
            send("move",x=c["x"]+20,y=c["y"]+min(15,c["height"]/2));send("press");send("release")
            checks["geometry_candidate_click_not_partial_focus"] = len(signals("PartialFocusRequested"))==before
            send("key",code=28,pressed=True);send("key",code=28,pressed=False)
            checks["geometry_candidate_commits_real_text"] = any(r.get("kind")=="ime-text" and any(ord(c)>127 for c in r["text"]) for r in records())
        send("key",code=1,pressed=True);send("key",code=1,pressed=False)
        subprocess.run(["fcitx5-remote","--check","-c"],check=True,timeout=3)
    overlap=wait(lambda:marked("overlap"),5);report["overlap"]=overlap
    ambiguous=wait(lambda:next((r for r in records() if r.get("kind")=="p4-ambiguous-input"),None),2);report["ambiguous_input"]=ambiguous
    checks["real_natural_surface_overlap_observed"]=ambiguous["overlap"] is True and ambiguous["accepted"] is True
    checks["ambiguous_input_pair_consumed_without_wrong_client_or_focus"]=not events("p4-ambiguous",{"MouseButtonPress","MouseButtonRelease"}) and not any(r["epoch"]==ambiguous["epoch"] for r in signals("PartialFocusRequested"))
    closed=wait(lambda:marked("closed"),5);report["closed"]=closed
    checks["close_during_configure_keeps_survivor_visible"]=closed["count"]==1 and closed["shown"]==1 and closed["focus"]==closed["focusedUuid"]
    inserted=wait(lambda:marked("inserted"),6);report["inserted"]=inserted
    checks["hidden_incoming_and_transit_long_jump_reverse"] = inserted["count"]==3 and inserted["modes"]==["twoThirds","full","half"] and inserted["focus"]==closed["focusedUuid"]
    removed=wait(lambda:marked("removed"),5);report["removed"]=removed
    checks["close_transit_and_incoming_releases_model"] = removed["count"]==1 and removed["shown"]==1
    restored=wait(lambda:marked("workspace-return"),5);report["workspace_return"]=restored
    checks["jk_returns_same_width_and_focus"]=restored["modes"]==closed["modes"] and restored["count"]==1 and restored["focus"]==closed["focusedUuid"]
    recovered=wait(lambda:marked("recovered"),5);report["recovered"]=recovered
    checks["lost_arm_reply_confirmed_disarm_rehydrates_legal_visible_frame"] = recovered["modes"]==["half"] and recovered["shown"]==1 and len([r for r in records() if r.get("kind")=="p4-injected-lost-arm-reply"])==1
    final=wait(lambda:next((r for r in records() if r.get("kind")=="p4-finished"),None),5)
    report["final"]=final
    checks["safe_stop_native_disarm_and_no_lifetime_handles"]=final["disarmed"] is True and final["timers"]==0 and final["listener"] is False and final["shown"]==1
    checks["no_p4_runtime_recovery_or_stale_activation"]=not any(r.get("kind")=="p4-fault" for r in records())
    report["scroll_capture"]=json.loads(native("GetScrollFrameCapture"))
    frames=report["scroll_capture"]["paintedFrames"]
    checks["production_geometry_used_real_presentation_passes"]=len({r["epoch"] for r in frames})>=12
    # New curve origin is the actual previous camera paint, including nonzero
    # velocity when the midpoint reverse is feasible (bounded brake may apply).
    bootstraps={r["epoch"] for r in records() if r.get("kind")=="p4-checkpoint" and r.get("bootstrap")}
    transitions=[]
    for before,after in zip(frames,frames[1:]):
        if before["epoch"]!=after["epoch"] and after["epoch"] not in bootstraps:
            transitions.append(dict(source=before,target=after))
    report["retarget_transitions"]=transitions
    checks["real_painted_camera_retarget_origin"]=bool(transitions) and all(abs(t["target"]["initialX"]-t["source"]["x"])<0.000001 for t in transitions)
    checks["nonzero_mid_motion_camera_retarget_exercised"]=any(abs(t["target"]["initialVelocity"])>0.01 for t in transitions)
    ring=json.loads(call("/ccNiriFocusRing","org.cc.NiriFocusRing1.GetFocusRingStatus"));report["ring_status"]=ring
    checks["ring_keeps_native_shared_frame"]=ring["drawCount"]>0 and ring["sharedFrameSamples"]>0
    checks["final_secondary_stays_black"]=capture("column-final",{})
