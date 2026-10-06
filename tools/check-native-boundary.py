#!/usr/bin/env python3
"""Reject frozen C++ algorithm symbols in built production executables/plugins."""
import re
import subprocess
import sys
from pathlib import Path


LEGACY = re.compile(
    r"CcNiri::(?:Spring|ViewportMotion|ScrollViewportRuntime|FocusRingContext|"
    r"FocusRingReference|ReferenceScrollPlanSequence)::|"
    r"CcNiri::referenceValidViewportScrollPlan\("
)


def check_artifact(path):
    path = Path(path)
    if not path.is_file():
        raise RuntimeError(f"production artifact missing: {path}")
    symbols = subprocess.run(
        ["nm", "--demangle", "--defined-only", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    if not symbols.strip():
        raise RuntimeError(f"no symbols available to audit: {path}")
    leaked = [line for line in symbols.splitlines() if LEGACY.search(line)]
    if leaked:
        raise RuntimeError(f"test-only C++ policy leaked into {path}:\n" + "\n".join(leaked))
    if "cc_niri_scroll_sequence_plan" not in symbols:
        raise RuntimeError(f"Rust protocol missing from production artifact: {path}")
    print(f"PASS Rust production / no Legacy C++ policy: {path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: check-native-boundary.py PRODUCTION_ARTIFACT [...]")
    try:
        for argument in sys.argv[1:]:
            check_artifact(argument)
    except (RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
