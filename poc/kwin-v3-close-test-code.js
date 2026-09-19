const testCode = workspace.windowList().find(window =>
    window.normalWindow && String(window.resourceClass || "").toLowerCase() === "code" &&
    String(window.caption || "").includes("FullScreen")
);

if (testCode) {
    console.info(`[cc-niri-v3-cleanup] closing=${testCode.caption}`);
    testCode.closeWindow();
}
