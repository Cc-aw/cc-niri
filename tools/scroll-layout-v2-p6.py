#!/usr/bin/env python3
"""P6 preparation/offline analysis. prepare/verify never change desktop state."""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BUILD_DIRS = {"bridge": "build/bridge", "clip": "build/native-viewport-clip", "ring": "build/native-focus-ring"}
ARTIFACTS = {
    "bridge": "build/bridge/cc-niri-bridge",
    "clip": "build/native-viewport-clip/bin/kwin/effects/plugins/cc-niri-viewport-clip.so",
    "ring": "build/native-focus-ring/bin/kwin/effects/plugins/cc-niri-focus-ring.so",
}


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=10)
        return {"command": args, "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": args, "exit_code": None, "error": str(error)}


def source_files(root):
    names = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=root, text=True).splitlines()
    return sorted(p for p in set(names) if "-evidence/" not in p and "__pycache__/" not in p and
        (p.startswith(("src/", "native/", "bridge/", "cmake/", "package/", "effect/", "tools/", "plasmoid/", "test/")) or
         p in {"install.sh", "uninstall.sh", "cc-niri", "rust-toolchain.toml", "AGENTS.md", "README.md", "doc/README.md", "doc/done/SCROLL_LAYOUT_V2_P6_RUNBOOK.md"}))


def installed_paths():
    home = Path.home(); prefix = home / ".local"
    config = Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config")))
    data = Path(os.environ.get("XDG_DATA_HOME", str(prefix / "share")))
    state = Path(os.environ.get("XDG_STATE_HOME", str(home / ".local/state")))
    return {
        "script": data / "kwin/scripts/cc-niri-maximize", "effect": data / "kwin/effects/cc-niri-maximize-scroll-transition",
        "clip": prefix / "lib64/qt6/plugins/kwin/effects/plugins/cc-niri-viewport-clip.so",
        "ring": prefix / "lib64/qt6/plugins/kwin/effects/plugins/cc-niri-focus-ring.so",
        "bridge": prefix / "libexec/cc-niri-bridge", "control": prefix / "bin/cc-niri",
        "unit": config / "systemd/user/cc-niri-bridge.service", "kwinrc": config / "kwinrc",
        "shortcuts": config / "kglobalshortcutsrc", "snapshot": state / "cc-niri/workspaces.json",
    }


