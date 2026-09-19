/* Read-only signal-order probe for Meta+H/L geometry commits. */

const TAG = "[cc-niri-v3-transition-order]";
let sequence = 0;

function isColumn(window) {
    const rect = window.frameGeometry;
    return window.normalWindow && Math.abs(rect.width - 1252) < 0.01 &&
        Math.abs(rect.height - 1320) < 0.01 && window.output && window.output.name === "DP-1";
}

workspace.windowList().filter(isColumn).forEach(window => {
    window.frameGeometryChanged.connect(() => {
        sequence++;
        console.info(`${TAG} step=${sequence} caption=${window.caption}` +
            ` x=${window.frameGeometry.x}`);
    });
});

registerShortcut("CCNiriV3TransitionOrderReset", "CC Niri V3 Transition Order Reset", "", () => {
    sequence = 0;
    console.info(`${TAG} RESET`);
});
console.info(`${TAG} loaded`);
