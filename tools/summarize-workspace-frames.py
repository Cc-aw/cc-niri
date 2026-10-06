#!/usr/bin/env python3
"""Summarize opt-in KWin presentation telemetry; never change desktop state."""
import argparse
import json
import math
from pathlib import Path


def summarize(capture):
    events = capture["desktopChanges"]
    start = min((event["atMs"] for event in events), default=None)
    end = capture["transitionEndMs"]
    result = {"source": capture["source"], "desktopChanges": events,
              "complete": start is not None and end is not None and
              not capture["desktopEventsTruncated"], "outputs": []}
    for output in capture["outputs"]:
        budget = 1000 / output["refreshHz"] if output["refreshHz"] > 0 else None
        # Include the final frame submitted when Slide relinquishes fullscreen
        # ownership. Presentation happens after the pre/post paint callbacks.
        frames = [timestamp for timestamp in output["presentedMs"]
                  if start is not None and end is not None and budget is not None
                  and start <= timestamp <= end + budget]
        gaps = [b - a for a, b in zip(frames, frames[1:]) if b > a]
        ordered = sorted(gaps)
        result["outputs"].append({
            "outputName": output["outputName"], "refreshHz": output["refreshHz"],
            "presentedFrames": len(frames), "truncated": output["truncated"],
            "transitionMs": end - start if result["complete"] else None,
            "firstPresentationMs": frames[0] - start if frames else None,
            "meanPresentedFps": 1000 * len(gaps) / sum(gaps) if gaps else None,
            "p95IntervalMs": ordered[math.ceil(len(ordered) * .95) - 1] if gaps else None,
            "maxIntervalMs": max(gaps) if gaps else None,
            "intervalsOver1_5Refresh": sum(gap > budget * 1.5 for gap in gaps) if budget else None,
        })
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path, help="GetWorkspaceFrameCapture JSON file")
    args = parser.parse_args()
    print(json.dumps(summarize(json.loads(args.capture.read_text())), ensure_ascii=False, indent=2))