def prepare(root, output, observe_live=False, validation=None):
    if output.exists(): raise ValueError("output must be a new private directory")
    output.mkdir(parents=True, mode=0o700); output.chmod(0o700)
    candidate = output / "candidate"; candidate.mkdir()
    sources = source_files(root)
    for name in sources:
        source = root / name
        if not source.is_file(): raise ValueError("missing source: " + name)
        target = candidate / "source" / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target)
    artifacts = {}
    for key, name in ARTIFACTS.items():
        source = root / name; target = candidate / "artifacts" / key / source.name
        target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target)
        artifacts[key] = {"source": name, "file": str(target.relative_to(output)), "sha256": sha(target)}
    caches = {}
    for key, directory in BUILD_DIRS.items():
        name = directory + "/CMakeCache.txt"
        target = candidate / "source" / name; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, target); caches[name] = sha(target)
    home = Path.home(); prefix = home / ".local"
    config = Path(os.environ.get("XDG_CONFIG_HOME", str(home / ".config")))
    data = Path(os.environ.get("XDG_DATA_HOME", str(prefix / "share")))
    state = Path(os.environ.get("XDG_STATE_HOME", str(home / ".local/state")))
    targets = installed_paths()
    backups = {}
    for key, source in targets.items():
        entry = {"destination": str(source), "present": source.exists(), "kind": "directory" if source.is_dir() else "file"}
        if source.exists():
            target = output / "backup" / key; target.parent.mkdir(exist_ok=True)
            if source.is_dir(): shutil.copytree(source, target)
            else: shutil.copy2(source, target)
            entry["file"] = str(target.relative_to(output))
            entry["hashes"] = {str(p.relative_to(target)): sha(p) for p in sorted(target.rglob("*")) if p.is_file()} if target.is_dir() else {"": sha(target)}
            if key in {"clip", "ring"}:
                entry["canonical"] = str(source.resolve())
                entry["immutable_rollback"] = source.is_symlink() and source.resolve().is_relative_to(prefix / "lib/cc-niri")
        backups[key] = entry
    observations = {"system": command(["uname", "-srmo"]), "memory": Path("/proc/meminfo").read_text(),
                    "session_type": os.environ.get("XDG_SESSION_TYPE"), "live_observed": observe_live}
    if observe_live:
        observations["outputs"] = command(["kscreen-doctor", "-j"])
        for name, path, interface, method, service in [
            ("support", "/KWin", "org.kde.KWin", "supportInformation", "org.kde.KWin"),
            ("motion", "/ccNiriViewportMotion", "org.cc.NiriViewportMotion1", "GetScrollMotionStatus", "org.kde.KWin"),
            ("ring", "/ccNiriFocusRing", "org.cc.NiriFocusRing1", "GetFocusRingStatus", "org.kde.KWin"),
            ("recovery", "/CCNiriBridge", "org.cc.CCNiriBridge1", "GetRecoveryStatus", "org.cc.CCNiriBridge"),
        ]:
            observations[name] = command(["gdbus", "call", "--session", "--timeout", "3", "--dest", service,
                                           "--object-path", path, "--method", interface + "." + method])
    write_json(output / "environment.json", observations)
    shutil.copy2(root / "tools/scroll-layout-v2-p6.py", output / "rollback.py")
    shutil.copy2(root / "cc-niri", output / "restore-control")
    (output / "restore-control").chmod(0o700)
    (output / "rollback.sh").write_text('#!/bin/sh\nset -eu\ndir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec python3 "$dir/rollback.py" rollback "$dir/manifest.json" "$@"\n')
    (output / "rollback.sh").chmod(0o700)
    manifest = {"schema": 1, "created_utc": datetime.now(timezone.utc).isoformat(), "repository": str(root),
        "home": str(home), "prefix": str(prefix), "config_home": str(config), "data_home": str(data), "state_home": str(state),
        "status": "PREPARED_NOT_DEPLOYED", "live_acceptance": "PENDING", "resource_budget": "NOT MEASURED",
        "source_sha256": {p: sha(root / p) for p in sources}, "build_cache_sha256": caches, "artifacts": artifacts, "backups": backups,
        "restore_control_sha256": sha(output / "restore-control"), "rollback_driver_sha256": sha(output / "rollback.py"),
        "build_types": {key: next((line.split("=", 1)[1] for line in (root / directory / "CMakeCache.txt").read_text().splitlines()
            if line.startswith("CMAKE_BUILD_TYPE:")), None) for key, directory in
            BUILD_DIRS.items()}}
    manifest["rollback_ready"] = all(backups[k].get("immutable_rollback", False) for k in ["clip", "ring"])
    if validation:
        shutil.copy2(validation, output / "validation.json")
        manifest["validation_sha256"] = sha(output / "validation.json")
    write_json(output / "manifest.json", manifest)
    return {"status": manifest["status"], "manifest": str(output / "manifest.json"), "source_files": len(sources), "rollback_ready": manifest["rollback_ready"]}


