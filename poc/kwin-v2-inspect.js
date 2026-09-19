const TAG = "[cc-niri-v2-inspect]";
function rectText(rect) { return `${rect.x},${rect.y} ${rect.width}x${rect.height}`; }
workspace.windowList().forEach(window => {
    if (window.caption === "ChatGPT" || window.dock) {
        console.info(`${TAG} caption=${window.caption} dock=${window.dock}` +
            ` output=${window.output ? window.output.name : "none"}` +
            ` geometry=${rectText(window.frameGeometry)}` +
            ` maximize=${window.maximizeMode} fullscreen=${window.fullScreen}` +
            ` tile=${window.tile ? rectText(window.tile.relativeGeometry) : "none"}`);
    }
});
