const typora = workspace.windowList().find(window =>
    window.normalWindow && window.caption.includes("常用命令.md - Typora")
);

if (typora) {
    typora.setMaximize(false, false);
    typora.frameGeometry = { x: 580, y: 0, width: 1400, height: 1184 };
    console.info(`[cc-niri-poc-cleanup] typora=${typora.frameGeometry.x},${typora.frameGeometry.y} ` +
        `${typora.frameGeometry.width}x${typora.frameGeometry.height}`);
}