def verify(path, current=False, require_validated=False):
    manifest = json.loads(path.read_text()); base = path.parent
    repository = Path(manifest["repository"]).resolve()
    if require_validated and repository != ROOT.resolve(): raise ValueError("candidate belongs to another repository")
    if current and source_files(repository) != sorted(manifest["source_sha256"]):
        raise ValueError("repository source set changed")
    for name, digest in manifest.get("build_cache_sha256", {}).items():
        if sha(base / "candidate/source" / name) != digest: raise ValueError("candidate build cache changed")
        if current and sha(repository / name) != digest: raise ValueError("current build cache changed")
    for name, digest in manifest["source_sha256"].items():
        if sha(base / "candidate/source" / name) != digest: raise ValueError("candidate source changed: " + name)
        if current and sha(Path(manifest["repository"]) / name) != digest: raise ValueError("repository source changed: " + name)
    for value in manifest["artifacts"].values():
        if sha(base / value["file"]) != value["sha256"]: raise ValueError("candidate binary changed")
        if current and sha(Path(manifest["repository"]) / value["source"]) != value["sha256"]: raise ValueError("build binary changed")
    for entry in manifest["backups"].values():
        for name, digest in entry.get("hashes", {}).items():
            if sha(base / entry["file"] / name if name else base / entry["file"]) != digest: raise ValueError("backup changed")
    for filename, key in [("restore-control", "restore_control_sha256"), ("rollback.py", "rollback_driver_sha256")]:
        if sha(base / filename) != manifest[key]: raise ValueError("rollback driver changed")
    if require_validated:
        if manifest.get("home") != str(Path.home()) or manifest.get("prefix") != str(Path.home() / ".local"):
            raise ValueError("candidate belongs to another home/prefix")
        if not manifest.get("rollback_ready"): raise ValueError("immutable rollback is not ready")
        if {k: v["destination"] for k,v in manifest["backups"].items()} != {k: str(v) for k,v in installed_paths().items()}:
            raise ValueError("candidate installation paths differ from this environment")
        for key,directory in BUILD_DIRS.items():
            cache = base / "candidate/source" / directory / "CMakeCache.txt"
            settings = {line.split("=",1)[0].split(":",1)[0]: line.split("=",1)[1] for line in cache.read_text().splitlines() if "=" in line and not line.startswith(("//", "#"))}
            if settings.get("CMAKE_INSTALL_PREFIX") != manifest["prefix"] or settings.get("CMAKE_CXX_COMPILER") != "/usr/bin/g++":
                raise ValueError("candidate compiler/install prefix mismatch")
        validation = base / "validation.json"
        if not manifest.get("validation_sha256") or sha(validation) != manifest["validation_sha256"]:
            raise ValueError("candidate has no verified validation record")
        evidence = json.loads(validation.read_text())
        if evidence.get("status") != "PASS" or evidence.get("source_sha256") != manifest["source_sha256"]:
            raise ValueError("candidate sources differ from validated sources")
        if any(evidence.get("artifact_sha256", {}).get(row["source"]) != row["sha256"] for row in manifest["artifacts"].values()):
            raise ValueError("candidate binaries differ from validated binaries")
        if not manifest.get("build_cache_sha256") or evidence.get("build_cache_sha256") != manifest["build_cache_sha256"]:
            raise ValueError("build configuration differs from validation")
        if any(value not in {"Release", "RelWithDebInfo", "MinSizeRel"} for value in manifest["build_types"].values()):
            raise ValueError("candidate contains a non-production build")
    return manifest


def atomic_copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".cc-niri-restore-", dir=target.parent); os.close(fd)
    try: shutil.copy2(source, name); os.replace(name, target)
    finally: Path(name).unlink(missing_ok=True)


def rollback(path, execute=False):
    manifest = verify(path); base = path.parent
    if not manifest["rollback_ready"]: raise ValueError("immutable Native rollback was not prepared")
    home = Path.home()
    if str(home) != manifest["home"]: raise ValueError("rollback belongs to another home")
    for key in ["clip", "ring"]:
        entry = manifest["backups"][key]
        canonical = Path(entry["canonical"])
        if not canonical.is_relative_to(Path(manifest["prefix"]) / "lib/cc-niri") or sha(canonical) != entry["hashes"][""]:
            raise ValueError("retained immutable Native version missing or changed")
    # Only the fixed installed component/config paths captured by prepare may
    # be restored. No shell evaluation of manifest data.
    expected = installed_paths()
    if set(manifest["backups"]) != set(expected): raise ValueError("unexpected backup components")
    for key, entry in manifest["backups"].items():
        if Path(entry["destination"]) != expected[key]: raise ValueError("unsafe restore destination")
    if not execute: return {"status": "DRY_RUN", "writes": False, "sequence": ["verified safe stop", "immutable native links", "Bridge/control/packages", "configuration/snapshot", "start previous version"]}
    subprocess.run([str(base / "restore-control"), "stop"], check=True)
    for key in ["clip", "ring"]:
        entry = manifest["backups"][key]; target = Path(entry["destination"])
        temporary = target.with_name(target.name + ".p6-restore-link")
        if temporary.exists() or temporary.is_symlink(): raise ValueError("restore link already exists")
        try: temporary.symlink_to(entry["canonical"]); os.replace(temporary, target)
        finally: temporary.unlink(missing_ok=True)
    for key in ["bridge", "control", "unit", "kwinrc", "shortcuts", "snapshot"]:
        entry = manifest["backups"][key]; target = Path(entry["destination"])
        if entry["present"]: atomic_copy(base / entry["file"], target)
        else: target.unlink(missing_ok=True)
    for key, kind, plugin in [("script", "KWin/Script", "cc-niri-maximize"), ("effect", "KWin/Effect", "cc-niri-maximize-scroll-transition")]:
        entry = manifest["backups"][key]
        args = ["--upgrade", str(base / entry["file"])] if entry["present"] else ["--remove", plugin]
        subprocess.run(["kpackagetool6", "--type=" + kind, *args], check=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run([str(base / "restore-control"), "start"], check=True)
    return {"status": "ROLLED_BACK", "snapshot": "pre-trial configuration/layout restored"}


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path); value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


