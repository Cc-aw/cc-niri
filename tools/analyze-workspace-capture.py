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


def interval_stats(times, refresh_hz):
    intervals = [b-a for a, b in zip(times, times[1:])]
    valid = [v for v in intervals if math.isfinite(v) and v > 0]
    return {
        "intervalCount": len(valid), "intervalsMs": valid,
        "invalidIntervals": len(intervals)-len(valid),
        "p50Ms": percentile(valid, .5), "p95Ms": percentile(valid, .95),
        "p99Ms": percentile(valid, .99), "maxMs": max(valid, default=None),
        "meanPresentedFps": 1000*len(valid)/sum(valid) if valid else None,
        "intervalsOver25Ms": sum(v > 25 for v in valid),
        "intervalsOver1_5Refresh": sum(v > 1500/refresh_hz for v in valid),
    }


def analyze_transitions(capture):
    """Bound each output's transitions by desktop events and Native finish.

    Retargets without a finish belong to one continuous transition. Separate
    transitions never contribute their idle gap to pooled frame intervals.
    First-presentation latency and paint latency are different observations;
    this does not join rendered content to a presentation timestamp.
    """
    motion = capture.get("motionCapture", {})
    tokens = {o["name"]: o["token"] for o in motion.get("outputs", [])}
    outputs = []
    for output in capture["outputs"]:
        name, hz = output["outputName"], output["refreshHz"]
        events = [e for e in capture["desktopChanges"] if e.get("outputName") == name]
        records = [r for r in motion.get("records", []) if
                   name in tokens and r["output"] == tokens[name]]
        finishes = [r for r in records if r["kind"] == 2]
        pending = list(events)
        transitions, pooled = [], []
        previous_finish = -math.inf
        for finish in finishes:
            changes = [e for e in pending if previous_finish < e["atMs"] <= finish["atMs"]]
            previous_finish = finish["atMs"]
            if not changes:
                continue
            pending = [e for e in pending if e not in changes]
            start, end = changes[0]["atMs"], finish["atMs"]
            valid_refresh = math.isfinite(hz) and hz > 0
            reasons = []
            if capture.get("desktopEventsTruncated", False): reasons.append("desktop-events-truncated")
            if motion.get("truncated", False): reasons.append("motion-truncated")
            if output.get("truncated", False): reasons.append("presentation-truncated")
            if any(not math.isfinite(t) for t in output["presentedMs"]):
                reasons.append("invalid-presentation-timestamp")
            if not valid_refresh: reasons.append("invalid-refresh")
            # End includes at most one refresh of the final submitted frame.
            # When another transition begins sooner, keep its samples separate.
            later = [e["atMs"] for e in pending if e["atMs"] > end]
            boundary = min(end+1000/hz, min(later, default=math.inf)) if valid_refresh else end
            times = [t for t in output["presentedMs"] if math.isfinite(t) and
                     start <= t <= boundary and (not later or t < min(later))]
            stats = interval_stats(times, hz) if valid_refresh else None
            if stats and stats["invalidIntervals"]: reasons.append("invalid-presentation-interval")
            paints = [r for r in records if r["kind"] == 1 and start <= r["atMs"] <= end]
            long_gaps = [{"fromMs": a, "toMs": b, "intervalMs": b-a,
                          "sinceDesktopChangeMs": a-start, "presentationIntervalIndex": i}
                         for i, (a, b) in enumerate(zip(times, times[1:])) if b-a > 25]
            row = {
                "startMs": start, "finishMs": end, "endBoundaryMs": boundary,
                "durationMs": end-start, "desktopChangeCount": len(changes),
                "complete": True, "validForComparison": not reasons,
                "limitations": reasons, "presentationStats": stats,
                "firstPresentationLatencyMs": times[0]-start if times else None,
                "firstPaintCallbackLatencyMs": paints[0]["atMs"]-start if paints else None,
                "longPresentationIntervals": long_gaps,
            }
            if not times:
                row["validForComparison"] = False
                row["limitations"].append("no-presentation-samples")
            if row["validForComparison"]:
                pooled.extend(stats["intervalsMs"])
            transitions.append(row)
        if pending:
            transitions.append({"startMs": pending[0]["atMs"], "finishMs": None,
                                "complete": False, "validForComparison": False,
                                "desktopChangeCount": len(pending),
                                "limitations": ["native-finish-not-observed"],
                                "presentationStats": None})
        aggregate = {
            "intervalCount": len(pooled), "p50Ms": percentile(pooled, .5),
            "p95Ms": percentile(pooled, .95), "p99Ms": percentile(pooled, .99),
            "maxMs": max(pooled, default=None),
            "intervalsOver25Ms": sum(v > 25 for v in pooled),
            "meanPresentedFps": 1000*len(pooled)/sum(pooled) if pooled else None,
            "validTransitionCount": sum(t["validForComparison"] for t in transitions),
            "excludedTransitionCount": sum(not t["validForComparison"] for t in transitions),
        }
        outputs.append({"output": name, "refreshHz": hz,
                        "transitions": transitions, "aggregate": aggregate})
    return {
        "association": "output-only-no-paint-to-present-join",
        "boundary": "desktopChanged-to-native-finish-plus-one-refresh",
        "percentileMethod": "linear-interpolation-of-observed-intervals",
        "source": capture.get("source"), "outputs": outputs,
    }


def load_capture(raw):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        value = ast.literal_eval(raw.strip())
        if not isinstance(value, tuple) or len(value) != 1 or not isinstance(value[0], str):
            raise ValueError("expected JSON or gdbus one-string output")
        return json.loads(value[0])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("--transitions", action="store_true",
                        help="use per-output desktop/Native finish bounds; exclude idle gaps")
    args = parser.parse_args()
    try:
        capture = load_capture(args.capture.read_text())
        result = analyze_transitions(capture) if args.transitions else analyze(capture)
        print(json.dumps(result, indent=2, allow_nan=False))
    except (ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Invalid workspace capture: {error}\n")


if __name__ == "__main__":
    main()
