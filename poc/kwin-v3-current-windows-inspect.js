/* Read-only one-shot probe for current normal-window mapping state. */
const TAG = "[cc-niri-v3-current-windows]";
workspace.windowList().filter(window => window.normalWindow).forEach(window => {
    const rect = window.frameGeometry;
    console.info(`${TAG} caption=${window.caption}` +
        ` class=${window.resourceClass} active=${window.active}` +
        ` managed=${window.managed} hidden=${window.hidden}` +
        ` output=${window.output ? window.output.name : "<none>"}` +
        ` geometry=${rect.x},${rect.y} ${rect.width}x${rect.height}`);
});