def capture_once(output, kind):
    if output.exists(): raise ValueError("capture output already exists")
    duration = 3.2 if kind == "workspace" else 10.2
    family = "Workspace" if kind == "workspace" else "Scroll"
    def invoke(method):
        result = subprocess.check_output(["gdbus", "call", "--session", "--timeout", "3", "--dest", "org.kde.KWin",
            "--object-path", "/ccNiriViewportMotion", "--method", "org.cc.NiriViewportMotion1." + method], text=True)
        return ast.literal_eval(result.strip())
    invoke("Start" + family + "FrameCapture")
    print(f"Bounded {kind} capture started; perform the fixed input sequence for {duration-.2:g}s.", file=sys.stderr)
    time.sleep(duration)
    raw = invoke("Get" + family + "FrameCapture")
    value = json.loads(raw[0]); write_json(output, value)
    return {"status": "RECORDED", "capture": str(output), "active": value.get("active"), "acceptance": "NOT EVALUATED"}


def analyze_frames(capture, output_name):
    if capture.get("active") or capture.get("truncated"):
        return {"status": "INCONCLUSIVE", "reason": "active-or-truncated-capture"}
    analyzer = module("scroll_capture_analysis", ROOT / "tools/analyze-animation-capture.py")
    summary = analyzer.analyze(capture)
    outputs = {o["token"]: o for o in capture["outputs"]}
    tokens = [token for token, value in outputs.items() if value["name"] == output_name]
    if len(tokens) != 1: return {"status": "INCONCLUSIVE", "reason": "missing-or-ambiguous-output"}
    token = tokens[0]; frames = [r for r in capture["paintedFrames"] if r["output"] == token]
    groups = []
    for row in frames:
        if not groups or groups[-1][0]["epoch"] != row["epoch"]: groups.append([])
        groups[-1].append(row)
    presented = [r["atMs"] for r in capture["presentations"] if r["output"] == token]
    transitions = []
    for rows in groups:
        end = next((r for r in rows if r["numericalCompleted"]), None)
        start = rows[0]["eventMs"]
        reasons = []
        if start < 0: reasons.append("started-before-capture")
        if end is None: reasons.append("completion-not-observed")
        hz = outputs[token]["refreshHz"]
        if not math.isfinite(hz) or hz <= 0: reasons.append("invalid-refresh")
        times = [t for t in presented if start <= t <= end["paintMs"]] if end else []
        intervals = [b-a for a,b in zip(times,times[1:])]
        if len(times) < 2 or any(not math.isfinite(v) or v <= 0 for v in intervals): reasons.append("missing-or-invalid-presentations")
        transitions.append({"epoch": rows[0]["epoch"], "status": "INCONCLUSIVE" if reasons else "MEASURED",
            "limitations": reasons, "intervalsMs": intervals, "p50Ms": analyzer.percentile(intervals,.5),
            "p95Ms": analyzer.percentile(intervals,.95), "p99Ms": analyzer.percentile(intervals,.99),
            "maxMs": max(intervals,default=None), "intervalsAtLeast25Ms": sum(v >= 25 for v in intervals),
            "intervals33To50Ms": sum(33 <= v <= 50 for v in intervals)})
    return {"status": "MEASURED" if transitions and all(t["status"] == "MEASURED" for t in transitions) else "INCONCLUSIVE",
        "association": "output-only-no-paint-to-present-join", "output": output_name,
        "limitations": ["numerical camera completion is not client paint completion; H/L captures must not contain workspace switches; no automatic 4K60 PASS"],
        "transitions": transitions, "rawSummary": summary}


