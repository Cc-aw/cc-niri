"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
function python(program) {
    const result = spawnSync("python3", ["-c", 'import runpy\np6=runpy.run_path("tools/scroll-layout-v2-p6.py")\n'+program], { encoding:"utf8" });
    assert.equal(result.status,0,result.stdout+result.stderr);
}
test("P6 memory analysis refuses uncontrolled/missing PSS, mismatched loads and incomplete B0", () => python(`
import copy
context=dict(load_id="fixed-five-windows",environment_id="same-host-and-two-outputs",controlled=True,phase="steady-idle",dock_enabled=False,cc_niri_components_unloaded=True)
def report(pss,bridge=False):
 rows=[dict(component="KWin",pid=1,smaps_kib=dict(Pss=pss,Private_Dirty=pss//2))]
 if bridge: rows.append(dict(component="Bridge",pid=2,smaps_kib=dict(Pss=1024,Private_Dirty=512)))
 return dict(completed=True,p6_context=context.copy(),samples=[dict(processes=rows)])
b0=report(100000);v2=report(101000,True)
analyze=p6["analyze_memory"]
result=analyze(dict(B0=b0,V2=v2))
assert result["status"]=="MEASURED" and result["resource_budget"].startswith("INCONCLUSIVE")
assert result["comparisons"][0]["idleDeltaMiB"]==2024/1024
for broken in ["pss","control","baseline","load"]:
 b=copy.deepcopy(b0);v=copy.deepcopy(v2)
 if broken=="pss": del v["samples"][0]["processes"][0]["smaps_kib"]["Pss"]
 if broken=="control": v["p6_context"]["controlled"]=False
 if broken=="baseline": b["p6_context"]["cc_niri_components_unloaded"]=False
 if broken=="load": v["p6_context"]["load_id"]="other-load"
 assert analyze(dict(B0=b,V2=v))["status"]=="INCONCLUSIVE"
assert analyze(dict(V2=v2))["status"]=="INCONCLUSIVE"
`));
test("P6 presentation analysis excludes idle gaps and never upgrades truncated/incomplete data to PASS", () => python(`
capture=dict(version=1,active=False,truncated=False,repaintFullRequests=0,repaintScope="fixture",outputs=[dict(token=1,name="DP-1",refreshHz=60)],
 presentations=[dict(output=1,atMs=t) for t in [0,25,50,1000,1016,1050]],paintedFrames=[],lifecycle=[])
for epoch,start in [(1,0),(2,1000)]:
 for t,x in [(start,0),(start+50,100)]:
  capture["paintedFrames"].append(dict(output=1,epoch=epoch,revision=1,profile="smooth60",initialX=0,target=100,x=x,v=0,scale=1.5,refreshHz=60,eventMs=start,startMs=start,sampleMs=t,paintMs=t,fallback=0,numericalCompleted=x==100,ownershipActive=True))
r=p6["analyze_frames"](capture,"DP-1")
assert r["status"]=="MEASURED" and len(r["transitions"])==2
assert r["transitions"][0]["intervalsAtLeast25Ms"]==2
assert r["transitions"][1]["maxMs"]==34
assert all(t["maxMs"]<100 for t in r["transitions"])
capture["paintedFrames"][-1]["numericalCompleted"]=False
assert p6["analyze_frames"](capture,"DP-1")["status"]=="INCONCLUSIVE"
capture["truncated"]=True
assert p6["analyze_frames"](capture,"DP-1")["status"]=="INCONCLUSIVE"
`));
test("P6 preparation freezes matched sources/binaries and verifies backups; rollback defaults to dry run", () => python(`
import os, pathlib, subprocess, tempfile, json
with tempfile.TemporaryDirectory(prefix="cc-niri-p6-tool-test-") as temporary:
 base=pathlib.Path(temporary);root=base/"repo";root.mkdir();home=base/"home";home.mkdir()
 os.environ["HOME"]=str(home)
 for name in ["XDG_CONFIG_HOME","XDG_DATA_HOME","XDG_STATE_HOME"]: os.environ.pop(name,None)
 subprocess.run(["git","init","-q",str(root)],check=True)
 for name in ["cc-niri","tools/scroll-layout-v2-p6.py","package/contents/code/main.js"]:
  target=root/name;target.parent.mkdir(parents=True,exist_ok=True)
  target.write_text(pathlib.Path(name).read_text())
 for key,name in p6["ARTIFACTS"].items():
  target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(key.encode())
 for directory in ["bridge","native-viewport-clip","native-focus-ring"]:
  (root/"build"/directory/"CMakeCache.txt").write_text("CMAKE_BUILD_TYPE:STRING=Release\\nCMAKE_CXX_COMPILER:FILEPATH=/usr/bin/g++\\nCMAKE_INSTALL_PREFIX:PATH="+str(home/".local")+"\\n")
 for key in ["clip","ring"]:
  target=p6["installed_paths"]()[key];target.parent.mkdir(parents=True,exist_ok=True)
  canonical=home/".local/lib/cc-niri"/key/"old"/target.name;canonical.parent.mkdir(parents=True);canonical.write_bytes(b"old-native")
  target.symlink_to(canonical)
 out=base/"prepared";p6["prepare"](root,out,False)
 manifest=out/"manifest.json";assert p6["verify"](manifest,True)["status"]=="PREPARED_NOT_DEPLOYED"
 assert p6["rollback"](manifest)["status"]=="DRY_RUN"
 assert (out.stat().st_mode & 0o777)==0o700
 def rejects(current=True):
  try: p6["verify"](manifest,current,True)
  except ValueError: pass
  else: raise AssertionError("invalid candidate accepted")
 p6["verify"].__globals__["ROOT"]=root
 rejects() # no validation
 m=json.loads(manifest.read_text())
 evidence=dict(status="PASS",source_sha256=m["source_sha256"],artifact_sha256={v["source"]:v["sha256"] for v in m["artifacts"].values()},build_cache_sha256=m["build_cache_sha256"])
 (out/"validation.json").write_text(json.dumps(evidence));m["validation_sha256"]=p6["sha"](out/"validation.json");manifest.write_text(json.dumps(m))
 p6["verify"](manifest,True,True)
 p6["verify"].__globals__["ROOT"]=base/"other";rejects();p6["verify"].__globals__["ROOT"]=root
 cache=root/"build/bridge/CMakeCache.txt";original=cache.read_text();cache.write_text(original+"drift=true")
 rejects();cache.write_text(original)
 (root/"tools/unvalidated.py").write_text("pass");rejects();(root/"tools/unvalidated.py").unlink()
 evidence["artifact_sha256"]={};(out/"validation.json").write_text(json.dumps(evidence));m["validation_sha256"]=p6["sha"](out/"validation.json");manifest.write_text(json.dumps(m));rejects()

 (out/"candidate/artifacts/bridge/cc-niri-bridge").write_bytes(b"tampered")
 try: p6["verify"](manifest)
 except ValueError: pass
 else: raise AssertionError("tampered binary accepted")
`));
