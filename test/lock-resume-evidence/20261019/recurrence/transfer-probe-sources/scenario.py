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
    root = Path('/home/cc/cc_niri')
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
        source += "\n" + Path("/tmp/cc-niri-transfer-entry.js").read_text()
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
    action("stash")
    time.sleep(.3)
    stashed = action("inspect")
    checks["one_original_column"] = len(stashed["columns"]) == 1
    assert checks["one_original_column"], stashed
    action("cycle")
    time.sleep(.1)
    transfer = action("transfer", p5Delay=20)
    time.sleep(1)
    transfer = action("inspect")
    checks["existing_window_transfer_settled"] = len(transfer["columns"]) == 2 and transfer["enabled"] and not transfer["pending"]
    stop()
    report["transfer_records"] = [r for r in records() if r.get("kind", "").startswith("transfer-")]
