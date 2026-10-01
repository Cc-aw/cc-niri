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
const continuing = {screen: output, geometry: owner, data: role => role === 1005 ? owner : role === 1002 ? true : null};
effect.geometryChanged(continuing, right);
assert.equal(starts.length, 0, "native continuing has no scripted Translation/Scale/Opacity");
assert.equal(cancellations.length, 1);
assert.equal(effect.motionTransaction.current(Date.now()).type, MotionType.SCROLL,
    "legacy incoming/outgoing still inherit the same scroll direction");
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
const unrelated = {screen: output, geometry: owner, data: role => role === 1005 ? right : null};
effect.geometryChanged(unrelated, right);
assert.equal(starts.at(-1).role, "continuing", "ownership for another target cannot suppress motion");
console.log("PASS only matching native continuing bypasses scripted channels; entry/exit/fallback survive");
