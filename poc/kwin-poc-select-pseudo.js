const match = workspace.windowList().find(window =>
    window.normalWindow &&
    window.frameGeometry.x === 10 &&
    window.frameGeometry.y === 42 &&
    window.frameGeometry.width === 2540
) || workspace.windowList().find(window =>
    window.normalWindow && window.caption === "ChatGPT"
);

if (match) {
    workspace.activeWindow = match;
    console.info(`[cc-niri-poc-selector] selected ${match.caption}`);
} else {
    console.info("[cc-niri-poc-selector] no matching pseudo window");
}
