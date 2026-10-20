"use strict";
const assert=require("node:assert/strict");
const {test}=require("node:test");
const {ColumnGeometryCoordinator}=require("../src/kwin/layout/ColumnGeometryCoordinator");
const {createV2Runtime}=require("./helpers/scroll-layout-v2-runtime");
function signal(){const slots=new Set();return{connect:f=>slots.add(f),disconnect:f=>slots.delete(f),emit:()=>[...slots].forEach(f=>f()),size:()=>slots.size};}
function fixture(){
    const r=createV2Runtime(), events=[], timers=new Set(), failures=[];
    const a=r.window("a",undefined,{frameGeometryChanged:signal(),closed:signal(),opacity:1,minimized:false});
    const b=r.window("b",undefined,{frameGeometryChanged:signal(),closed:signal(),opacity:1,minimized:false});
    r.mount([{window:a,widthMode:"half"},{window:b,widthMode:"half"}],{},r.geometry(2560,16,50));
    let source=null, proof=null, pendingArm=null, autoArm=true, capEnabled=true;
    const native={epoch:r.state.geometryGeneration,plan:null,frame:null,active:true};
    function paint(intent=r.controller.lastTarget,completed=false){
        source={protocol:4,type:"COLUMN_GEOMETRY_SOURCE",valid:true,sessionId:intent.sessionId,workspaceId:intent.workspaceId,targetOutput:intent.targetOutput,
            scopeRevision:intent.scopeRevision,epoch:intent.epoch,sampleSerial:(source?source.sampleSerial:9)+1,cameraX:intent.cameraTargetX,maxCamera:intent.maxCamera,
            viewport:intent.geometry.outputRect,layoutRect:{x:0,y:66,width:2560,height:1358},entries:intent.entries.map(e=>({windowId:e.uuid,columnId:e.columnId,logicalX:e.logicalX,
                frameRect:{...e.visualRect,x:Math.max(0,Math.min(2560-e.pixelWidth,e.visualRect.x))},visualRect:e.visualRect,owned:true,painted:true,acknowledged:true}))};
        if(completed)proof={protocol:4,type:"COLUMN_GEOMETRY_COMPLETION",...Object.fromEntries(["sessionId","workspaceId","targetOutput","scopeRevision","epoch"].map(k=>[k,intent[k]])),completed:true,painted:true,sampleSerial:source.sampleSerial};
    }
    paint();
    for(const row of source.entries){r.state.columns.find(c=>c.v2WindowUuid===row.windowId).window.frameGeometry={...row.frameRect};}
    const bridge={handlers:{},generationAgnosticTypes:new Set(),
        columnGeometryCapability:cb=>cb({protocol:4,type:"COLUMN_GEOMETRY",enabled:capEnabled,inputPolicy:"two-click",sourcePolicy:"painted-client-frames"}),
        partialScrollCapability:cb=>cb({protocol:3,enabled:true,inputPolicy:"two-click"}),
        columnGeometrySource:(entries,cb)=>{events.push("source");cb(source);},
        publishMotionPlan:(e,cb)=>{events.push("publish");native.plan=e;cb(true);},
        armScrollPlan:(e,cb)=>{events.push("arm");native.epoch=e.epoch;native.active=true;native.frame=e;
            pendingArm=()=>cb(true);if(autoArm)pendingArm();},
        columnGeometryCompletion:cb=>cb(proof),
        disarmColumnGeometry:(epoch,cb)=>{events.push("cancel");native.active=false;cb(true);},
        scrollMotionStatus:cb=>cb({sessionId:r.controller.sessionId,epoch:native.epoch,active:native.active,clipHandoffActive:false}),
    };
    const coordinator=new ColumnGeometryCoordinator({bridge,
        currentEpoch:()=>r.state.geometryGeneration,isScope:p=>p.workspaceId===r.state.activeWorkspaceId && p.targetOutput===r.getPrimary().name,
        columnFor:id=>r.state.columns.find(c=>c.v2WindowUuid===id),eligible:w=>r.state.columns.some(c=>c.window===w),
        prepare:(_p,cb)=>{events.push("membership");cb(true);},
        committer:{commitGeometry:(c,rect,_reason,guard)=>{assert.ok(guard());events.push("write");c.window.frameGeometry={...rect};c.window.frameGeometryChanged.emit();}},
        setVisibility:(w,visible)=>{events.push(visible?"show":"hide");w.opacity=visible?1:0;w.minimized=!visible;},
        activate:()=>events.push("activate"),recover:(_p,proof)=>failures.push(proof),
        reissue:()=>false,
        setTimer:(cb,ms)=>{const t={cb,ms};timers.add(t);return t;},clearTimer:t=>timers.delete(t),
        now:()=>1000,warn:()=>{},onComplete:()=>events.push("complete"),
    });
    r.controller.getPainted=()=>coordinator.getPainted();r.onTarget(p=>coordinator.submit(p));
    const wake=()=>coordinator.completionWake({...r.controller.lastTarget,type:"scroll-frame-ready"});
    return {r,a,b,coordinator,bridge,events,failures,timers,native,paint,wake,
        setArm:v=>{autoArm=v;},arm:()=>pendingArm(),setCap:v=>{capEnabled=v;},
        source:()=>source,sourceInvalid:()=>{source={valid:false};},setProof:p=>{proof=p;}};
}
test("P4 coordinator orders membership/typed/arm before configure, waits real proof then activates",()=>{
    const f=fixture();f.setArm(false);f.r.width.cycle();
    assert.deepEqual(f.events,["membership","source","publish","arm"]);assert.equal(f.a.frameGeometry.width,1256);
    f.arm();assert.ok(f.events.includes("write"));assert.ok(!f.events.includes("activate"));
    // A public Bridge wakeup cannot manufacture Native completion.
    f.wake();assert.ok(!f.events.includes("activate"));
    f.paint(f.r.controller.lastTarget,true);f.wake();assert.ok(f.events.includes("activate"));assert.ok(f.events.includes("complete"));
    assert.equal(f.timers.size,0);assert.equal(f.a.frameGeometryChanged.size(),0);assert.equal(f.b.closed.size(),0);
});
test("rapid width intents retain all model cycles and release obsolete listeners without old writes",()=>{
    const f=fixture();f.setArm(false);for(let i=0;i<12;i++)f.r.width.cycle();
    assert.equal(f.r.state.columns[0].widthMode,"half");assert.equal(f.r.state.geometryGeneration,13);
    assert.equal(f.events.filter(e=>e==="write").length,0);assert.equal(f.timers.size,1);
    f.arm();f.paint(f.r.controller.lastTarget,true);f.wake();
    assert.equal(f.a.frameGeometry.width,1256);assert.equal(f.timers.size,0);assert.equal(f.failures.length,0);
});
test("source temporarily invalid waits for an event, without polling or disarming a valid motion",()=>{
    const f=fixture();f.r.width.cycle();f.paint(f.r.controller.lastTarget,true);f.wake();
    f.sourceInvalid();const oldEpoch=f.native.epoch;f.r.width.cycle();
    const queries=f.events.filter(e=>e==="source").length;
    assert.ok(f.coordinator.sourceWait);assert.equal(f.native.epoch,oldEpoch);assert.ok(!f.events.includes("cancel"));
    assert.equal(f.events.filter(e=>e==="source").length,queries); // no idle work
    f.coordinator.stop(()=>{});assert.equal(f.timers.size,0);assert.equal(f.a.closed.size(),0);
    assert.equal(f.coordinator.intent,null);assert.equal(f.coordinator.getPainted(),null);
    assert.equal(f.bridge.generationAgnosticTypes.has("scroll-frame-ready"),false);
});
test("missing capability causes no geometry write and reports unknown ownership to recovery",()=>{
    const f=fixture();f.setCap(false);f.r.width.cycle();assert.equal(f.events.filter(e=>e==="write").length,0);
    assert.equal(f.failures.length,1);assert.equal(f.failures[0].cancelled,false);assert.equal(f.timers.size,0);
});
test("workspace departure drops client listeners and pending writes; late arm/complete are inert",()=>{
    const f=fixture();f.setArm(false);f.r.width.cycle();f.coordinator.releaseForWorkspace();
    f.arm();f.paint(f.r.controller.lastTarget,true);f.wake();assert.equal(f.events.filter(e=>e==="write").length,0);
    assert.equal(f.timers.size,0);assert.equal(f.a.closed.size(),0);
});
test("configure deadline confirms disarm before global recovery and frees every subscription",()=>{
    const f=fixture();f.r.width.cycle();assert.equal(f.timers.size,1);
    [...f.timers][0].cb();assert.ok(f.events.includes("cancel"));assert.equal(f.failures[0].cancelled,true);
    assert.equal(f.timers.size,0);assert.equal(f.a.frameGeometryChanged.size(),0);assert.equal(f.b.closed.size(),0);
});
test("confirmed failure delegates to the existing global Recovery and releases real parking state",()=>{
    const {Recovery}=require("../src/kwin/stability/Recovery");
    const {ParkingManager}=require("../src/kwin/stability/ParkingManager");
    const f=fixture(), states=new Map();
    const stateFor=w=>{if(!states.has(w))states.set(w,{scrollOriginalOpacity:null});return states.get(w);};
    const parking=new ParkingManager({stateFor,getState:w=>states.get(w),refreshSafeArea:()=>{},getSafeRect:()=>({x:0,y:66,width:2560,height:1358}),debug:()=>{}});
    parking.setVisibility(f.b,false);
    const recovery=new Recovery({appState:f.r.state,windowStates:states,parking,indexOfWindow:w=>f.r.state.columns.findIndex(c=>c.window===w),
        beforeRestore:()=>{assert.equal(f.native.active,false);f.r.state.enabled=false;},debug:()=>{}});
    f.coordinator.recover=(_p,proof)=>{assert.equal(proof.cancelled,true);recovery.restoreAll("column-geometry-failure");};
    f.coordinator.setVisibility=(w,v)=>parking.setVisibility(w,v);
    f.r.width.cycle();[...f.timers][0].cb();
    assert.equal(f.b.minimized,false);assert.equal(f.b.opacity,1);assert.equal(parking.owns(f.b),false);
    assert.ok(f.b.frameGeometry.x>=0 && f.b.frameGeometry.x+f.b.frameGeometry.width<=2560);
    assert.equal(f.timers.size,0);assert.equal(f.b.closed.size(),0);assert.equal(f.coordinator.quarantined,true);
});
test("unknown cancel quarantines all further writes and safe stop reports false with subscriptions released",()=>{
    const f=fixture();f.bridge.disarmColumnGeometry=(_epoch,cb)=>cb(false);f.r.width.cycle();
    const writes=f.events.filter(e=>e==="write").length;
    [...f.timers][0].cb();assert.equal(f.failures[0].cancelled,false);assert.equal(f.coordinator.quarantined,true);
    f.r.width.cycle();assert.equal(f.events.filter(e=>e==="write").length,writes);
    let stopped=null;f.coordinator.stop(ok=>stopped=ok);assert.equal(stopped,false);
    assert.equal(f.timers.size,0);assert.equal(f.a.closed.size(),0);assert.equal(f.b.frameGeometryChanged.size(),0);
});

test("failed suspend retains its release obligation across cleared intent and stop retries",()=>{
    const f=fixture(); f.r.width.cycle();
    const epoch=f.coordinator.intent.epoch, calls=[];
    f.bridge.disarmColumnGeometry=(e,cb)=>{calls.push(e);cb(false);};
    let result;
    f.coordinator.suspend(ok=>{result=ok;});
    assert.equal(result,false);assert.equal(f.coordinator.intent,null);assert.equal(f.coordinator.releaseEpoch,epoch);
    f.coordinator.stop(ok=>{result=ok;});assert.equal(result,false);
    f.bridge.disarmColumnGeometry=(e,cb)=>{calls.push(e);cb(true);};
    f.coordinator.stop(ok=>{result=ok;});assert.equal(result,true);
    assert.deepEqual(calls,[epoch,epoch,epoch]);assert.equal(f.coordinator.releaseEpoch,null);
});
