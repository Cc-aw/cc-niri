/* Temporary V3 environment inventory. Loaded directly, never packaged. */

const TAG = "[cc-niri-v3-env]";

function rectText(rect) {
    return rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : "<none>";
}

console.info(`${TAG} BEGIN`);
workspace.screens.slice().sort((a, b) => a.geometry.x - b.geometry.x).forEach((output, index) => {
    console.info(`${TAG} SCREEN index=${index} name=${output.name} geometry=${rectText(output.geometry)}`);
});
workspace.windowList().forEach((window, index) => {
    if (!window.normalWindow && !window.dialog && !window.dock) return;
    console.info(`${TAG} WINDOW index=${index}` +
        ` caption=${window.caption}` +
        ` resourceClass=${window.resourceClass}` +
        ` normal=${window.normalWindow}` +
        ` dialog=${window.dialog}` +
        ` dock=${window.dock}` +
        ` moveable=${window.moveable}` +
        ` resizeable=${window.resizeable}` +
        ` output=${window.output ? window.output.name : "<none>"}` +
        ` geometry=${rectText(window.frameGeometry)}` +
        ` fullscreen=${window.fullScreen}` +
        ` maximize=${window.maximizeMode}` +
        ` tile=${window.tile ? rectText(window.tile.relativeGeometry) : "none"}`);
});
console.info(`${TAG} END`);
