"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const targets = [
    {
        outputPath: "package/contents/code/main.js",
        modulePaths: [
            "src/kwin/model/ColumnStore.js",
            "src/kwin/model/WindowStateStore.js",
            "src/kwin/layout/Geometry.js",
            "src/kwin/layout/SafeArea.js",
            "src/kwin/layout/ColumnLayout.js",
            "src/kwin/layout/Projection.js",
            "src/kwin/layout/Parking.js",
            "src/kwin/layout/LayoutEngine.js",
            "src/kwin/layout/GeometryCommitter.js",
            "src/kwin/runtime/RuntimeConfig.js",
            "src/kwin/runtime/RuntimeLogger.js",
            "src/kwin/runtime/OutputTopology.js",
            "src/kwin/runtime/RuntimeLifecycle.js",
            "src/kwin/runtime/ShortcutCatalog.js",
            "src/kwin/runtime/ControllerComposition.js",
            "src/kwin/runtime/CCNiri.js",
            "src/kwin/stability/LayoutTransaction.js",
            "src/kwin/stability/InvariantChecker.js",
            "src/kwin/stability/ParkingManager.js",
            "src/kwin/stability/Recovery.js",
            "src/kwin/lifecycle/AdoptionController.js",
            "src/kwin/lifecycle/FloatingController.js",
            "src/kwin/lifecycle/OutputController.js",
            "src/kwin/lifecycle/FullscreenController.js",
            "src/kwin/integration/DockGateway.js",
            "src/kwin/presentation/PresentationController.js",
            "src/kwin/presentation/WideTransition.js",
            "src/kwin/navigation/DockScrollController.js",
            "src/kwin/navigation/ReorderController.js",
        ],
        beginMarker: "/* BEGIN GENERATED KWIN MODULES */",
        endMarker: "/* END GENERATED KWIN MODULES */",
    },
    {
        outputPath: "effect/contents/code/main.js",
        modulePaths: [
            "src/kwin/runtime/RuntimeLogger.js",
            "src/effect/MotionTokens.js",
            "src/effect/MotionSampler.js",
            "src/effect/MotionTransaction.js",
            "src/effect/MotionController.js",
            "src/effect/MotionClassifier.js",
        ],
        beginMarker: "/* BEGIN GENERATED EFFECT MODULES */",
        endMarker: "/* END GENERATED EFFECT MODULES */",
    },
];

function bundleSource(relativePath) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    return source
        .replace(/^"use strict";\s*/u, "")
        .replace(/\/\* cjs:start \*\/[\s\S]*?\/\* cjs:end \*\//gu, "")
        .trim();
}

for (const target of targets) {
    const outputPath = path.join(root, target.outputPath);
    const current = fs.readFileSync(outputPath, "utf8");
    const begin = current.indexOf(target.beginMarker);
    const end = current.indexOf(target.endMarker);
    if (begin < 0 || end < begin) {
        throw new Error(`generated module markers are missing from ${target.outputPath}`);
    }

    const generated = target.modulePaths.map(relativePath =>
        `// Generated from ${relativePath}\n${bundleSource(relativePath)}`
    ).join("\n\n");
    const next = current.slice(0, begin + target.beginMarker.length) +
        `\n${generated}\n` + current.slice(end);
    if (process.argv.includes("--check")) {
        if (next !== current) {
            console.error(`${target.outputPath} is not up to date; run node tools/build.js`);
            process.exitCode = 1;
        }
    } else {
        fs.writeFileSync(outputPath, next);
    }
}
