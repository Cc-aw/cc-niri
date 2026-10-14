"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("workspace transition analysis excludes idle and preserves long first/tail frames", () => {
    const program = `
import copy, json, runpy
m = runpy.run_path("tools/analyze-workspace-capture.py")
analyze = m["analyze_transitions"]
capture = {
 "source": "KWin::RenderLoop::framePresented", "desktopEventsTruncated": False,
 "desktopChanges": [{"outputName": "DP-1", "atMs": 100}],
 "outputs": [{"outputName": "DP-1", "refreshHz": 60, "truncated": False,
              "presentedMs": [0, 120, 150, 180, 210, 900]}],
 "motionCapture": {"outputs": [{"name": "DP-1", "token": 1}], "truncated": False,
 "records": [{"kind": 1, "output": 1, "atMs": 110},
             {"kind": 2, "output": 1, "atMs": 200}]}}
original = copy.deepcopy(capture)
r = analyze(capture)
t = r["outputs"][0]["transitions"][0]
assert r["association"] == "output-only-no-paint-to-present-join"
assert t["presentationStats"]["intervalsMs"] == [30, 30, 30]
assert t["firstPresentationLatencyMs"] == 20
assert t["firstPaintCallbackLatencyMs"] == 10
assert t["presentationStats"]["intervalsOver25Ms"] == 3
assert len(t["longPresentationIntervals"]) == 3
assert t["presentationStats"]["p95Ms"] == 30
assert t["validForComparison"] and capture == original
# A missing initial update remains explicit, even when later intervals are fine.
c = copy.deepcopy(capture)
c["outputs"][0]["presentedMs"] = [94, 150, 166, 182, 198, 214]
t = analyze(c)["outputs"][0]["transitions"][0]
assert t["firstPresentationLatencyMs"] == 50
assert t["presentationStats"]["maxMs"] == 16
# JSON and gdbus wrappers preserve the same unmodified timestamps.
raw = json.dumps(capture)
assert m["load_capture"](raw) == capture
assert m["load_capture"](repr((raw,))) == capture
try:
 m["load_capture"]("('a', 'b')")
except ValueError:
 pass
else:
 raise AssertionError("multiple D-Bus values must be rejected")
`;
    const result = spawnSync("python3", ["-c", program], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("workspace transition analysis separates completed transitions and output timelines", () => {
    const program = `
import runpy
analyze = runpy.run_path("tools/analyze-workspace-capture.py")["analyze_transitions"]
capture = {
 "desktopChanges": [{"outputName": "DP-1", "atMs": 100},
                    {"outputName": "DP-1", "atMs": 160},
                    {"outputName": "HDMI-A-1", "atMs": 300},
                    {"outputName": "DP-1", "atMs": 1000}],
 "outputs": [{"outputName": "DP-1", "refreshHz": 60,
              "presentedMs": [0, 110, 126, 142, 158, 174, 190, 206, 1010, 1026]},
             {"outputName": "HDMI-A-1", "refreshHz": 120,
              "presentedMs": [290, 304, 321, 329]}],
 "motionCapture": {"outputs": [{"name": "DP-1", "token": 1},
                               {"name": "HDMI-A-1", "token": 2}],
 "records": [{"kind": 2, "output": 1, "atMs": 200},
             {"kind": 2, "output": 2, "atMs": 325},
             {"kind": 2, "output": 1, "atMs": 1020}]}}
r = analyze(capture)["outputs"]
a = r[0]["aggregate"]
assert a["intervalCount"] == 7 and a["maxMs"] == 16
assert a["validTransitionCount"] == 2 and a["intervalsOver25Ms"] == 0
assert [t["desktopChangeCount"] for t in r[0]["transitions"]] == [2, 1]
assert r[1]["transitions"][0]["presentationStats"]["intervalsMs"] == [17, 8]
assert r[1]["transitions"][0]["presentationStats"]["intervalsOver1_5Refresh"] == 1
# The previous finish allowance never consumes another transition's frames.
capture["desktopChanges"][3]["atMs"] = 205
capture["motionCapture"]["records"][2]["atMs"] = 230
capture["outputs"][0]["presentedMs"] = [110, 126, 142, 158, 174, 190, 206, 222, 238]
r = analyze(capture)["outputs"][0]["transitions"]
assert r[0]["presentationStats"]["intervalCount"] == 5
assert r[1]["presentationStats"]["intervalCount"] == 2
assert r[0]["endBoundaryMs"] == 205
`;
    const result = spawnSync("python3", ["-c", program], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("workspace transition analysis marks missing finishes, truncation and invalid samples", () => {
    const program = `
import copy, runpy
analyze = runpy.run_path("tools/analyze-workspace-capture.py")["analyze_transitions"]
capture = {"desktopChanges": [{"outputName": "DP-1", "atMs": 100}],
 "outputs": [{"outputName": "DP-1", "refreshHz": 60, "presentedMs": [110, 150, 190]}],
 "motionCapture": {"outputs": [{"name": "DP-1", "token": 1}],
 "records": [{"kind": 2, "output": 1, "atMs": 200}]}}
for field, owner in [("truncated", "motionCapture"), ("truncated", "output"),
                     ("desktopEventsTruncated", "capture")]:
 c = copy.deepcopy(capture)
 target = c["outputs"][0] if owner == "output" else c if owner == "capture" else c[owner]
 target[field] = True
 r = analyze(c)["outputs"][0]
 assert r["transitions"][0]["presentationStats"]["maxMs"] == 40
 assert not r["transitions"][0]["validForComparison"]
 assert r["aggregate"]["intervalCount"] == 0
c = copy.deepcopy(capture)
c["motionCapture"]["records"] = []
r = analyze(c)["outputs"][0]
assert not r["transitions"][0]["complete"]
assert r["transitions"][0]["presentationStats"] is None
assert r["aggregate"]["excludedTransitionCount"] == 1
c = copy.deepcopy(capture)
c["outputs"][0]["presentedMs"] = [110, 110, 105, 150]
r = analyze(c)["outputs"][0]
assert r["transitions"][0]["presentationStats"]["invalidIntervals"] == 2
assert not r["transitions"][0]["validForComparison"]
c["outputs"][0]["refreshHz"] = 0
assert analyze(c)["outputs"][0]["transitions"][0]["presentationStats"] is None
c = copy.deepcopy(capture)
c["outputs"][0]["presentedMs"] = []
assert "no-presentation-samples" in analyze(c)["outputs"][0]["transitions"][0]["limitations"]
`;
    const result = spawnSync("python3", ["-c", program], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
