"use strict";

function computeSafeRect(screen, gaps) {
    const xInset = Math.min(gaps.left, Math.max(0, screen.width - 1));
    const yInset = Math.min(gaps.top, Math.max(0, screen.height - 1));
    return {
        x: screen.x + xInset,
        y: screen.y + yInset,
        width: Math.max(1, screen.width - gaps.left - gaps.right),
        height: Math.max(1, screen.height - gaps.top - gaps.bottom),
    };
}

/* cjs:start */
module.exports = { computeSafeRect };
/* cjs:end */
