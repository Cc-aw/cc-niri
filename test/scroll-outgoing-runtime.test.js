"use strict";
const assert = require("node:assert/strict");
const { createRuntime } = require("./helpers/workspace-runtime");
function prepare(config={}) {
    const r=createRuntime(config);
    r.shortcuts.get("CCScrollFocusNextColumn")(); // focus second, no scroll
    const old={...r.a[0].frameGeometry};
    r.shortcuts.get("CCScrollFocusNextColumn")(); // A | B -> B | C
    return {r,old};
}
let {r,old}=prepare();
assert.equal(r.motionPlans.at(-1).type,"SCROLL");
assert.deepEqual({...r.a[0].frameGeometry},old,"outgoing keeps its real old frame");
assert.equal(r.a[0].minimized,false);assert.equal(r.a[0].opacity,1);
const pending=r.evaluate("deferredScrollParking.pending");
assert.equal(pending.items.length,1);
pending.timer.timer.timeout.emit();
assert.equal(r.scrollStatusAcks.length,1);
r.scrollStatusAcks[0](JSON.stringify({...pending.context,epoch:pending.epoch,completed:true,active:true}));
assert.equal(r.a[0].minimized,true);assert.equal(r.a[0].opacity,0);
assert.notDeepEqual({...r.a[0].frameGeometry},old,"parking commits only on native completion");
assert.equal(r.evaluate("deferredScrollParking.pending"),null);
assert.ok(r.nativeCancels.some(c=>c.epoch===pending.epoch));
({r,old}=prepare());const interrupted=r.evaluate("deferredScrollParking.pending");
interrupted.timer.timer.timeout.emit();const late=r.scrollStatusAcks[0];
r.nativeSwitch(1,r.b[0]);const writes=r.writes();
late(JSON.stringify({...interrupted.context,epoch:interrupted.epoch,completed:true,active:true}));
assert.equal(r.writes(),writes,"late completion after J cannot change another workspace");
r.nativeSwitch(0,r.a[2]);assert.ok(!r.logs.some(l=>/INVARIANT_FAIL|FAIL_SAFE/.test(l)));
({r,old}=prepare());const closed=r.evaluate("deferredScrollParking.pending");
closed.timer.timer.timeout.emit();r.evaluate("globalThis.closedOutgoingWindow = mainScreenState.columns.find(c => c.window.internalId === 'a0').window");r.close(r.a[0]);const closeWrites=r.writes();
r.scrollStatusAcks[0](JSON.stringify({...closed.context,epoch:closed.epoch,completed:true,active:true}));assert.equal(r.writes(),closeWrites,"closed outgoing not revived by completion");
assert.equal(r.evaluate("states.has(closedOutgoingWindow)"),false,"completion cannot recreate a closed window state");
({r}=prepare({HoldNativeAck:true}));r.nativeAcks.at(-1)(false);
assert.equal(r.a[0].minimized,true,"native refusal uses immediate legacy parking");
assert.equal(r.evaluate("deferredScrollParking.pending"),null);
({r}=prepare());const previous=r.evaluate("deferredScrollParking.pending");
previous.timer.timer.timeout.emit();const oldReply=r.scrollStatusAcks[0];
r.shortcuts.get("CCScrollFocusNextColumn")();const newer=r.evaluate("deferredScrollParking.pending");
assert.ok(newer.epoch>previous.epoch);assert.ok(!r.nativeCancels.some(c=>c.epoch===previous.epoch),"new SCROLL retarget retains native sample");
oldReply(JSON.stringify({...previous.context,epoch:previous.epoch,completed:true,active:true}));assert.equal(r.evaluate("deferredScrollParking.pending"),newer);
console.log("PASS real outgoing frame, completion parking, workspace and close barriers, legacy fallback");
