"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("offline animation analysis keeps presentation and motion statistics separate", () => {
    const program = `
import runpy
analyze = runpy.run_path("tools/analyze-animation-capture.py")["analyze"]
capture = {"version": 1, "active": False, "truncated": False, "repaintFullRequests": 3,
 "repaintScope": "fixture", "outputs": [{"token": 1, "name": "DP-1", "refreshHz": 60}],
 "presentations": [{"output": 1, "atMs": t} for t in [0, 10, 30, 60, 60, 59]],
 "paintedFrames": [{"output": 1, "epoch": 1, "revision": 1, "profile": "smooth60",
 "initialX": 0, "target": 100, "x": x, "v": v, "scale": 1.5, "refreshHz": 60,
 "eventMs": 0, "startMs": 0, "sampleMs": t, "paintMs": t - 2, "fallback": 0,
 "numericalCompleted": x == 100, "ownershipActive": True} for t, x, v in [(10, 50, 100), (20, 99.9, 0), (30, 100, 0)]],
 "lifecycle": [{"kind": 1, "output": 1, "epoch": 1, "revision": 1, "atMs": 40}]}
r = analyze(capture)
p, m = r["presentationStats"][0], r["trajectoryStats"][0]
assert r["repaintOutputRequests"] is None and p["targetRepaintRequests"] is None
assert r["continuousRepaintFullRequests"] is None and r["continuousRepaintFallbackFullRequests"] is None
capture.update(repaintOutputRequests=12, continuousRepaintFullRequests=0, continuousRepaintFallbackFullRequests=0)
capture["outputs"][0]["targetRepaintRequests"] = 12
capture["outputs"].append({"token": 2, "name": "HDMI-A-1", "refreshHz": 60, "targetRepaintRequests": 0})
r = analyze(capture)
assert r["repaintOutputRequests"] == 12 and r["continuousRepaintFullRequests"] == 0
assert r["continuousRepaintFallbackFullRequests"] == 0
assert [p["targetRepaintRequests"] for p in r["presentationStats"]] == [12, 0]
assert p["sampleCount"] == 6 and p["invalidIntervals"] == 2
assert p["p50Ms"] == 20 and p["p95Ms"] == 29 and p["maxMs"] == 30
assert p["longIntervals"] == 1 and p["longIntervalThresholdMs"] == 25
assert m["firstVisiblePaintResponseMs"] == 8 and m["sampledT95Ms"] == 20
assert m["sampledDualVisualThresholdMs"] == 20 and m["sampledNumericalCompletionMs"] == 30
assert m["ownershipAtCompletion"] and m["cancelRequestAtCaptureMs"] == 40
capture["truncated"] = True
assert analyze(capture)["truncated"]
capture["paintedFrames"][1]["scale"] = 2
capture["paintedFrames"][1]["refreshHz"] = 120
r = analyze(capture)
assert r["trajectoryStats"][0]["scaleChanged"]
assert r["presentationStats"][0]["longIntervals"] is None
capture["paintedFrames"][0]["startMs"] = -1
r = analyze(capture)["trajectoryStats"][0]
assert r["startedBeforeCapture"] and r["firstVisiblePaintResponseMs"] is None and r["sampledT95Ms"] is None
capture["version"] = 0
try:
 analyze(capture)
except ValueError:
 pass
else:
 raise AssertionError("old capture version must be rejected")
`;
    const result = spawnSync("python3", ["-c", program], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
