"use strict";

/* cjs:start */
const {
    PRESENTATION_MIN_WIDTH_RATIO,
    PRESENTATION_MAX_WIDTH_RATIO,
} = require("./MotionTokens");
/* cjs:end */

function sameSize(a, b) {
    return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

function isColumnSize(rect, screenRect) {
    return rect.width > screenRect.width * 0.35 &&
        rect.width < screenRect.width * 0.65 &&
        rect.height > screenRect.height * 0.75;
}

function visibleSlot(rect, screenRect) {
    if (!isColumnSize(rect, screenRect) ||
            rect.x < screenRect.x || rect.y < screenRect.y ||
            rect.x + rect.width > screenRect.x + screenRect.width ||
            rect.y + rect.height > screenRect.y + screenRect.height) {
        return null;
    }
    const center = rect.x + rect.width / 2;
    return center < screenRect.x + screenRect.width / 2 ? "left" : "right";
}

function isFocusWide(rect, screenRect) {
    const widthRatio = rect.width / screenRect.width;
    if (widthRatio < PRESENTATION_MIN_WIDTH_RATIO ||
            widthRatio > PRESENTATION_MAX_WIDTH_RATIO ||
            rect.height < screenRect.height * 0.75 ||
            rect.x < screenRect.x || rect.y < screenRect.y ||
            rect.x + rect.width > screenRect.x + screenRect.width ||
            rect.y + rect.height > screenRect.y + screenRect.height) {
        return false;
    }
    const rectCenter = rect.x + rect.width / 2;
    const screenCenter = screenRect.x + screenRect.width / 2;
    return Math.abs(rectCenter - screenCenter) < screenRect.width * 0.03;
}

function presentationTransition(oldGeometry, newGeometry, screenRect) {
    /* A real Focus Wide transition only changes horizontal position and
     * width. Newly mapped applications often start as a centered large
     * window but also change height when adopted; never classify those
     * first-layout changes as Presentation animation. */
    if (Math.abs(oldGeometry.y - newGeometry.y) >= 1 ||
            Math.abs(oldGeometry.height - newGeometry.height) >= 1) {
        return false;
    }
    const oldSlot = visibleSlot(oldGeometry, screenRect);
    const newSlot = visibleSlot(newGeometry, screenRect);
    const oldWide = isFocusWide(oldGeometry, screenRect);
    const newWide = isFocusWide(newGeometry, screenRect);
    return (oldSlot && newWide) || (oldWide && newSlot);
}

function parked(rect, screenRect) {
    return isColumnSize(rect, screenRect) &&
        (rect.x + rect.width < screenRect.x ||
         (rect.x < screenRect.x &&
          rect.x + rect.width <= screenRect.x + screenRect.width * 0.25));
}

function incomingVisualStart(rect, translationX, scaleX, anchor, opacity) {
    const width = rect.width * scaleX;
    let x = rect.x + (rect.width - width) / 2;
    if (anchor === "left") x = rect.x;
    if (anchor === "right") x = rect.x + rect.width - width;
    return {
        x: x + translationX,
        y: rect.y,
        width,
        height: rect.height,
        opacity,
    };
}

/* cjs:start */
module.exports = {
    sameSize,
    isColumnSize,
    visibleSlot,
    isFocusWide,
    presentationTransition,
    parked,
    incomingVisualStart,
};
/* cjs:end */
