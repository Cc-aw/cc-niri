"use strict";
const assert = require("node:assert/strict");
const { CCNiriScrollTransition, MotionType } = require("../effect/contents/code/main.js");
const { widePairMotionSnapshot } = require("../src/effect/WideMotionGeometry");
function signal() {
    const handlers = new Set();
    return { connect: fn => handlers.add(fn), emit: (...args) => [...handlers].forEach(fn => fn(...args)) };
}
const screen = {name:"eDP-1", geometry:{x:0,y:0,width:1920,height:1080}};
const left = {x:24,y:50,width:932,height:960}, right = {...left,x:964};
const wide = {x:286,y:50,width:1347,height:960};
const globals = ["effects","effect","Effect","QEasingCurve","animationTime","animate","cancel","set"];
const previous = new Map(globals.map(name => [name,global[name]]));
const realNow = Date.now;
let now = 1000, nextId = 1, holds = 0;
const animationIds = new Map();
function fixture(side = "left") {
    const targetRect = side === "left" ? left : right;
    const neighborRect = side === "left" ? right : left;
    function windowFor(id,rect) {
        const data = new Map([[1002,true]]);
        return {id, screen, geometry:{...rect}, onCurrentDesktop:true,
            windowFrameGeometryChanged:signal(), data:role=>data.get(role),
            setData(role,value) {data.set(role,value); effects.windowDataChanged.emit(this,role);} };
    }
    const target = windowFor("target",targetRect), neighbor = windowFor("neighbor",neighborRect);
    global.effects = {stackingOrder:[target,neighbor], desktopChanged:signal(), windowDataChanged:signal(),
        windowAdded:signal(), windowClosed:signal(), addRepaintFull() {}};
    global.effect = {configChanged:signal(), animationEnded:signal(), readConfig:(_key,value)=>value,
        grab:()=>true,ungrab:()=>true};
    global.Effect = {Translation:1,Scale:2,Opacity:3,Generic:4,Shader:5,Left:6,Right:7,
        Top:8,Bottom:9,WindowMinimizedGrabRole:10,WindowUnminimizedGrabRole:11};
    global.QEasingCurve={OutCubic:1,Linear:2}; global.animationTime=value=>value;
    global.animate=request=>{const id=nextId++;animationIds.set(id,request);return[id];};
    global.set=request=>{holds++;return animate(request);};
    global.cancel=ids=>{for(const id of ids) {const request=animationIds.get(id);if(request)effect.animationEnded.emit(request.window,0);}};
    const transition = new CCNiriScrollTransition();
    function plan(type,epoch) {
        const snapshot=widePairMotionSnapshot(type,wide,targetRect,side,8);
        const entries=[{...snapshot.target,role:"target",windowId:"target"},
            {...snapshot.neighbor,role:"neighbor",windowId:"neighbor"}];
        const common={type,epoch,issuedAt:now,side,entries,sessionId:"s",transitionToken:"park-1",targetWindowUuid:"target"};
        target.setData(1003,{...common,...entries[0]}); neighbor.setData(1003,{...common,...entries[1]});
    }
    function geometry(window,rect) {const old=window.geometry;window.geometry={...rect};window.windowFrameGeometryChanged.emit(window,old);}
    plan(MotionType.PAIR_TO_WIDE,1); geometry(target,wide);
    assert.equal(transition.motion.states.get(neighbor).type,MotionType.PAIR_TO_WIDE);
    return {transition,target,neighbor,targetRect,neighborRect,plan,geometry};
}
try {
    Date.now=()=>now;
    for(const side of ["left","right"]) {
        const h=fixture(side);
        now+=100;
        const sample=h.transition.motion.visualSnapshot(h.neighbor,h.neighbor.geometry,now);
        h.plan(MotionType.WIDE_TO_PAIR,2);
        h.geometry(h.target,h.targetRect);
        const restored=h.transition.motion.states.get(h.neighbor);
        assert.equal(restored.type,MotionType.WIDE_TO_PAIR,"return must retarget the unchanged neighbor, not leave its outgoing fade");
        const start=h.transition.motion.visualSnapshot(h.neighbor,h.neighbor.geometry,now);
        assert.ok(Math.abs(sample.x-start.x)<0.5 && Math.abs(sample.opacity-start.opacity)<0.001,"reverse uses current painted sample");
        now+=220; effect.animationEnded.emit(h.neighbor,0);
        assert.equal(h.transition.wideIsolationHolds.has(h.neighbor),false,"late outgoing completion cannot re-hide pair neighbor");
        assert.equal(h.transition.motion.sample(h.neighbor,now).opacity,1);
    }
    // End-of-animation hold exists while the layout waits for real parking.
    // Return can be accepted while both frame geometries already equal pair
    // targets, so there need not be another geometry signal from either window.
    const h=fixture(); now+=220;effect.animationEnded.emit(h.neighbor,0);
    assert.equal(h.transition.wideIsolationHolds.has(h.neighbor),true,"Wide still hides retained neighbor");
    const heldBefore=holds;
    h.target.geometry={...h.targetRect};
    h.plan(MotionType.WIDE_TO_PAIR,2);
    assert.equal(h.transition.wideIsolationHolds.has(h.neighbor),false,"authoritative exit releases hold without a geometry signal");
    now+=220;effect.animationEnded.emit(h.neighbor,0);
    assert.equal(holds,heldBefore,"exit cannot create a new permanent zero-opacity hold");
    assert.equal(h.transition.motion.sample(h.neighbor,now).opacity,1);
    // A parked neighbor keeps the established geometry-driven incoming path.
    const parked=fixture(); now+=100;
    parked.neighbor.geometry={...parked.neighborRect,x:-5000};
    const retired=parked.transition.motion.states.get(parked.neighbor).animationIds[0];
    parked.plan(MotionType.WIDE_TO_PAIR,2);
    assert.equal(parked.transition.motion.states.has(parked.neighbor),false);
    effect.animationEnded.emit(parked.neighbor,retired);
    assert.equal(parked.transition.wideIsolationHolds.has(parked.neighbor),false);
    parked.geometry(parked.target,parked.targetRect);
    parked.geometry(parked.neighbor,parked.neighborRect);
    assert.equal(parked.transition.motion.states.get(parked.neighbor).type,MotionType.WIDE_TO_PAIR);
    now+=220;effect.animationEnded.emit(parked.neighbor,0);
    assert.equal(parked.transition.motion.sample(parked.neighbor,now).opacity,1);
    // Even a delayed/missed plan notification must not let old completion
    // install a persistent hide after the native marker has changed to Pair.
    const delayed=fixture();
    effects.windowDataChanged=signal();
    now+=100;delayed.plan(MotionType.WIDE_TO_PAIR,2);
    delayed.geometry(delayed.target,delayed.targetRect);
    assert.equal(delayed.transition.motion.states.get(delayed.neighbor).type,MotionType.PAIR_TO_WIDE);
    now+=120;effect.animationEnded.emit(delayed.neighbor,0);
    assert.equal(delayed.transition.wideIsolationHolds.has(delayed.neighbor),false);
    // Callback reentry and repeated reversals must not reinstate an old hold.
    for(let index=0;index<30;index++) {
        const repeat=fixture(index%2 ? "right" : "left");
        now+=20+(index%7)*30;
        repeat.plan(MotionType.WIDE_TO_PAIR,2);repeat.geometry(repeat.target,repeat.targetRect);
        now+=220;effect.animationEnded.emit(repeat.neighbor,0);
        assert.equal(repeat.transition.wideIsolationHolds.size,0);
        assert.equal(repeat.transition.motion.sample(repeat.neighbor,now).opacity,1);
    }
} finally {
    Date.now=realNow;
    for(const [name,value] of previous) {if(value===undefined)delete global[name];else global[name]=value;}
}
console.log("PASS Wide neighbor reversal and no-geometry exit cannot retain old opacity holds");
