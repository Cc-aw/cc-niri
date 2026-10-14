#!/usr/bin/env python3
"""Finite, read-only process PSS sampling; never controls the desktop.

This records whole-process observations, not CC-Niri attributable deltas.
Run the same command separately for controlled B0/B1 scenarios.
"""
import argparse
import datetime
import json
import math
import os
from pathlib import Path
import subprocess
import time


def fields(path, wanted):
    result = {}
    for line in path.read_text().splitlines():
        parts = line.split()
        key = parts[0].rstrip(":") if parts else ""
        if key in wanted:
            result[key] = int(parts[1])
    return result


def processes(previous, now):
    targets = {"kwin_wayland": "KWin", "cc-niri-bridge": "Bridge", "plasmashell": "Plasma"}
    rows = []
    seen = set()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            if entry.stat().st_uid != os.getuid():
                continue
            name = entry.joinpath("comm").read_text().strip()
            if name not in targets:
                continue
            pid = int(entry.name)
            stat = entry.joinpath("stat").read_text().rsplit(")", 1)[1].split()
            ticks, start = int(stat[11]) + int(stat[12]), int(stat[19])
            identity = (pid, start)
            row = {"component": targets[name], "pid": pid, "start_ticks": start}
            before = previous.get(identity)
            row["cpu_percent_one_core"] = (
                100 * (ticks - before[0]) / os.sysconf("SC_CLK_TCK") / (now - before[1])
                if before and now > before[1] else None
            )
            previous[identity] = (ticks, now)
            row["status_kib"] = fields(entry / "status", {"VmRSS", "VmSwap"})
            try:
                row["smaps_kib"] = fields(entry / "smaps_rollup", {
                    "Rss", "Pss", "Private_Clean", "Private_Dirty", "Swap", "SwapPss"
                })
                row["pss_status"] = "AVAILABLE" if "Pss" in row["smaps_kib"] else "UNAVAILABLE"
            except OSError as error:
                row["pss_status"] = "UNAVAILABLE"
                row["pss_error"] = str(error)
            rows.append(row)
            seen.add(name)
        except (OSError, ValueError, IndexError):
            continue  # A process may exit between discovery and reading.
    for name, label in targets.items():
        if name not in seen:
            rows.append({"component": label, "pss_status": "PROCESS_NOT_VISIBLE"})
    live = {(row["pid"], row["start_ticks"]) for row in rows if "pid" in row}
    for identity in list(previous):
        if identity not in live:
            del previous[identity]
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=float, default=300, help="seconds; 0 for one observation")
    parser.add_argument("--interval", type=float, default=10, help="seconds, minimum 10")
    parser.add_argument("--scenario", default="uncontrolled-live-observation")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not math.isfinite(args.duration) or not math.isfinite(args.interval) or args.duration < 0 or args.interval < 10:
        parser.error("duration must be nonnegative and interval at least 10 seconds")
    commit = subprocess.run(["git", "rev-parse", "HEAD"], text=True, capture_output=True)
    report = {"schema": 1, "units": "KiB", "scenario": args.scenario,
              "commit": commit.stdout.strip() if commit.returncode == 0 else None,
              "attribution": "Whole-process data; B0/B1 differences not calculated.",
              "requested_duration_s": args.duration, "interval_s": args.interval,
              "completed": False, "samples": []}
    previous = {}
    start = time.monotonic()

    def save():
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

    try:
        while True:
            now = time.monotonic()
            report["samples"].append({
                "utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "elapsed_s": now - start,
                "system_kib": fields(Path("/proc/meminfo"), {
                    "MemTotal", "MemAvailable", "SwapTotal", "SwapFree"
                }),
                "processes": processes(previous, now),
            })
            save()
            remaining = args.duration - (time.monotonic() - start)
            if remaining <= 0:
                report["completed"] = True
                break
            time.sleep(min(args.interval, remaining))
    except KeyboardInterrupt:
        report["interrupted"] = True
    finally:
        report["actual_duration_s"] = time.monotonic() - start
        save()
    print(f"Recorded {len(report['samples'])} samples to {args.output}")


if __name__ == "__main__":
    main()
