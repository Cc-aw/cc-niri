"use strict";
const assert = require("node:assert/strict");
const { CCNiriScrollTransition, MotionTransaction, MotionType } = require("../effect/contents/code/main.js");
global.Effect = {Translation: 1, Scale: 2, Opacity: 3, Right: 4, Left: 5};
const owner = {x: 24, y: 50, width: 1252, height: 1320};
const right = {...owner, x: 1284};
const parking = {...owner, x: -99999};
const output = {name: "eDP-1", geometry: {x: 0, y: 0, width: 2560, height: 1440}};
global.effects = {stackingOrder: [{screen: output}]};
const starts = [], cancellations = [];
const effect = Object.create(CCNiriScrollTransition.prototype);
Object.assign(effect, {innerGap: 8, duration: 220, targetOutputName: "eDP-1", wideIsolationHolds: new Map(),
    motionTransaction: new MotionTransaction(80), debug: () => {},
    viewportClip: {shaderFor: () => null}, parkingGrabber: {grab: () => {}, release: () => {}},
    motion: {states: new Map(), cancel: w => cancellations.push(w),
        startTransaction: (_w, tx, role, options) => { starts.push({tx, role, options}); return {}; },
        start: (_w, options) => { starts.push({options}); return {}; }},
});
const marker = (rect, role) => ({...rect,role,protocol:2,type:"SCROLL",epoch:8,sessionId:"s",workspaceId:"a",targetOutput:"eDP-1"});
const continuing = {screen: output, geometry: owner, data: role => role === 1005 ? marker(owner,"continuing") : [1002,1006].includes(role) ? true : null};
// Deliberately leave old Script state; a native batch must erase it before classification.
effect.motionTransaction.arm(1260,continuing,Date.now(),{type:MotionType.SCROLL});
effect.pendingWideExit={transactionId:77};
effect.geometryChanged(continuing, right);
assert.equal(starts.length, 0, "native continuing has no scripted Translation/Scale/Opacity");
assert.equal(cancellations.length, 1);
assert.equal(effect.motionTransaction.current(Date.now()),null,"native continuing never arms a legacy transaction");
assert.equal(effect.pendingWideExit,null);
const fallbackSeed = {screen:output,geometry:owner,data:()=>null};
effect.geometryChanged(fallbackSeed,right);
const incoming = {screen: output, geometry: right, data: role => role === 1002 ? true : null};
effect.geometryChanged(incoming, parking);
assert.equal(starts.at(-1).role, "incoming");
assert.ok(starts.at(-1).options.channels.some(c => c.type === Effect.Translation));
const outgoing = {screen: output, geometry: parking, data: role => role === 1002 ? true : null};
effect.geometryChanged(outgoing, owner);
assert.equal(starts.at(-1).role, "outgoing");
const fallback = {screen: output, geometry: owner, data: () => null};
effect.geometryChanged(fallback, right);
assert.equal(starts.at(-1).role, "continuing", "missing owner uses legacy motion");
const unrelated = {screen: output, geometry: owner, data: role => role === 1005 ? marker(right,"continuing") : role === 1006 ? true : null};
effect.geometryChanged(unrelated, right);
assert.equal(starts.at(-1).role, "continuing", "ownership for another target cannot suppress motion");
console.log("PASS only matching native continuing bypasses scripted channels; entry/exit/fallback survive");

const ownedIncoming = {screen: output, geometry: right,
    data: role => role === 1005 ? marker(right,"incoming") : role === 1006 ? true : null};
const beforeOwnedIncoming = starts.length;
effect.geometryChanged(ownedIncoming, parking);
assert.equal(starts.length, beforeOwnedIncoming, "native incoming skips every Script animation channel");
assert.equal(cancellations.at(-1), ownedIncoming);
assert.equal(effect.motionTransaction.current(Date.now()),null,"native incoming leaves no Script SCROLL transaction");
const staleIncoming = {screen: output, geometry: right,
    data: role => role === 1005 ? marker(owner,"incoming") : role === 1006 ? true : null};
effect.geometryChanged(staleIncoming, parking);
assert.equal(starts.at(-1).role, "incoming", "wrong target falls back to Script incoming");
console.log("PASS native incoming bypass preserves outgoing and fallback");

const ownedOutgoing = {screen: output, geometry: parking,
    data: role => role === 1005 ? marker(owner,"outgoing") : role === 1006 ? true : null};
const beforeOwnedOutgoing = starts.length;
effect.geometryChanged(ownedOutgoing, owner);
assert.equal(starts.length, beforeOwnedOutgoing, "native final parking starts no legacy outgoing animation");
assert.equal(cancellations.at(-1), ownedOutgoing);
effect.geometryChanged(fallbackSeed,right); // A refused batch commits its continuing column first.
const staleOutgoing = {screen: output, geometry: parking,
    data: role => role === 1005 ? marker(right,"outgoing") : role === 1006 ? true : null};
effect.geometryChanged(staleOutgoing, owner);
assert.equal(starts.at(-1).role, "outgoing", "unrelated outgoing marker preserves fallback");
console.log("PASS native outgoing finalizer suppresses duplicate animation only for owned frame");

const countBeforeCapabilityLoss=starts.length;
const unloadedOwner = {screen:output,geometry:owner,data:role=>role===1005?marker(owner,"continuing"):null};
effect.geometryChanged(unloadedOwner,right);
assert.equal(starts.length,countBeforeCapabilityLoss+1,"capability loss re-enables legacy SCROLL despite stale marker");
const countBeforeMarkerLoss=starts.length;
const noOwner = {screen:output,geometry:owner,data:role=>role===1006?true:null};
effect.geometryChanged(noOwner,right);
assert.equal(starts.length,countBeforeMarkerLoss+1,"capability without native ACK preserves legacy path");
console.log("PASS capability loss and unarmed native effect preserve legacy SCROLL");

let legacyTransactionStarts=0;
for (const method of ["arm","begin"]) {
    const original=effect.motionTransaction[method].bind(effect.motionTransaction);
    effect.motionTransaction[method]=(...args)=>{legacyTransactionStarts++;return original(...args);};
}
const batchStarts=starts.length;
effect.geometryChanged(continuing,right);
effect.geometryChanged(ownedIncoming,parking);
effect.geometryChanged(ownedOutgoing,owner);
assert.equal(starts.length,batchStarts,"entire native batch never enters Script MotionController");
assert.equal(legacyTransactionStarts,0,"entire native batch never creates or arms old transactions");
assert.equal(effect.motionTransaction.current(Date.now()),null);
effect.geometryChanged(noOwner,right);
assert.ok(legacyTransactionStarts>0,"unarmed native owner still creates a legacy transaction");
assert.equal(effect.motionTransaction.current(Date.now()).type,MotionType.SCROLL);
console.log("PASS all native SCROLL roles skip legacy transaction creation and every animation channel");
