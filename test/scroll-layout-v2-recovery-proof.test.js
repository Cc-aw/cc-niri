"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RecoveryCompletionGate } = require("../src/kwin/stability/RecoveryCompletionGate");
const { Recovery } = require("../src/kwin/stability/Recovery");
const { createRuntime } = require("./helpers/workspace-runtime");
function signal() { const slots = new Set(); return { connect: f => slots.add(f), disconnect: f => slots.delete(f),
    emit: () => [...slots].forEach(f => f()), size: () => slots.size }; }
function fixture() {
    let windows = [], timer = null;
    const gate = new RecoveryCompletionGate({ getWindows: () => windows,
        sameRect: (a,b) => ["x","y","width","height"].every(k => a[k] === b[k]),
        setTimer: f => { timer = f; return f; }, clearTimer: () => { timer = null; } });
    const window = { opacity: 0, minimized: true, frameGeometry: { x: -6000, y: 0, width: 10, height: 10 },
        frameGeometryChanged: signal(), opacityChanged: signal(), minimizedChanged: signal(), closed: signal() };
    windows.push(window);
    const target = { x: 24, y: 50, width: 100, height: 100 };
    return { gate, window, target, timer: () => timer, close: () => { windows = []; window.closed.emit(); } };
}
test("recovery proof waits for real frame, opacity and minimization; releases all subscriptions", () => {
    const f = fixture(), replies = [];
    f.gate.wait([{window: f.window, target: f.target, opacity: 1, minimized: false}], v => replies.push(v));
    assert.deepEqual(replies, []);
    f.window.frameGeometry = f.target; f.window.frameGeometryChanged.emit(); assert.deepEqual(replies, []);
    f.window.opacity = 1; f.window.opacityChanged.emit(); assert.deepEqual(replies, []);
    f.window.minimized = false; f.window.minimizedChanged.emit(); assert.deepEqual(replies, [true]);
    assert.equal(f.timer(), null); assert.equal(f.window.closed.size(), 0); assert.equal(f.gate.pending, null);
});
test("missing restore ACK times out without claiming success; a closed window releases its lease", () => {
    for (const closed of [false,true]) {
        const f = fixture(), replies = [];
        f.gate.wait([{window:f.window,target:f.target,opacity:1,minimized:false}], v => replies.push(v));
        if (closed) f.close(); else f.timer()();
        assert.deepEqual(replies,[closed]); assert.equal(f.gate.pending,null); assert.equal(f.window.closed.size(),0);
    }
});
test("non-finite opacity cannot satisfy recovery and a diagnostic failure cannot prevent cleanup", () => {
    const f=fixture(),replies=[];
    f.window.frameGeometry=f.target;f.window.minimized=false;f.window.opacity=NaN;
    f.gate.getWindowId=()=>"test";f.gate.warn=()=>{throw new Error("diagnostic failed");};
    f.gate.wait([{window:f.window,target:f.target,opacity:1,minimized:false}],v=>replies.push(v));
    assert.deepEqual(replies,[]);
    f.timer()();assert.deepEqual(replies,[false]);assert.equal(f.gate.pending,null);
    assert.equal(f.timer(),null);assert.equal(f.window.closed.size(),0);
});
test("global recovery cannot publish restored until Native retirement and client recovery proof", () => {
    let retire, client; const status = [];
    const recovery = new Recovery({ appState:{columns:[]}, windowStates:[], parking:{}, indexOfWindow:()=>-1,
        retire: done => { retire = done; }, beforeRestore:()=>status.push("writes-allowed"),
        waitForRestored: (_rows,done) => { client=done; }, onStatus:s=>status.push(s.state), warn:()=>{} });
    recovery.restoreAll("test","new-token"); assert.deepEqual(status,["pending"]);
    retire(true); assert.deepEqual(status,["pending","writes-allowed"]);
    client(true); assert.deepEqual(status,["pending","writes-allowed","restored"]);
    assert.equal(recovery.status.requestId,"new-token");
});
test("unconfirmed Native cancel reports blocked and never writes restoration geometry", () => {
    const status = [];
    const recovery = new Recovery({ appState:{columns:[]}, windowStates:[], parking:{}, indexOfWindow:()=>-1,
        retire: done=>done(false), beforeRestore:()=>assert.fail("unsafe write"),onStatus:s=>status.push(s.state),warn:()=>{} });
    recovery.restoreAll("test","token");assert.deepEqual(status,["pending","blocked"]);
    recovery.restoreAll("retry","retry-token");assert.deepEqual(status,["pending","blocked","pending","blocked"]);
    assert.equal(recovery.obligations.size,0);
});
test("a fresh explicit request retries Native retirement before any restoration write", () => {
    let confirmed=false, attempts=0, writes=0;
    const recovery=new Recovery({appState:{columns:[]},windowStates:[],parking:{},indexOfWindow:()=>-1,
        retire: done=>{attempts++;done(confirmed);},beforeRestore:()=>{writes++;},warn:()=>{}});
    recovery.restoreAll("first","first");assert.equal(recovery.status.state,"blocked");assert.equal(writes,0);
    confirmed=true;recovery.restoreAll("retry","second");
    assert.equal(attempts,2);assert.equal(writes,1);assert.equal(recovery.status.state,"restored");
    assert.equal(recovery.status.requestId,"second");
});
test("full generated V2 entry emits only transient proof after delayed real recovery frames", () => {
    const r=createRuntime({ScrollLayoutV2Enabled:true,MockV2Native:true,PrimaryWindowCount:5});r.paintV2();
    const parked=r.a[4]; parked.frameGeometry={...parked.frameGeometry,x:-6000}; r.holdGeometry(parked);
    r.evaluate('emergencyRestoreAllWindows("proof-test", "cli-token")');
    const statuses=()=>r.traffic.filter(t=>t.method==="ReportRecoveryStatus").map(t=>JSON.parse(t.payload));
    assert.equal(statuses().at(-1).state,"pending");
    r.flushGeometry(parked); assert.equal(statuses().at(-1).state,"restored");
    assert.equal(statuses().at(-1).requestId,"cli-token");
    assert.ok(r.published.every(s=>s.recovery===undefined && s.requestId===undefined));
    assert.equal(r.evaluate("recoveryCompletion.pending"),null);
});
test("a failed client restore retries the original obligations instead of acknowledging cleared ownership flags", () => {
    const r=createRuntime({ScrollLayoutV2Enabled:true,MockV2Native:true,PrimaryWindowCount:5});r.paintV2();
    const parked=r.a[4];parked.frameGeometry={...parked.frameGeometry,x:-6000};r.holdGeometry(parked);
    r.evaluate('emergencyRestoreAllWindows("first", "first-token")');
    r.evaluate('recoveryCompletion.pending.timer.callback()');
    assert.equal(r.evaluate("recovery.status.state"),"blocked");
    r.evaluate('emergencyRestoreAllWindows("retry", "retry-token")');
    assert.equal(r.evaluate("recovery.status.state"),"pending");
    assert.equal(r.evaluate("recovery.status.requestId"),"retry-token");
    assert.equal(r.evaluate('Array.from(recovery.obligations.values()).some(row => "window" in row)'),false);
    r.evaluate('recoveryCompletion.pending.timer.callback()');
    assert.equal(r.evaluate("recovery.status.state"),"blocked");
    r.evaluate('emergencyRestoreAllWindows("second-retry", "second-retry-token")');
    r.flushGeometry(parked);
    assert.equal(r.evaluate("recovery.status.state"),"restored");
    assert.equal(r.evaluate("recovery.status.requestId"),"second-retry-token");
    assert.equal(r.evaluate("recoveryCompletion.pending"),null);
    assert.equal(r.evaluate("recovery.obligations.size"),0);
});

