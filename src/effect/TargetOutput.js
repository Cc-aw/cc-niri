"use strict";

function animationTargetOutput(windows, configuredName) {
    // Scripted effects expose outputs on EffectWindow.screen. Include native
    // desktop/panel surfaces so empty primary workspaces retain their output.
    const outputs = new Map();
    for (let index = 0; index < windows.length; index += 1) {
        const screen = windows[index] && windows[index].screen;
        if (screen && screen.name && screen.geometry) outputs.set(screen.name, screen);
    }
    if (configuredName && outputs.has(configuredName)) return configuredName;
    const ordered = Array.from(outputs.values()).sort((a, b) =>
        a.geometry.x - b.geometry.x || a.geometry.y - b.geometry.y);
    return ordered.length ? ordered[0].name : null;
}

/* cjs:start */
module.exports = { animationTargetOutput };
/* cjs:end */
