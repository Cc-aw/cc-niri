"use strict";
const assert = require("node:assert/strict");
const { DeferredScrollParking } = require("../src/kwin/layout/DeferredScrollParking");
function fixture() {
    let context = {sessionId:"s",workspaceId:"a",targetOutput:"eDP-1"};
    const column = {window:{fullScreen:false}};
    const state = {managedByScrollLayout:true,floating:false};
    const timers=[], replies=[], finalized=[], disarmed=[];
    const controller = new DeferredScrollParking({stateFor:()=>state,isCurrent:()=>true,
        context:()=>context, status:callback=>replies.push(callback),
        disarm:(epoch,callback)=>{ disarmed.push(epoch); callback(); },
        finalize:item=>finalized.push(item),warn:()=>{},
        setTimer:(callback,ms)=>{const t={callback,ms};timers.push(t);return t;},
        clearTimer:t=>{t.cleared=true;}});
    const item={column,rect:{x:-9000}};
    const complete=(epoch=1, overrides={})=>JSON.stringify({...context,epoch,active:true,completed:true,...overrides});
    return {controller,column,state,timers,replies,finalized,disarmed,item,complete,
        context:next=>{context=next;}};
}
let f=fixture();f.controller.start(1,[f.item]);
assert.equal(f.state.scrollPendingParkEpoch,1);assert.equal(f.finalized.length,0);
f.timers[0].callback();f.replies[0](f.complete(0));assert.equal(f.finalized.length,0,"stale epoch cannot park");
f.timers.at(-1).callback();f.replies[1](f.complete(1,{workspaceId:"b"}));assert.equal(f.finalized.length,0,"other workspace cannot park");
f.timers.at(-1).callback();f.replies[2](f.complete());assert.equal(f.finalized.length,1);assert.equal(f.state.scrollPendingParkEpoch,null);
f.replies[2](f.complete());assert.equal(f.finalized.length,1,"duplicate completion idempotent");
f=fixture();f.controller.start(1,[f.item]);f.timers[0].callback();const late=f.replies[0];
f.controller.start(2,[f.item]);late(f.complete());assert.equal(f.state.scrollPendingParkEpoch,2);assert.equal(f.finalized.length,0,"old reply cannot finalize new epoch");
f.controller.cancel();assert.equal(f.finalized.length,1);assert.equal(f.controller.pending,null);
f=fixture();f.controller.start(1,[f.item]);f.context({sessionId:"s",workspaceId:"b",targetOutput:"eDP-1"});f.controller.cancel();assert.equal(f.finalized.length,0,"do not write into departed workspace");assert.equal(f.state.scrollPendingParkEpoch,null);
f=fixture();f.controller.start(1,[f.item]);f.state.floating=true;f.controller.cancel();assert.equal(f.finalized.length,0,"released floating window is never parked");
f=fixture();f.controller.start(1,[f.item]);f.timers.find(t=>t.ms===3500).callback();assert.equal(f.finalized.length,1,"missing completion recovers through cancel ACK");
f=fixture();f.controller.start(1,[f.item]);f.controller.disarm=()=>{};f.timers.find(t=>t.ms===3500).callback();assert.equal(f.finalized.length,0);f.timers.find(t=>t.ms===150).callback();assert.equal(f.finalized.length,1,"lost cancel reply cannot strand outgoing");
f=fixture();f.controller.start(1,[f.item]);f.controller.cancel(false);assert.equal(f.finalized.length,1);assert.equal(f.disarmed.length,0,"retarget preserves native painted offset");
console.log("PASS scoped native completion, deferred parking, stale callbacks and cancellation");

f=fixture();f.controller.start(1,[f.item]);f.timers[0].callback();const pausedReply=f.replies[0];const oldWatchdog=f.timers.find(t=>t.ms===3500);f.controller.pause();pausedReply(f.complete());oldWatchdog.callback();assert.equal(f.finalized.length,0,"paused previous epoch cannot finalize during new ACK");
f.controller.start(2,[f.item]);assert.equal(f.state.scrollPendingParkEpoch,2);assert.equal(f.finalized.length,0,"pending ownership transfers without parking");
f.timers.at(-2).callback();f.replies.at(-1)(f.complete(2));assert.equal(f.finalized.length,1,"only latest native epoch parks retained outgoing");

f=fixture();f.controller.start(1,[f.item]);f.controller.release();
assert.equal(f.finalized.length,0,"workspace release preserves departing physical frames");
assert.equal(f.state.scrollPendingParkEpoch,null,"sleeping workspace does not retain a retired JS park owner");
assert.equal(f.disarmed.length,0,"native workspace renderer freezes the clip independently");
