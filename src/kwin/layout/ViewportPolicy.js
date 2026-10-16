"use strict";

/* cjs:start */
const { clampV2Camera, focusV2Camera } = require("./ContinuousColumnLayout");
/* cjs:end */

// JS target policy only. Painted facts are observations, never a second clock.
function resolveV2Viewport(layout, options) {
    let camera = options.currentTarget;
    const focused = layout.columns[options.focusedIndex];
    if (options.anchor && focused) {
        const anchor = layout.columns[options.anchor.index];
        if (anchor && Number.isFinite(options.anchor.delta)) camera = anchor.logicalX + options.anchor.delta;
    } else if (options.painted) {
        camera = options.painted.cameraX;
        if (options.structural && focused && options.paintedFocusRect) {
            camera = layout.geometry.workingArea.x + focused.logicalX - options.paintedFocusRect.x;
        }
    }
    return focusV2Camera(layout, options.focusedIndex, clampV2Camera(camera, layout.maxCamera));
}

/* cjs:start */
module.exports = { resolveV2Viewport };
/* cjs:end */
