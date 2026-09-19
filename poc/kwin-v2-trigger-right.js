const chatgpt = workspace.windowList().find(window =>
    window.normalWindow && window.caption === "ChatGPT"
);
if (chatgpt) {
    workspace.activeWindow = chatgpt;
    workspace.slotWindowQuickTileRight();
}
