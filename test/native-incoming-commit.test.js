"use strict";
const assert = require("node:assert/strict");
const {GeometryCommitter} = require("../src/kwin/layout/GeometryCommitter");
const {ParkingManager} = require("../src/kwin/stability/ParkingManager");
function run(nativeScroll) {
    const events = [];
    const parkingRect = {x: -99999, y: 50, width: 932, height: 960};
    const target = {...parkingRect, x: 964};
    const state = {floating: false, layoutMode: "scroll", scrollOriginalOpacity: 0.8,
        scrollParkingMinimized: true, scrollVisuallyHidden: true, scrollParkedByScript: true};
    let geometry = parkingRect, opacity = 0, minimized = true;
    const window = {};
    Object.defineProperties(window, {
        frameGeometry: {get: () => geometry, set: value => {geometry=value; events.push(["geometry", opacity, minimized]);}},
        opacity: {get: () => opacity, set: value => {opacity=value; events.push(["opacity", value]);}},
        minimized: {get: () => minimized, set: value => {minimized=value; events.push(["minimized", value]);}},
    });
    const parking = new ParkingManager({stateFor: () => state, getState: () => state});
    const committer = new GeometryCommitter({stateFor: () => state,
        sameRect: (a,b) => JSON.stringify(a) === JSON.stringify(b), rectCopy: r => ({...r}),
        rectText: JSON.stringify, isTileMode: () => false, isRectInsideAnyOutput: () => false,
        setWindowVisibility: (w, visible) => parking.setVisibility(w,visible),
        isWindowHidden: w => parking.isHidden(w),
        rememberVisibleGeometry: (w,r) => parking.rememberVisibleGeometry(w,r), debug: () => {}, warn: () => {},
    });
    committer.commit({reason:"focus-next", scrollTransaction:null, commitOrder:[{column:{id:3,logicalX:1880,window},
        placement:"visible", transitionRole:"incoming", rect:target, newProjectedRect:target}]}, {nativeScroll});
    assert.equal(opacity, 0.8, "preserves user's original opacity");
    assert.equal(minimized, false); assert.equal(state.scrollVisuallyHidden, false);
    assert.deepEqual(geometry, target);
    return events.find(e => e[0] === "geometry");
}
assert.deepEqual(run(true), ["geometry", 0.8, false], "native incoming unhidden before geometry commit");
assert.deepEqual(run(false), ["geometry", 0, true], "fallback geometry still commits while hidden");
console.log("PASS native ACK reveals incoming before commit while fallback retains hidden commit order");
