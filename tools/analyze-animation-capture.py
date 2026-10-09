#!/usr/bin/env python3
"""Offline analysis of scroll capture v1; paint and presentation remain separate."""
import argparse
import ast
import json
import math
from collections import defaultdict
from pathlib import Path


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lo = math.floor(index)
    hi = math.ceil(index)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo)


def analyze(capture):
    if not isinstance(capture, dict) or capture.get("version") != 1:
        raise ValueError("expected scroll capture version 1")
    outputs = {o["token"]: o for o in capture["outputs"]}
    presented = defaultdict(list)
    painted = defaultdict(list)
    for row in capture["presentations"]:
        presented[row["output"]].append(row["atMs"])
    for row in capture["paintedFrames"]:
        painted[(row["output"], row["epoch"], row["revision"], row["profile"])].append(row)
    report = {
        "truncated": capture["truncated"], "captureActive": capture["active"],
        "association": "output-only-no-paint-to-present-join",
        "repaintFullRequests": capture["repaintFullRequests"],
        "repaintOutputRequests": capture.get("repaintOutputRequests"),
        "continuousRepaintFullRequests": capture.get("continuousRepaintFullRequests"),
        "continuousRepaintFallbackFullRequests": capture.get("continuousRepaintFallbackFullRequests"),
        "repaintScope": capture["repaintScope"], "presentationStats": [], "trajectoryStats": [],
    }
    for token in sorted(set(outputs) | set(presented)):
        output = outputs.get(token, {"name": "unregistered", "refreshHz": 0})
        times = presented[token]
        intervals = [b - a for a, b in zip(times, times[1:])]
        valid = [dt for dt in intervals if math.isfinite(dt) and dt > 0]
        hz = output["refreshHz"]
        observed_rates = {r["refreshHz"] for key, rows in painted.items() if key[0] == token for r in rows}
        rate_changed = bool(observed_rates and observed_rates != {hz})
        threshold = 1500 / hz if hz > 0 and not rate_changed else None
        report["presentationStats"].append({
            "output": token, "name": output["name"], "refreshHz": hz,
            "sampleCount": len(times), "intervalCount": len(valid),
            "invalidIntervals": len(intervals) - len(valid), "refreshChanged": rate_changed,
            "p50Ms": percentile(valid, .50), "p95Ms": percentile(valid, .95),
            "p99Ms": percentile(valid, .99), "maxMs": max(valid, default=None),
            "longIntervalThresholdMs": threshold,
            "longIntervals": sum(dt > threshold for dt in valid) if threshold is not None else None,
            "fullRepaintRequests": output.get("fullRepaintRequests"),
            "targetRepaintRequests": output.get("targetRepaintRequests"),
        })
    for (token, epoch, revision, profile), rows in sorted(painted.items()):
        origin = rows[0]["initialX"]
        target = rows[0]["target"]
        distance = abs(target - origin)
        changed_scale = any(a["scale"] != b["scale"] for a, b in zip(rows, rows[1:]))
        steps = [abs(b["x"] - a["x"]) * b["scale"] for a, b in zip(rows, rows[1:]) if a["scale"] == b["scale"]]
        first_visible = next((r for r in rows if abs(r["x"] - origin) * r["scale"] > .25), None)
        t95 = next((r["sampleMs"] - r["startMs"] for r in rows if distance and abs(r["target"] - r["x"]) <= .05 * distance), None)
        # Measurement threshold only. This is not a production completion policy.
        visual = next((r["sampleMs"] - r["startMs"] for r in rows
                       if r["scale"] > 0 and r["refreshHz"] > 0
                       and abs(r["target"] - r["x"]) * r["scale"] <= .25
                       and abs(r["v"]) / r["refreshHz"] * r["scale"] <= .25), None)
        completed = next((r for r in rows if r["numericalCompleted"]), None)
        left_censored = rows[0]["startMs"] < 0
        cancel = next((r["atMs"] for r in capture["lifecycle"] if r["kind"] == 1
                       and r["epoch"] == epoch and r["revision"] == revision and r["output"] == token), None)
        arm = next((r for r in capture["lifecycle"] if r["kind"] == 0
                    and r["epoch"] == epoch and r["revision"] == revision and r["output"] == token), {})
        report["trajectoryStats"].append({
            "output": token, "epoch": epoch, "revision": revision, "profile": profile,
            "paintedSamples": len(rows), "scaleChanged": changed_scale,
            "startedBeforeCapture": left_censored,
            "initialVelocity": rows[0].get("initialVelocity"),
            "retargetStrategy": arm.get("retargetStrategy"), "retargetReason": arm.get("retargetReason"),
            "savedVelocity": arm.get("savedVelocity"), "brakeMs": arm.get("brakeMs"),
            "brakeDistance": arm.get("brakeDistance"),
            "firstPhysicalStepFromArmAnchorPx": abs(rows[0]["x"] - origin) * rows[0]["scale"]
                if not left_censored and arm.get("retargetStrategy") != 4 else None,
            "maxPhysicalStepPx": max(steps, default=None),
            "maxLogicalSpeedPxPerSec": max(abs(r["v"]) for r in rows),
            "firstVisiblePaintResponseMs": first_visible["paintMs"] - first_visible["eventMs"] if first_visible and not left_censored else None,
            "sampledT95Ms": t95 if not left_censored else None,
            "sampledDualVisualThresholdMs": visual if not left_censored else None,
            "sampledNumericalCompletionMs": completed["sampleMs"] - completed["startMs"] if completed else None,
            "ownershipAtCompletion": completed["ownershipActive"] if completed else None,
            "cancelRequestAtCaptureMs": cancel, "clockFallbackSamples": sum(bool(r["fallback"]) for r in rows),
        })
    return report


def load_capture(path):
    raw = Path(path).read_text()
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        # gdbus call prints a one-string tuple; no eval or shell execution.
        wrapped = ast.literal_eval(raw.strip())
        if not isinstance(wrapped, tuple) or len(wrapped) != 1 or not isinstance(wrapped[0], str):
            raise ValueError("expected JSON or gdbus one-string output")
        result = json.loads(wrapped[0])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(analyze(load_capture(args.capture)), indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Invalid capture: {error}\n")


if __name__ == "__main__":
    main()
