#!/usr/bin/env python3
"""Offline workspace capture analysis; output presentation is not a paint join."""
import argparse
import ast
import json
import math
from pathlib import Path


def percentile(values, fraction):
    if not values:
        return None
    values = sorted(values)
    i = (len(values)-1)*fraction
    return values[math.floor(i)]*(1-i%1)+values[math.ceil(i)]*(i%1)


def analyze(capture):
    presentations = []
    for output in capture["outputs"]:
        times = output["presentedMs"]
        intervals = [b-a for a, b in zip(times, times[1:])]
        valid = [v for v in intervals if math.isfinite(v) and v > 0]
        threshold = 1500/output["refreshHz"] if output["refreshHz"] > 0 else None
        presentations.append({
            "output": output["outputName"], "intervalCount": len(valid),
            "p50Ms": percentile(valid, .5), "p95Ms": percentile(valid, .95),
            "p99Ms": percentile(valid, .99), "maxMs": max(valid, default=None),
            "invalidIntervals": len(intervals)-len(valid),
            "longIntervals": sum(v > threshold for v in valid) if threshold else None,
        })
    motion = capture.get("motionCapture", {})
    last_painted = {}
    arms = []
    for row in motion.get("records", []):
        output = row["output"]
        if row["kind"] == 1:
            last_painted[output] = row
        elif row["kind"] == 0:
            arm = {k: row[k] for k in [
                "output", "epoch", "atMs", "startMs", "durationMs", "strategies",
                "reasons", "initialVelocity", "initialAcceleration", "savedVelocity",
                "savedAcceleration", "brakeXMs", "brakeYMs", "brakeDistanceCells",
            ]}
            previous = last_painted.get(output)
            continuity = []
            for i, axis in enumerate(["x", "y"]):
                strategy = row["strategies"][i]
                carried = strategy in ["carry-c2", "carry-c1", "brake-c1"]
                continuity.append({
                    "axis": axis, "strategy": strategy,
                    "positionErrorCells": abs(row["origin"][axis]-previous["point"][axis])
                        if carried and previous else None,
                    "velocityErrorCellsPerSec": abs(row["initialVelocity"][axis]-row["savedVelocity"][axis])
                        if carried else None,
                    "accelerationErrorCellsPerSec2": abs(row["initialAcceleration"][axis]-row["savedAcceleration"][axis])
                        if strategy == "carry-c2" else None,
                })
            arm["continuity"] = continuity
            arms.append(arm)
    return {
        "association": "output-only-no-paint-to-present-join",
        "presentationStats": presentations, "arms": arms,
        "paintedSampleCount": sum(r["kind"] == 1 for r in motion.get("records", [])),
        "motionTruncated": motion.get("truncated"), "motionUnits": motion.get("units"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    args = parser.parse_args()
    try:
        raw = args.capture.read_text()
        try:
            capture = json.loads(raw)
        except json.JSONDecodeError:
            value = ast.literal_eval(raw.strip())
            if not isinstance(value, tuple) or len(value) != 1 or not isinstance(value[0], str):
                raise ValueError("expected JSON or gdbus one-string output")
            capture = json.loads(value[0])
        print(json.dumps(analyze(capture), indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Invalid workspace capture: {error}\n")


if __name__ == "__main__":
    main()
