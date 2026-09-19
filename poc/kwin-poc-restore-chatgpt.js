const chatgpt = workspace.windowList().find(window =>
    window.normalWindow && window.caption === "ChatGPT"
);

if (chatgpt) {
    chatgpt.setMaximize(false, false);
    chatgpt.frameGeometry = { x: 380, y: 170, width: 1800, height: 1100 };
    console.info(`[cc-niri-poc-cleanup] chatgpt=${chatgpt.frameGeometry.x},${chatgpt.frameGeometry.y} ` +
        `${chatgpt.frameGeometry.width}x${chatgpt.frameGeometry.height}`);
}
