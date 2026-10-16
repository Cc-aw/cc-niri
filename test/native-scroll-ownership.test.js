"use strict";
const assert = require("node:assert/strict");
const {readNativeScrollMarker,nativeScrollGeometryRole}=require("../src/effect/NativeScrollOwnership");
const output={name:"eDP-1",geometry:{x:0,y:0,width:1920,height:1080}};
const left={x:24,y:50,width:932,height:960},right={...left,x:964},parking={...left,x:-5028};
function fixture(role,rect,capability=true,patch={}) {
    const marker={...rect,protocol:2,type:"SCROLL",epoch:12,sessionId:"s",workspaceId:"a",targetOutput:"eDP-1",role,...patch};
    return {screen:output,onCurrentDesktop:true,data:r=>r===1005?marker:r===1006?capability:r===1002?true:null};
}
const classify=(w,old,next)=>nativeScrollGeometryRole(w,old,next,output.geometry);
assert.equal(classify(fixture("continuing",left),right,left),"continuing");
assert.equal(classify(fixture("incoming",right),parking,right),"incoming");
assert.equal(classify(fixture("outgoing",left),left,parking),"outgoing-finalize");
assert.equal(classify(fixture("continuing",left,false),right,left),null,"clip capability alone keeps fallback");
assert.equal(classify(fixture("continuing",left,true,{x:964}),right,left),null,"marker geometry mismatch");
assert.equal(classify(fixture("continuing",left),{...right,width:1348},left),null,"Wide resize stays in Script");
for (const patch of [{epoch:-1},{epoch:NaN},{epoch:Number.MAX_SAFE_INTEGER+1},{type:"PAIR_TO_WIDE"},
    {protocol:1},{targetOutput:"HDMI-1"},{sessionId:""},{workspaceId:""},{width:0},{x:Infinity},{role:"static"}]) {
    assert.equal(readNativeScrollMarker(fixture("continuing",left,true,patch)),null,JSON.stringify(patch));
}
const sleeping=fixture("continuing",left);sleeping.onCurrentDesktop=false;assert.equal(readNativeScrollMarker(sleeping),null);
assert.equal(classify(fixture("incoming",left),right,left),"incoming","previous outgoing can re-enter without a physical parking jump");
assert.equal(classify(fixture("outgoing",right),left,parking),null,"stale outgoing frame keeps fallback");
assert.equal(readNativeScrollMarker({screen:output}),null);
const width = { protocol: 1, type: "WIDE_TO_PAIR", epoch: 12, sessionId: "s",
    issuedAt: Date.now(), role: "neighbor", entries: [{ role: "target" }, { role: "neighbor" }] };
function paired(patch = {}) {
    const native = fixture("continuing", right), read = native.data;
    native.data = role => role === 1003 ? { ...width, ...patch } : read(role);
    return native;
}
assert.equal(readNativeScrollMarker(paired()), null, "same epoch clip leaves Pair/Wide paint timeline in Script");
for (const patch of [{ epoch: 11 }, { sessionId: "old" }, { protocol: 2 },
    { type: "SCROLL" }, { role: "static" }, { issuedAt: Date.now() - 6000 }, { entries: [] }]) {
    assert.ok(readNativeScrollMarker(paired(patch)), "unrelated or stale width marker cannot suppress Native ownership");
}
console.log("PASS native motion capability plus typed scoped frame ownership, Wide and fallback boundaries");
const partialMarker = { protocol: 3, type: "PARTIAL_SCROLL", scopeRevision: 1 };
assert.equal(classify(fixture("continuing", left, true, partialMarker), right, left), "continuing");
for (const patch of [{ scopeRevision: 0 }, { scopeRevision: NaN }, { scopeRevision: 0.5 },
    { protocol: 2 }, { type: "SCROLL" }]) {
    assert.equal(readNativeScrollMarker(fixture("continuing", left, true, { ...partialMarker, ...patch })), null);
}

const geometryMarker = {protocol:4,type:"COLUMN_GEOMETRY",scopeRevision:1};
assert.equal(classify(fixture("continuing",left,true,geometryMarker),right,{...left,width:1348}),"continuing");
assert.equal(classify(fixture("continuing",left,true,geometryMarker),right,{...left,x:137,width:731}),"continuing","late unknown ACK remains exclusively Native-owned");
assert.equal(classify(fixture("incoming",left,true,geometryMarker),parking,{...left,width:1348}),"incoming");
assert.equal(readNativeScrollMarker(fixture("continuing",left,true,{...geometryMarker,scopeRevision:0})),null);
