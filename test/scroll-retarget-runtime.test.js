"use strict";
const assert=require("node:assert/strict");
const {createRuntime}=require("./helpers/workspace-runtime");
const next=r=>r.shortcuts.get("CCScrollFocusNextColumn")();
const complete=(r,p)=>{p.timer.timer.timeout.emit();r.scrollStatusAcks.at(-1)(JSON.stringify({...p.context,epoch:p.epoch,active:true,completed:true}));};
let r=createRuntime();next(r);next(r);
const first=r.evaluate("deferredScrollParking.pending");first.timer.timer.timeout.emit();const oldReply=r.scrollStatusAcks.at(-1);
const outgoingFrame={...r.a[0].frameGeometry};
next(r);next(r); // rapid L/L/L: offsets 1, 2, 3 column steps
const latest=r.evaluate("deferredScrollParking.pending");
assert.equal(r.state.focusedColumnIndex,4);assert.equal(latest.items.length,3);
assert.equal(r.nativeCancels.length,0,"successive native requests never cancel the last painted sample");
assert.deepEqual({...r.a[0].frameGeometry},outgoingFrame,"first outgoing is never prematurely parked");
for (const w of r.a.slice(0,3)) {assert.equal(w.opacity,1);assert.equal(w.minimized,false);}
oldReply(JSON.stringify({...first.context,epoch:first.epoch,active:true,completed:true}));assert.equal(r.evaluate("deferredScrollParking.pending"),latest);
complete(r,latest);for (const w of r.a.slice(0,3)) {assert.equal(w.opacity,0);assert.equal(w.minimized,true);}
for (const w of r.a.slice(3))assert.equal(w.minimized,false);
assert.ok(!r.logs.some(l=>/FAIL_SAFE|INVARIANT_FAIL/.test(l)));
for (const config of [{HoldScrollAck:true,HoldNativeAck:true},{HoldNativeAck:true}]) {
    r=createRuntime(config);next(r);const original=r.writes();next(r);next(r);next(r);
    assert.equal(r.state.focusedColumnIndex,4,"pending ACK cannot reset logical focus to old active window");
    assert.equal(r.writes(),original,"superseded geometry remains uncommitted");
    assert.equal(r.motionPlans.length,3);
    assert.ok(r.motionPlans.every(p=>p.oldScrollOffsetX===0),"queued targets flatten to last committed offset");
    const newest=r.motionPlans.at(-1);assert.equal(newest.newScrollOffsetX,3*(r.state.columns[0].pixelWidth+r.state.innerGap));
    if(config.HoldScrollAck)r.motionAcks.at(-1)(true);
    r.nativeAcks.at(-1)(true);
    assert.equal(r.workspace.activeWindow,r.a[4]);const committed=r.writes();
    for(const cb of r.motionAcks.slice(0,-1))cb(true);
    for(const cb of r.nativeAcks.slice(0,-1))cb(true);
    assert.equal(r.writes(),committed,"old ACKs never replay superseded geometry");
}
r=createRuntime();next(r);next(r);const pending=r.evaluate("deferredScrollParking.pending");
r.shortcuts.get("CCScrollFocusPreviousColumn")();assert.equal(r.evaluate("deferredScrollParking.pending"),pending,"focus within committed pair does not snap running spring");
assert.equal(r.nativeCancels.length,0);complete(r,pending);
r=createRuntime({HoldNativeAck:true});next(r);next(r);r.nativeAcks.at(-1)(true);
const held=r.evaluate("deferredScrollParking.pending");next(r);
assert.equal(held.paused,true);r.nativeAcks.at(-1)(false);
assert.equal(r.evaluate("deferredScrollParking.pending"),null);assert.equal(r.a[0].minimized,true,"refused retarget retires retained outgoing safely");
console.log("PASS rapid retarget retains outgoing, latest focus and ACK ownership, focus-only motion, fallback");

r=createRuntime({HoldNativeAck:true});next(r);next(r);r.nativeAcks.at(-1)(true);next(r);next(r);
const paused=r.evaluate("deferredScrollParking.pending");const staleNative=r.nativeAcks.at(-1);r.nativeSwitch(1,r.b[0]);const afterSwitch=r.writes();staleNative(true);assert.equal(r.writes(),afterSwitch,"late retarget ACK after J cannot commit old workspace");assert.equal(r.evaluate("deferredScrollParking.pending"),null);assert.equal(paused.paused,true);
r=createRuntime();next(r);next(r);next(r);const beforeClose=r.evaluate("deferredScrollParking.pending");beforeClose.timer.timer.timeout.emit();const staleCompletion=r.scrollStatusAcks.at(-1);r.close(r.a[0]);const afterClose=r.writes();staleCompletion(JSON.stringify({...beforeClose.context,epoch:beforeClose.epoch,active:true,completed:true}));assert.equal(r.writes(),afterClose,"closed retained outgoing cannot be revived by old completion");
console.log("PASS retarget interrupted by workspace switch and outgoing close rejects stale replies");
