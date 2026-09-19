/* One-shot POC: retry the expected settled parking geometry for VS Code. */
const TAG = "[cc-niri-v3-force-code-parking]";
const code = workspace.windowList().find(window =>
    window.normalWindow && String(window.resourceClass).toLowerCase() === "code"
);
if (!code) {
    console.info(`${TAG} no Code window`);
} else {
    const before = code.frameGeometry;
    code.frameGeometry = { x: -11648, y: 50, width: 1252, height: 1320 };
    const after = code.frameGeometry;
    console.info(`${TAG} before=${before.x},${before.y} ${before.width}x${before.height}` +
        ` after=${after.x},${after.y} ${after.width}x${after.height}`);
}
