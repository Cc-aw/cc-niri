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
assert.equal(classify(fixture("incoming",left),right,left),null,"incoming role cannot suppress continuing layout");
assert.equal(classify(fixture("outgoing",right),left,parking),null,"stale outgoing frame keeps fallback");
assert.equal(readNativeScrollMarker({screen:output}),null);
console.log("PASS native motion capability plus typed scoped frame ownership, Wide and fallback boundaries");
