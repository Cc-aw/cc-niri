"use strict";
const assert=require("node:assert/strict");
const {createRuntime}=require("./helpers/workspace-runtime");
const key=(r,k)=>r.shortcuts.get(k==="L"?"CCScrollFocusNextColumn":"CCScrollFocusPreviousColumn")();
const reply=(p)=>JSON.stringify({...p.context,epoch:p.epoch,active:true,completed:true});
function finish(r,p){p.timer.timer.timeout.emit();r.scrollStatusAcks.at(-1)(reply(p));}
let r=createRuntime();key(r,"L");key(r,"L");
const outward=r.evaluate("deferredScrollParking.pending");outward.timer.timer.timeout.emit();const old=r.scrollStatusAcks.at(-1);
key(r,"H");key(r,"H");const reversed=r.evaluate("deferredScrollParking.pending");
assert.ok(reversed.epoch>outward.epoch);assert.equal(r.state.scrollOffsetX,0);
assert.equal(r.a[0].minimized,false);assert.equal(r.a[0].opacity,1);
assert.equal(r.evaluate("states.get(mainScreenState.columns[0].window).scrollPendingParkEpoch"),null,"re-entering outgoing releases old park ownership");
old(reply(outward));assert.equal(r.a[0].minimized,false,"old completion cannot park re-entering window");
finish(r,reversed);assert.equal(r.a[0].minimized,false);assert.equal(r.a[1].minimized,false);assert.equal(r.a[2].minimized,true);
for(const config of [{HoldNativeAck:true},{HoldNativeAck:true,HoldScrollAck:true}]) {
    r=createRuntime(config);key(r,"L");const initial=r.writes();key(r,"L");key(r,"H");key(r,"H");
    const returning=r.motionPlans.at(-1);
    assert.equal(returning.retargetOnly,true,"return to uncommitted origin is explicit native motion");
    assert.equal(returning.oldScrollOffsetX,0);assert.equal(returning.newScrollOffsetX,0);
    assert.equal(r.nativeCancels.length,0,"return plan must not snap by canceling armed Spring");
    assert.equal(r.writes(),initial);assert.equal(r.state.focusedColumnIndex,0);
    if(config.HoldScrollAck)r.motionAcks.at(-1)(true);
    r.nativeAcks.at(-1)(true);assert.equal(r.workspace.activeWindow,r.a[0]);
    const committed=r.writes();for(const cb of r.motionAcks.slice(0,-1))cb(true);for(const cb of r.nativeAcks.slice(0,-1))cb(true);
    assert.equal(r.writes(),committed,"late outward ACK cannot commit after return");
    finish(r,r.evaluate("deferredScrollParking.pending"));assert.equal(r.a[0].minimized,false);assert.equal(r.a[1].minimized,false);
}
for(const config of [{},{HoldNativeAck:true},{HoldNativeAck:true,HoldScrollAck:true}]) {
    r=createRuntime(config);key(r,"L");
    for(const k of "LLHLHHHL")key(r,k);
    assert.equal(r.state.focusedColumnIndex,1);assert.equal(r.state.scrollOffsetX,0);
    if(config.HoldScrollAck)r.motionAcks.at(-1)(true);
    if(config.HoldNativeAck)r.nativeAcks.at(-1)(true);
    const newest=r.evaluate("deferredScrollParking.pending");const writes=r.writes();
    for(const cb of r.motionAcks.slice(0,-1))cb(true);for(const cb of r.nativeAcks.slice(0,-1))cb(true);
    assert.equal(r.writes(),writes);finish(r,newest);
    assert.equal(r.workspace.activeWindow,r.a[1]);
    assert.deepEqual(r.a.map(w=>w.minimized),[false,false,true,true,true]);
    assert.equal(r.nativeCancels.filter(c=>c.epoch>=newest.epoch).length,1,"only latest completion finalizes the chain");
    assert.ok(!r.logs.some(l=>/FAIL_SAFE|INVARIANT_FAIL/.test(l)));
}
r=createRuntime({HoldNativeAck:true});key(r,"L");key(r,"L");key(r,"H");key(r,"H");
r.nativeSwitch(1,r.b[0]);const switched=r.writes();r.nativeAcks.at(-1)(true);assert.equal(r.writes(),switched);assert.equal(r.state.activeWorkspaceId,"B");
r=createRuntime({HoldNativeAck:true});key(r,"L");key(r,"L");key(r,"H");key(r,"H");r.nativeAcks.at(-1)(false);
assert.equal(r.workspace.activeWindow,r.a[0]);assert.equal(r.evaluate("deferredScrollParking.pending"),null,"refused return is bounded fallback");
console.log("PASS mid-scroll reversal, uncommitted return, mixed keys, stale completion/ACK, workspace and fallback");

r=createRuntime();key(r,"L");key(r,"L");const ended=r.evaluate("deferredScrollParking.pending");finish(r,ended);assert.equal(r.a[0].minimized,true);key(r,"H");key(r,"H");const afterEnd=r.evaluate("deferredScrollParking.pending");assert.equal(r.a[0].minimized,false,"return after earlier completion unhides parked owner");finish(r,afterEnd);assert.deepEqual(r.a.map(w=>w.minimized),[false,false,true,true,true]);
r=createRuntime({HoldNativeAck:true});key(r,"L");key(r,"L");r.nativeAcks.at(-1)(true);key(r,"H");key(r,"H");r.nativeAcks.at(-1)(false);assert.equal(r.workspace.activeWindow,r.a[0]);assert.equal(r.a[0].minimized,false);assert.equal(r.a[0].opacity,1);assert.equal(r.evaluate("deferredScrollParking.pending"),null,"reverse fallback cannot strand earlier pending outgoing");
console.log("PASS completed-motion return and refused reversal restore visibility and focus");
