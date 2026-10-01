#!/usr/bin/env python3
"""Install an immutable native library and atomically switch its discovery link.

Qt may retain a library after unloadEffect. A new canonical path is needed for
new code; never overwrite a previously mapped version of the shared object.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def install_native_clip(build_dir, prefix):
    build_dir = Path(build_dir).resolve()
    prefix = Path(prefix).absolute()
    with tempfile.TemporaryDirectory(prefix="cc-niri-native-install-") as staging:
        environment = dict(os.environ, DESTDIR=staging)
        subprocess.run(["cmake", "--install", str(build_dir)], env=environment, check=True)
        paths = [Path(line) for line in (build_dir / "install_manifest.txt").read_text().splitlines()
                 if Path(line).name == "cc-niri-viewport-clip.so"]
        if len(paths) != 1 or not paths[0].is_absolute() or not paths[0].is_relative_to(prefix):
            raise RuntimeError("native plugin manifest must contain one path inside the install prefix")
        discovery = paths[0]
        staged = Path(staging) / discovery.relative_to("/")
        digest = hashlib.sha256(staged.read_bytes()).hexdigest()
        canonical = prefix / "lib/cc-niri/viewport-clip" / digest / discovery.name
        canonical.parent.mkdir(parents=True, exist_ok=True)
        if canonical.exists():
            if hashlib.sha256(canonical.read_bytes()).hexdigest() != digest:
                raise RuntimeError("immutable native version has unexpected contents")
        else:
            temporary = canonical.parent / (canonical.name + ".new")
            shutil.copy2(staged, temporary)
            temporary.chmod(0o755)
            os.replace(temporary, canonical)
        discovery.parent.mkdir(parents=True, exist_ok=True)
        link = discovery.parent / (discovery.name + ".link-" + str(os.getpid()))
        try:
            link.symlink_to(canonical)
            os.replace(link, discovery)
        finally:
            link.unlink(missing_ok=True)
        print("Native viewport clip canonical version:", canonical)
        return canonical


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: install-native-clip.py BUILD_DIR INSTALL_PREFIX")
    install_native_clip(sys.argv[1], sys.argv[2])