def analyze_memory(reports):
    # Require explicit same-load metadata; process RSS is never substituted for PSS.
    result = {"status": "INCONCLUSIVE", "resource_budget": "NOT MEASURED", "comparisons": [],
              "limitations": ["GPU/objects/textures require separate evidence; observed samples are not instantaneous peaks"]}
    valid = {}
    for name, value in reports.items():
        context = value.get("p6_context", {})
        if not value.get("completed") or not context.get("load_id") or not context.get("environment_id") or not context.get("controlled") or context.get("phase") != "steady-idle":
            result["limitations"].append(name + ": incomplete or uncontrolled context"); continue
        totals = []
        for sample in value.get("samples", []):
            processes = sample["processes"]
            kwin = [p for p in processes if p["component"] == "KWin" and "pid" in p]
            bridge = [p for p in processes if p["component"] == "Bridge" and "pid" in p]
            if len(kwin) != 1 or (name != "B0" and len(bridge) != 1) or (name == "B0" and bridge): break
            rows = kwin + bridge
            if any("Pss" not in p.get("smaps_kib", {}) or "Private_Dirty" not in p.get("smaps_kib", {}) for p in rows): break
            totals.append({"pssKiB": sum(p["smaps_kib"]["Pss"] for p in rows),
                           "privateDirtyKiB": sum(p["smaps_kib"]["Private_Dirty"] for p in rows)})
        else:
            if totals: valid[name] = (context, totals)
    if "B0" not in valid: return result
    context, baseline = valid["B0"]
    if context.get("cc_niri_components_unloaded") is not True:
        result["limitations"].append("B0 does not prove JS/Clip/Ring/Bridge are unloaded"); return result
    for name in ["V1", "V2"]:
        if name not in valid: continue
        other, values = valid[name]
        if any(context.get(k) != other.get(k) for k in ["load_id", "environment_id"]) or context.get("dock_enabled") is not False or other.get("dock_enabled") is not False:
            result["limitations"].append(name + ": mismatched load/environment or Dock enabled"); continue
        pss = statistics.median(v["pssKiB"] for v in values) - statistics.median(v["pssKiB"] for v in baseline)
        dirty = statistics.median(v["privateDirtyKiB"] for v in values) - statistics.median(v["privateDirtyKiB"] for v in baseline)
        result["comparisons"].append({"mode": name, "idleDeltaMiB": pss/1024, "privateDirtyDeltaMiB": dirty/1024,
            "idleTargetMiB": 32, "idleTargetStatus": "WITHIN_TARGET" if pss <= 32768 else "EXCEEDS_TARGET"})
    if result["comparisons"]: result["status"] = "MEASURED"; result["resource_budget"] = "INCONCLUSIVE: peak, attribution and long-run evidence still required"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--output", type=Path, required=True); p.add_argument("--observe-live", action="store_true"); p.add_argument("--validation", type=Path)
    p = sub.add_parser("verify"); p.add_argument("manifest", type=Path); p.add_argument("--current", action="store_true"); p.add_argument("--require-validated", action="store_true")
    p = sub.add_parser("rollback"); p.add_argument("manifest", type=Path); p.add_argument("--execute", action="store_true")
    p = sub.add_parser("frames"); p.add_argument("capture", type=Path); p.add_argument("--output-name", required=True)
    p = sub.add_parser("capture"); p.add_argument("--kind", choices=["scroll", "workspace"], required=True); p.add_argument("--output", type=Path, required=True)
    p = sub.add_parser("memory"); p.add_argument("--baseline", type=Path, required=True); p.add_argument("--v1", type=Path); p.add_argument("--v2", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "prepare": result = prepare(ROOT, args.output.resolve(), args.observe_live, args.validation)
        elif args.action == "verify":
            verify(args.manifest.resolve(), args.current, args.require_validated); result = {"status": "PASS", "scope": "candidate/backup integrity", "deployed": False}
        elif args.action == "rollback": result = rollback(args.manifest.resolve(), args.execute)
        elif args.action == "capture": result = capture_once(args.output, args.kind)
        elif args.action == "frames":
            analyzer = module("scroll_capture_loader", ROOT / "tools/analyze-animation-capture.py"); result = analyze_frames(analyzer.load_capture(args.capture), args.output_name)
        else:
            reports = {name: json.loads(path.read_text()) for name,path in [("B0",args.baseline),("V1",args.v1),("V2",args.v2)] if path}
            result = analyze_memory(reports)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        parser.exit(1, f"P6 aborted: {error}\n")


if __name__ == "__main__": main()