test("V2 recovery preserves accepted fractional-scale client frames instead of restoring stale sizes", () => {
    const r=createRuntime({ScrollLayoutV2Enabled:true,MockV2Native:true,PrimaryWindowCount:5,
        OutputScale:1.5,ClientBufferScale:1.5,ScrollLayoutTopGap:8});r.paintV2();
    const parked=r.a[4];parked.frameGeometry={x:0,y:60,width:1256,height:1364};
    const frame={...parked.frameGeometry};
    r.evaluate('stateFor(workspace.windowList().find(w => w.internalId === "a4")).scrollLastVisibleGeometry = {x:100,y:60,width:800,height:1357}');
    r.evaluate('emergencyRestoreAllWindows("fractional-restore", "fractional-token")');
    assert.deepEqual({...parked.frameGeometry},frame);
    assert.equal(r.evaluate("recovery.status.state"),"restored");
    assert.equal(r.evaluate("recoveryCompletion.pending"),null);
});

test("V2 recovery preserves a full client's accepted width and panel-safe bounds", () => {
    const r=createRuntime({ScrollLayoutV2Enabled:true,MockV2Native:true,PrimaryWindowCount:5,
        OutputScale:1.5,ClientBufferScale:1.5,ScrollLayoutTopGap:8});r.paintV2();
    const parked=r.a[4];parked.frameGeometry={x:16,y:60,width:2528,height:1364};
    r.evaluate('emergencyRestoreAllWindows("full-restore", "full-token")');
    assert.deepEqual({...parked.frameGeometry},{x:16,y:60,width:2528,height:1364});
    assert.equal(r.evaluate("recovery.status.state"),"restored");
});

test("closed clients clear retry obligations without retaining destroyed windows", () => {
    const r=createRuntime({ScrollLayoutV2Enabled:true,MockV2Native:true,PrimaryWindowCount:5});r.paintV2();
    const parked=r.a[4];parked.frameGeometry={...parked.frameGeometry,x:-6000};r.holdGeometry(parked);
    r.evaluate('emergencyRestoreAllWindows("first", "first-token")');
    r.evaluate('recoveryCompletion.pending.timer.callback()');
    assert.ok(r.evaluate("recovery.obligations.size")>0);
    r.close(parked);
    assert.equal(r.evaluate('recovery.obligations.has("a4")'),false);
    r.evaluate('emergencyRestoreAllWindows("retry", "retry-token")');
    assert.equal(r.evaluate("recovery.status.state"),"restored");
    assert.equal(r.evaluate("recovery.obligations.size"),0);
});
