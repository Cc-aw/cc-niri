/* SPDX-License-Identifier: MIT
 * CC Niri Maximize V3 - V2 safe areas plus main-output scrollable columns.
 */

/* BEGIN GENERATED KWIN MODULES */
// Generated from src/kwin/model/ColumnStore.js
class ColumnStore {
    constructor(state) {
        this.state = state;
    }

    indexOf(column) {
        return this.state.columns.indexOf(column);
    }

    indexOfWindow(window) {
        return this.state.columns.findIndex(column => column.window === window);
    }

    focusedIndex() {
        return this.state.focusedColumnIndex;
    }

    focusedColumn() {
        return this.state.columns[this.state.focusedColumnIndex] || null;
    }

    focusIndex(index) {
        if (!this.state.columns.length) {
            this.state.focusedColumnIndex = -1;
            return null;
        }
        const numericIndex = Number(index);
        if (!Number.isInteger(numericIndex) || numericIndex < 0 ||
                numericIndex >= this.state.columns.length) {
            return null;
        }
        this.state.focusedColumnIndex = numericIndex;
        return this.state.columns[numericIndex];
    }

    focusColumn(column) {
        return this.focusIndex(this.indexOf(column));
    }

    focusWindow(window) {
        return this.focusIndex(this.indexOfWindow(window));
    }

    insertWindow(window, insertionIndex, widthMode) {
        if (this.indexOfWindow(window) >= 0) return null;
        const column = {
            id: this.state.nextColumnId++,
            window,
            widthMode,
            persistentWide: false,
            logicalX: 0,
            pixelWidth: 0,
        };
        const requestedIndex = Number(insertionIndex);
        const index = Math.max(0, Math.min(
            Number.isFinite(requestedIndex)
                ? requestedIndex
                : this.state.columns.length,
            this.state.columns.length
        ));
        this.state.columns.splice(index, 0, column);
        return column;
    }

    removeWindow(window) {
        const index = this.indexOfWindow(window);
        if (index < 0) return null;
        const focusedColumn = this.focusedColumn();
        const column = this.state.columns[index];
        const wasFocused = focusedColumn === column;
        this.state.columns.splice(index, 1);

        if (!this.state.columns.length) {
            this.state.focusedColumnIndex = -1;
        } else if (wasFocused) {
            this.state.focusedColumnIndex = Math.min(
                index,
                this.state.columns.length - 1
            );
        } else {
            const preservedIndex = this.state.columns.indexOf(focusedColumn);
            this.state.focusedColumnIndex = preservedIndex >= 0
                ? preservedIndex
                : Math.min(index, this.state.columns.length - 1);
        }
        return { column, index, wasFocused };
    }

    reorder(columns) {
        if (!Array.isArray(columns) || columns.length !== this.state.columns.length) {
            return false;
        }
        const current = new Set(this.state.columns);
        if (new Set(columns).size !== columns.length ||
                columns.some(column => !current.has(column))) {
            return false;
        }
        const focusedColumn = this.focusedColumn();
        this.state.columns = columns.slice();
        this.state.focusedColumnIndex = focusedColumn
            ? this.state.columns.indexOf(focusedColumn)
            : -1;
        return true;
    }

    moveFocused(delta) {
        const oldIndex = this.state.focusedColumnIndex;
        if (oldIndex < 0 || oldIndex >= this.state.columns.length) return null;
        const nextIndex = Math.max(0, Math.min(
            this.state.columns.length - 1,
            oldIndex + delta
        ));
        if (nextIndex === oldIndex) return null;
        const column = this.state.columns[oldIndex];
        this.state.columns[oldIndex] = this.state.columns[nextIndex];
        this.state.columns[nextIndex] = column;
        this.state.focusedColumnIndex = nextIndex;
        return { column, oldIndex, nextIndex };
    }
}

// Generated from src/kwin/model/WindowStateStore.js
class WindowStateStore {
    constructor(createState) {
        this.createState = createState;
        this.states = new Map();
    }

    has(window) {
        return this.states.has(window);
    }

    get(window) {
        return this.states.get(window);
    }

    ensure(window) {
        let state = this.states.get(window);
        if (!state) {
            state = this.createState(window);
            this.states.set(window, state);
        }
        return state;
    }

    delete(window) {
        return this.states.delete(window);
    }

    forEach(callback) {
        this.states.forEach(callback);
    }
}

// Generated from src/kwin/layout/Geometry.js
function copyRect(rect) {
    return rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
}

function formatRect(rect) {
    return rect ? `${rect.x},${rect.y} ${rect.width}x${rect.height}` : "<none>";
}

function rectsEqual(a, b) {
    return Boolean(a && b && a.x === b.x && a.y === b.y &&
        a.width === b.width && a.height === b.height);
}

function rectsNearlyEqual(a, b, tolerance = 1) {
    return Boolean(a && b && Math.abs(a.x - b.x) < tolerance &&
        Math.abs(a.y - b.y) < tolerance &&
        Math.abs(a.width - b.width) < tolerance &&
        Math.abs(a.height - b.height) < tolerance);
}

function sizesNearlyEqual(a, b, tolerance = 1) {
    return Boolean(a && b && Math.abs(a.width - b.width) < tolerance &&
        Math.abs(a.height - b.height) < tolerance);
}

function rectanglesIntersect(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

function quickTileRect(mode, safeRect, requestedInnerGap, maximizeMode = "maximize") {
    if (mode === maximizeMode) return copyRect(safeRect);
    const gap = Math.min(
        Math.max(0, requestedInnerGap),
        Math.max(0, Math.min(safeRect.width, safeRect.height) - 2)
    );
    const leftWidth = Math.floor((safeRect.width - gap) / 2);
    const rightWidth = safeRect.width - gap - leftWidth;
    const topHeight = Math.floor((safeRect.height - gap) / 2);
    const bottomHeight = safeRect.height - gap - topHeight;
    const rightX = safeRect.x + leftWidth + gap;
    const bottomY = safeRect.y + topHeight + gap;
    const rects = {
        left: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: safeRect.height },
        right: { x: rightX, y: safeRect.y, width: rightWidth, height: safeRect.height },
        top: { x: safeRect.x, y: safeRect.y, width: safeRect.width, height: topHeight },
        bottom: { x: safeRect.x, y: bottomY, width: safeRect.width, height: bottomHeight },
        topLeft: { x: safeRect.x, y: safeRect.y, width: leftWidth, height: topHeight },
        topRight: { x: rightX, y: safeRect.y, width: rightWidth, height: topHeight },
        bottomLeft: { x: safeRect.x, y: bottomY, width: leftWidth, height: bottomHeight },
        bottomRight: { x: rightX, y: bottomY, width: rightWidth, height: bottomHeight },
    };
    return rects[mode] ? copyRect(rects[mode]) : null;
}

// Generated from src/kwin/layout/SafeArea.js
function computeSafeRect(screen, gaps) {
    const xInset = Math.min(gaps.left, Math.max(0, screen.width - 1));
    const yInset = Math.min(gaps.top, Math.max(0, screen.height - 1));
    return {
        x: screen.x + xInset,
        y: screen.y + yInset,
        width: Math.max(1, screen.width - gaps.left - gaps.right),
        height: Math.max(1, screen.height - gaps.top - gaps.bottom),
    };
}

// Generated from src/kwin/layout/ColumnLayout.js
function computeColumnWidth(mode, safeWidth, requestedInnerGap) {
    const gap = Math.min(requestedInnerGap, Math.max(0, safeWidth - 1));
    if (mode === "third") {
        return Math.max(1, Math.floor((safeWidth - 2 * gap) / 3));
    }
    if (mode === "twoThirds") {
        const third = Math.max(1, Math.floor((safeWidth - 2 * gap) / 3));
        return Math.max(1, safeWidth - gap - third);
    }
    return Math.max(1, Math.floor((safeWidth - gap) / 2));
}

function deriveColumnLayout(columns, safeWidth, innerGap) {
    let logicalX = 0;
    return columns.map(column => {
        const pixelWidth = computeColumnWidth(column.widthMode, safeWidth, innerGap);
        const derived = { logicalX, pixelWidth };
        logicalX += pixelWidth + innerGap;
        return derived;
    });
}

function computeStripWidth(columns) {
    if (!columns.length) return 0;
    const last = columns[columns.length - 1];
    return last.logicalX + last.pixelWidth;
}

function boundScrollOffset(offset, stripWidth, viewportWidth) {
    return Math.max(0, Math.min(offset, Math.max(0, stripWidth - viewportWidth)));
}

function scrollOffsetToRevealColumn(offset, column, stripWidth, viewportWidth) {
    const viewportRight = offset + viewportWidth;
    let nextOffset = offset;
    if (column.logicalX < offset) {
        nextOffset = column.logicalX;
    } else if (column.logicalX + column.pixelWidth > viewportRight) {
        nextOffset = column.logicalX + column.pixelWidth - viewportWidth;
    }
    return boundScrollOffset(nextOffset, stripWidth, viewportWidth);
}

// Generated from src/kwin/layout/Projection.js
function projectColumnRect(column, safeRect, scrollOffsetX) {
    return {
        x: safeRect.x + column.logicalX - scrollOffsetX,
        y: safeRect.y,
        width: column.pixelWidth,
        height: safeRect.height,
    };
}

function isRectFullyVisible(rect, viewport) {
    return Boolean(viewport && rect.x >= viewport.x && rect.y >= viewport.y &&
        rect.x + rect.width <= viewport.x + viewport.width &&
        rect.y + rect.height <= viewport.y + viewport.height);
}

// Generated from src/kwin/layout/Parking.js
function computeParkingBaseX(columns, virtualLeft, parkingMargin) {
    const maximumColumnWidth = columns.reduce(
        (maximum, column) => Math.max(maximum, column.pixelWidth),
        0
    );
    return virtualLeft - parkingMargin - maximumColumnWidth;
}

function computeParkingRect(column, parkingIndex, options) {
    return {
        x: options.baseX - parkingIndex * (column.pixelWidth + options.innerGap),
        y: options.safeRect.y,
        width: column.pixelWidth,
        height: options.safeRect.height,
    };
}

// Generated from src/kwin/layout/LayoutEngine.js
function transitionRole(oldPlacement, newPlacement) {
    if (oldPlacement === "visible" && newPlacement === "visible") {
        return "continuing";
    }
    if (oldPlacement === "parked" && newPlacement === "visible") {
        return "incoming";
    }
    if (oldPlacement === "visible" && newPlacement === "parked") {
        return "outgoing";
    }
    return "static";
}

function transitionRank(role) {
    return ({ continuing: 0, incoming: 1, outgoing: 2, static: 3 })[role];
}

function motionWindowId(item) {
    const internalId = item.column.window.internalId;
    return String(internalId === undefined || internalId === null
        ? item.column.window.id || item.columnId
        : internalId);
}

function computeLayoutPlan(options) {
    const {
        reason,
        epoch,
        columns,
        safeRect,
        innerGap,
        parkingBaseX,
        scrollOffsetX,
        scrollOffsets,
        presentedColumn,
        presentedRect,
    } = options;
    const hasScrollTransaction = Boolean(!presentedColumn && scrollOffsets &&
        scrollOffsets.oldScrollOffsetX !== scrollOffsets.newScrollOffsetX);
    const oldScrollOffsetX = hasScrollTransaction
        ? scrollOffsets.oldScrollOffsetX
        : scrollOffsetX;
    const newScrollOffsetX = hasScrollTransaction
        ? scrollOffsets.newScrollOffsetX
        : scrollOffsetX;
    let parkingIndex = 0;

    const windows = columns.map(column => {
        const oldProjectedRect = projectColumnRect(column, safeRect, oldScrollOffsetX);
        const newProjectedRect = projectColumnRect(column, safeRect, newScrollOffsetX);
        const oldPlacement = isRectFullyVisible(oldProjectedRect, safeRect)
            ? "visible"
            : "parked";
        const projectedPlacement = isRectFullyVisible(newProjectedRect, safeRect)
            ? "visible"
            : "parked";
        const isPresented = presentedColumn === column;
        const newPlacement = presentedColumn
            ? (isPresented ? "visible" : "parked")
            : projectedPlacement;
        const visibleRect = isPresented ? copyRect(presentedRect) : newProjectedRect;
        const rect = newPlacement === "visible"
            ? visibleRect
            : computeParkingRect(column, parkingIndex++, {
                baseX: parkingBaseX,
                innerGap,
                safeRect,
            });
        const role = hasScrollTransaction
            ? transitionRole(oldPlacement, newPlacement)
            : "static";
        return {
            column,
            columnId: column.id,
            placement: newPlacement,
            rect,
            projectedRect: newPlacement === "visible" ? visibleRect : newProjectedRect,
            oldProjectedRect: hasScrollTransaction ? oldProjectedRect : null,
            newProjectedRect,
            oldPlacement: hasScrollTransaction ? oldPlacement : null,
            newPlacement: hasScrollTransaction ? newPlacement : null,
            transitionRole: role,
        };
    });

    const deltaX = newScrollOffsetX - oldScrollOffsetX;
    const scrollTransaction = hasScrollTransaction ? {
        id: epoch,
        epoch,
        type: "SCROLL",
        direction: deltaX > 0 ? "left" : "right",
        deltaX,
        oldScrollOffsetX,
        newScrollOffsetX,
        viewport: copyRect(safeRect),
        continuing: windows.filter(item => item.transitionRole === "continuing")
            .map(motionWindowId),
        incoming: windows.filter(item => item.transitionRole === "incoming")
            .map(motionWindowId),
        outgoing: windows.filter(item => item.transitionRole === "outgoing")
            .map(motionWindowId),
    } : null;

    return {
        reason,
        epoch,
        scrollTransaction,
        windows,
        commitOrder: hasScrollTransaction
            ? windows.slice().sort((a, b) =>
                transitionRank(a.transitionRole) - transitionRank(b.transitionRole))
            : windows,
    };
}

// Generated from src/kwin/layout/GeometryCommitter.js
class GeometryCommitter {
    constructor(dependencies) {
        this.stateFor = dependencies.stateFor;
        this.sameRect = dependencies.sameRect;
        this.rectCopy = dependencies.rectCopy;
        this.rectText = dependencies.rectText;
        this.isTileMode = dependencies.isTileMode;
        this.isRectInsideAnyOutput = dependencies.isRectInsideAnyOutput;
        this.debug = dependencies.debug;
        this.warn = dependencies.warn;
        this.setWindowVisibility = dependencies.setWindowVisibility;
        this.isWindowHidden = dependencies.isWindowHidden;
        this.rememberVisibleGeometry = dependencies.rememberVisibleGeometry;
    }

    commitGeometry(column, target, reason) {
        const window = column.window;
        const windowState = this.stateFor(window);
        if (windowState.floating || window.fullScreen ||
                this.isTileMode(windowState.layoutMode)) {
            return;
        }
        if (this.sameRect(window.frameGeometry, target)) return;
        windowState.internalChange = true;
        try {
            window.frameGeometry = target;
        } finally {
            windowState.internalChange = false;
        }
        this.debug(`[cc-scroll] LAYOUT reason=${reason} column=${column.id}` +
            ` physicalX=${target.x} width=${target.width}` +
            ` actual=${this.rectText(window.frameGeometry)}`);
    }

    commit(plan) {
        const transaction = plan.scrollTransaction;
        if (transaction) {
            this.debug(`[MOTION_TX] BEGIN id=${transaction.id}` +
                ` epoch=${transaction.epoch} type=${transaction.type}` +
                ` direction=${transaction.direction} delta=${transaction.deltaX}` +
                ` viewport=${this.rectText(transaction.viewport)}`);
        }
        plan.commitOrder.forEach(item => {
            const column = item.column;
            if (transaction && item.transitionRole !== "static") {
                this.debug(`[MOTION_TX] ROLE id=${transaction.id}` +
                    ` column=${column.id} role=${item.transitionRole}`);
            }
            if (item.placement === "parked" &&
                    this.isRectInsideAnyOutput(item.rect)) {
                this.warn(`[cc-scroll] invalid parking rect column=${column.id}` +
                    ` rect=${this.rectText(item.rect)}`);
            }
            if (item.placement === "parked" &&
                    !this.isWindowHidden(column.window) &&
                    this.isRectInsideAnyOutput(column.window.frameGeometry)) {
                this.rememberVisibleGeometry(
                    column.window,
                    this.rectCopy(column.window.frameGeometry)
                );
            }
            if (item.placement === "visible" &&
                    this.isWindowHidden(column.window)) {
                this.commitGeometry(column, item.rect, plan.reason);
                this.setWindowVisibility(column.window, true);
            } else {
                if (item.placement === "visible") {
                    this.setWindowVisibility(column.window, true);
                }
                this.commitGeometry(column, item.rect, plan.reason);
            }
            if (item.placement === "parked") {
                this.setWindowVisibility(column.window, false);
            }
            else this.rememberVisibleGeometry(column.window, this.rectCopy(item.rect));

            const outputName = column.window.output
                ? column.window.output.name
                : "<none>";
            if (item.placement === "visible") {
                this.debug(`[cc-scroll] PROJECT column=${column.id}` +
                    ` logicalX=${column.logicalX}` +
                    ` oldProjectedX=${item.oldProjectedRect
                        ? item.oldProjectedRect.x : "<none>"}` +
                    ` projectedX=${item.newProjectedRect.x}` +
                    ` kind=visible output=${outputName}`);
            } else {
                this.debug(`[cc-scroll] PARK column=${column.id}` +
                    ` logicalX=${column.logicalX}` +
                    ` oldProjectedX=${item.oldProjectedRect
                        ? item.oldProjectedRect.x : "<none>"}` +
                    ` projectedX=${item.newProjectedRect.x}` +
                    ` parkingX=${item.rect.x} output=${outputName}`);
            }
        });
        if (transaction) {
            this.debug(`[MOTION_TX] COMPLETE id=${transaction.id}`);
        }
    }
}

// Generated from src/kwin/runtime/RuntimeConfig.js
function loadRuntimeConfig(readValue) {
    const number = (key, fallback) =>
        Math.max(0, Number(readValue(key, fallback)) || 0);
    return {
        targetOutputName: String(readValue("TargetOutputName", "")).trim(),
        primary: {
            top: number("GapTop", 50),
            bottom: number("GapBottom", 70),
            left: number("GapLeft", 24),
            right: number("GapRight", 24),
            inner: number("InnerGap", 8),
        },
        manageSecondaryOutput: Boolean(
            readValue("ManageSecondaryOutput", true)
        ),
        secondaryOutputName: String(
            readValue("SecondaryOutputName", "HDMI-A-1")
        ).trim(),
        secondary: {
            top: number("SecondaryGapTop", 24),
            bottom: number("SecondaryGapBottom", 24),
            left: number("SecondaryGapLeft", 24),
            right: number("SecondaryGapRight", 24),
            inner: number("SecondaryInnerGap", 8),
        },
        includeDialogs: Boolean(readValue("IncludeDialogs", false)),
        debugLogging: Boolean(readValue("DebugLogging", false)),
    };
}

// Generated from src/kwin/runtime/RuntimeLogger.js
class RuntimeLogger {
    constructor(options) {
        this.tag = options.tag;
        this.enabled = Boolean(options.enabled);
        this.infoSink = options.infoSink;
        this.warnSink = options.warnSink;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
    }

    resolve(value) {
        return typeof value === "function" ? value() : String(value);
    }

    classify(message, requestedCategory) {
        if (requestedCategory) return requestedCategory;
        if (/^\[cc-adoption\]/.test(message)) return "adoption";
        if (/^\[cc-dock\]/.test(message)) return "dock";
        if (/^\[cc-presentation\]/.test(message)) return "presentation";
        if (/^\[cc-stability\].*EMERGENCY_RESTORE/.test(message)) return "recovery";
        if (/^\[cc-stability\]/.test(message)) return "stability";
        if (/^\[cc-scroll\].*(FLOAT|MANAGE|REMEMBER_FLOAT)/.test(message)) {
            return "floating";
        }
        if (/^\[cc-scroll\]/.test(message)) return "layout";
        if (/^(FULLSCREEN|NATIVE-TRANSFER)/.test(message)) return "lifecycle";
        if (/^(INVARIANT|RECOVERY|TIMEOUT|SCHEMA REJECT|QUEUE FULL)/.test(message)) {
            return "stability";
        }
        return "runtime";
    }

    stripLegacyPrefix(message) {
        return message.replace(/^\[cc-[^\]]+\]\s*/u, "");
    }

    format(category, message) {
        return `${this.tag} [${category}] ${this.stripLegacyPrefix(message)}`;
    }

    debug(value, category = "") {
        if (!this.enabled) return false;
        const message = this.resolve(value);
        this.infoSink(this.format(this.classify(message, category), message));
        return true;
    }

    warn(value, category = "") {
        const message = this.resolve(value);
        this.warnSink(this.format(this.classify(message, category), message));
        return true;
    }
}

// Generated from src/kwin/runtime/OutputTopology.js
class OutputTopology {
    constructor(options) {
        this.getScreens = options.getScreens;
        this.config = options.config;
        this.computeSafeRect = options.computeSafeRect;
        this.warn = options.warn;
        this.warnedMissingPrimary = false;
        this.warnedMissingSecondary = false;
    }

    ordered() {
        return this.getScreens().slice().sort((a, b) =>
            a.geometry.x === b.geometry.x
                ? a.geometry.y - b.geometry.y
                : a.geometry.x - b.geometry.x
        );
    }

    primary() {
        const outputs = this.ordered();
        if (!outputs.length) return null;
        if (this.config.targetOutputName) {
            const configured = outputs.find(output =>
                output.name === this.config.targetOutputName);
            if (configured) {
                this.warnedMissingPrimary = false;
                return configured;
            }
            if (!this.warnedMissingPrimary) {
                this.warn(`configured output ${this.config.targetOutputName}` +
                    " not found; using leftmost output");
                this.warnedMissingPrimary = true;
            }
        }
        return outputs[0];
    }

    secondary() {
        if (!this.config.manageSecondaryOutput) return null;
        const primary = this.primary();
        const candidates = this.ordered().filter(output => output !== primary);
        if (!candidates.length) return null;
        if (this.config.secondaryOutputName) {
            const configured = candidates.find(output =>
                output.name === this.config.secondaryOutputName);
            if (configured) {
                this.warnedMissingSecondary = false;
                return configured;
            }
            if (!this.warnedMissingSecondary) {
                this.warn(`configured secondary output ${this.config.secondaryOutputName}` +
                    " not found; using rightmost non-primary output");
                this.warnedMissingSecondary = true;
            }
        }
        return candidates[candidates.length - 1];
    }

    profile(output) {
        if (!output) return null;
        const primary = this.primary();
        if (output === primary) {
            const gaps = this.config.primary;
            return {
                role: "primary", output,
                top: gaps.top, bottom: gaps.bottom,
                left: gaps.left, right: gaps.right, inner: gaps.inner,
            };
        }
        const secondary = this.secondary();
        if (output === secondary) {
            const gaps = this.config.secondary;
            return {
                role: "secondary", output,
                top: gaps.top, bottom: gaps.bottom,
                left: gaps.left, right: gaps.right, inner: gaps.inner,
            };
        }
        return null;
    }

    managed() {
        const outputs = [this.primary(), this.secondary()].filter(Boolean);
        return outputs.filter((output, index) => outputs.indexOf(output) === index);
    }

    safeRect(output) {
        const profile = this.profile(output);
        return profile ? this.computeSafeRect(output.geometry, profile) : null;
    }
}

// Generated from src/kwin/runtime/RuntimeLifecycle.js
class RuntimeLifecycle {
    constructor(options) {
        this.workspace = options.workspace;
        this.setupWindow = options.setupWindow;
        this.onWindowAdded = options.onWindowAdded;
        this.onWindowActivated = options.onWindowActivated;
        this.onScreensChanged = options.onScreensChanged;
        this.onVirtualScreenGeometryChanged =
            options.onVirtualScreenGeometryChanged;
        this.connectManagedGeometry = options.connectManagedGeometry;
        this.initializeScrollLayout = options.initializeScrollLayout;
        this.markInitialized = options.markInitialized;
        this.registerShortcut = options.registerShortcut;
        this.shortcuts = options.shortcuts;
        this.commitInitialState = options.commitInitialState;
        this.connections = [];
        this.started = false;
        this.shortcutsRegistered = false;
    }

    connect(signal, handler) {
        if (!signal || typeof signal.connect !== "function") return;
        signal.connect(handler);
        this.connections.push({ signal, handler });
    }

    start() {
        if (this.started) return false;
        this.workspace.windowList().forEach(this.setupWindow);
        this.connect(this.workspace.windowAdded, this.onWindowAdded);
        this.connect(this.workspace.windowActivated, this.onWindowActivated);
        this.connect(this.workspace.screensChanged, this.onScreensChanged);
        this.connect(
            this.workspace.virtualScreenGeometryChanged,
            this.onVirtualScreenGeometryChanged
        );
        this.connect(this.workspace.screenOrderChanged, this.onScreensChanged);
        this.connectManagedGeometry();
        this.initializeScrollLayout();
        this.markInitialized(true);
        if (!this.shortcutsRegistered) {
            this.shortcuts.forEach(shortcut => this.registerShortcut(
                shortcut.name,
                shortcut.description,
                shortcut.defaultSequence,
                shortcut.handler
            ));
            this.shortcutsRegistered = true;
        }
        this.commitInitialState();
        this.started = true;
        return true;
    }

    stop() {
        if (!this.started) return false;
        this.connections.forEach(connection => {
            if (!connection.signal ||
                    typeof connection.signal.disconnect !== "function") return;
            try {
                connection.signal.disconnect(connection.handler);
            } catch (_error) {
                // KWin also drops script-owned connections during unload.
            }
        });
        this.connections = [];
        this.markInitialized(false);
        this.started = false;
        return true;
    }
}

// Generated from src/kwin/runtime/ShortcutCatalog.js
function createShortcutCatalog(actions) {
    return [
        {
            name: "CCScrollFocusPreviousColumn",
            description: "CC Scroll: Focus Previous Column",
            defaultSequence: "Meta+H",
            handler: actions.focusPrevious,
        },
        {
            name: "CCScrollFocusNextColumn",
            description: "CC Scroll: Focus Next Column",
            defaultSequence: "Meta+L",
            handler: actions.focusNext,
        },
        {
            name: "CCScrollToggleFocusWide",
            description: "CC Scroll: Toggle Focus Wide",
            defaultSequence: "Meta+Z",
            handler: actions.toggleWide,
        },
        {
            name: "CCScrollMoveColumnLeft",
            description: "CC Scroll: Move Column Left",
            defaultSequence: "Meta+Shift+H",
            handler: actions.moveLeft,
        },
        {
            name: "CCScrollMoveColumnRight",
            description: "CC Scroll: Move Column Right",
            defaultSequence: "Meta+Shift+L",
            handler: actions.moveRight,
        },
        {
            name: "CCScrollToggleFloating",
            description: "CC Scroll: Toggle Floating",
            defaultSequence: "Meta+Shift+Return",
            handler: actions.toggleFloating,
        },
        {
            name: "CCScrollToggleFloatingKeypad",
            description: "CC Scroll: Toggle Floating Keypad Enter",
            defaultSequence: "Meta+Shift+Enter",
            handler: actions.toggleFloating,
        },
        {
            name: "CCScrollPublishDockState",
            description: "CC Scroll: Publish Dock State",
            defaultSequence: "",
            handler: actions.publishDockState,
        },
        {
            name: "CCScrollApplyDockCommand",
            description: "CC Scroll: Apply Dock Command",
            defaultSequence: "Meta+Ctrl+Alt+Shift+F11",
            handler: actions.applyDockCommand,
        },
        {
            name: "CCScrollEmergencyRestore",
            description: "CC Scroll: Emergency Restore Parked Windows",
            defaultSequence: "Meta+Ctrl+Alt+Shift+F12",
            handler: actions.emergencyRestore,
        },
    ];
}

// Generated from src/kwin/runtime/ControllerComposition.js
class ControllerComposition {
    constructor(controllers, requiredNames) {
        const missing = requiredNames.filter(name => !controllers[name]);
        if (missing.length) {
            throw new Error(`missing runtime controllers: ${missing.join(",")}`);
        }
        this.controllers = Object.freeze(Object.assign({}, controllers));
    }

    get(name) {
        const controller = this.controllers[name];
        if (!controller) throw new Error(`unknown runtime controller: ${name}`);
        return controller;
    }

    names() {
        return Object.keys(this.controllers);
    }
}

// Generated from src/kwin/runtime/CCNiri.js
class CCNiri {
    constructor(options) {
        this.controllers = options.controllers;
        this.lifecycle = new RuntimeLifecycle(options.lifecycle);
        this.onStarted = options.onStarted || (() => {});
        this.onStopping = options.onStopping || (() => {});
    }

    start() {
        if (!this.lifecycle.start()) return false;
        this.onStarted();
        return true;
    }

    stop() {
        if (!this.lifecycle.started) return false;
        this.onStopping();
        return this.lifecycle.stop();
    }
}

// Generated from src/kwin/stability/LayoutTransaction.js
class LayoutTransaction {
    constructor(options) {
        this.audit = options.audit;
        this.debug = options.debug;
        this.depth = 0;
        this.epoch = 0;
        this.activeReason = "";
    }

    begin(reason) {
        if (this.depth === 0) {
            this.epoch += 1;
            this.activeReason = reason;
            this.debug(`[cc-stability] BEGIN epoch=${this.epoch} reason=${reason}`);
        }
        this.depth += 1;
        return this.epoch;
    }

    end(reason, epoch) {
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth !== 0) return;
        this.audit(reason, epoch);
        this.debug(`[cc-stability] END epoch=${epoch} reason=${this.activeReason}`);
        this.activeReason = "";
    }

    run(reason, callback) {
        const epoch = this.begin(reason);
        try {
            return callback(epoch);
        } finally {
            this.end(reason, epoch);
        }
    }

    isActive() {
        return this.depth > 0;
    }

    currentEpoch() {
        return this.epoch;
    }
}

// Generated from src/kwin/stability/InvariantChecker.js
class InvariantChecker {
    constructor(options) {
        this.appState = options.appState;
        this.windowStates = options.windowStates;
        this.normalizeUuid = options.normalizeUuid;
        this.stripWidth = options.stripWidth;
        this.managedPhases = new Set(options.managedPhases);
        this.normalPresentationMode = options.normalPresentationMode;
        this.debug = options.debug;
        this.warn = options.warn;
        this.lastWarning = "";
    }

    errors() {
        const errors = [];
        const columns = this.appState.columns;
        const windows = new Set();
        const uuids = new Set();
        let expectedLogicalX = 0;

        columns.forEach((column, index) => {
            const uuid = this.normalizeUuid(column.window.internalId);
            if (windows.has(column.window)) errors.push(`duplicate-window:${index}`);
            windows.add(column.window);
            if (!uuid || uuids.has(uuid)) errors.push(`duplicate-uuid:${uuid || index}`);
            uuids.add(uuid);
            if (column.logicalX !== expectedLogicalX) {
                errors.push(`logical-x:${column.id}:${column.logicalX}:${expectedLogicalX}`);
            }
            if (!Number.isFinite(column.pixelWidth) || column.pixelWidth < 1) {
                errors.push(`invalid-width:${column.id}:${column.pixelWidth}`);
            }
            const windowState = this.windowStates.get(column.window);
            const adoptionOwnsColumn = windowState &&
                this.managedPhases.has(windowState.adoptionPhase);
            if (!windowState || !windowState.managedByScrollLayout ||
                    windowState.columnId !== column.id || windowState.floating ||
                    !adoptionOwnsColumn) {
                errors.push(`state-ownership:${column.id}`);
            }
            if (this.appState.targetOutput &&
                    column.window.output !== this.appState.targetOutput) {
                errors.push(`wrong-output:${column.id}`);
            }
            expectedLogicalX += column.pixelWidth + this.appState.innerGap;
        });

        if (!columns.length) {
            if (this.appState.focusedColumnIndex !== -1) errors.push("empty-focus");
        } else if (this.appState.focusedColumnIndex < 0 ||
                this.appState.focusedColumnIndex >= columns.length) {
            errors.push(`focus-index:${this.appState.focusedColumnIndex}`);
        }

        const maximumOffset = Math.max(0, this.stripWidth() -
            (this.appState.safeRect ? this.appState.safeRect.width : 0));
        if (this.appState.scrollOffsetX < 0 ||
                this.appState.scrollOffsetX > maximumOffset) {
            errors.push(`scroll-offset:${this.appState.scrollOffsetX}:${maximumOffset}`);
        }

        const presentation = this.appState.presentation;
        if (presentation.mode === this.normalPresentationMode) {
            if (presentation.windowUuid) errors.push("normal-with-target");
        } else {
            const presentedIndex = columns.findIndex(column =>
                this.normalizeUuid(column.window.internalId) === presentation.windowUuid);
            if (presentedIndex < 0) {
                errors.push(`missing-presentation:${presentation.windowUuid}`);
            }
            if (presentedIndex >= 0 &&
                    presentedIndex !== this.appState.focusedColumnIndex) {
                errors.push(`presentation-focus:${presentedIndex}:` +
                    `${this.appState.focusedColumnIndex}`);
            }
        }
        return errors;
    }

    check(reason, epoch) {
        const errors = this.errors();
        if (!errors.length) {
            if (this.lastWarning) {
                this.debug(`[cc-stability] RECOVERED epoch=${epoch} reason=${reason}`);
            }
            this.lastWarning = "";
            return true;
        }
        const signature = errors.join(",");
        if (signature !== this.lastWarning) {
            this.warn(`[cc-stability] INVARIANT epoch=${epoch} reason=${reason}` +
                ` errors=${signature}`);
            this.lastWarning = signature;
        }
        return false;
    }
}

// Generated from src/kwin/stability/ParkingManager.js
class ParkingManager {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.getState = options.getState;
        this.refreshSafeArea = options.refreshSafeArea;
        this.getSafeRect = options.getSafeRect;
        this.debug = options.debug;
    }

    owns(window) {
        const state = this.getState(window);
        return Boolean(state && (state.scrollParkedByScript ||
            state.scrollVisuallyHidden || state.scrollParkingMinimized));
    }

    isHidden(window) {
        const state = this.getState(window);
        return Boolean(state && state.scrollVisuallyHidden);
    }

    rememberVisibleGeometry(window, rect) {
        const state = this.stateFor(window);
        state.scrollLastVisibleGeometry = rect;
    }

    setVisibility(window, visible) {
        const state = this.stateFor(window);
        if (state.scrollOriginalOpacity === null) {
            const currentOpacity = Number(window.opacity);
            state.scrollOriginalOpacity = currentOpacity > 0 ? currentOpacity : 1;
        }
        if (visible) {
            window.opacity = state.scrollOriginalOpacity;
            if (state.scrollParkingMinimized && window.minimized) {
                window.minimized = false;
            }
            state.scrollParkedByScript = false;
            state.scrollParkingMinimized = false;
            state.scrollVisuallyHidden = false;
            return;
        }
        window.opacity = 0;
        if (!window.minimized) {
            window.minimized = true;
            state.scrollParkingMinimized = true;
        }
        state.scrollParkedByScript = true;
        state.scrollVisuallyHidden = true;
    }

    recoveryRect(windowState, fallbackIndex) {
        this.refreshSafeArea();
        const safeRect = this.getSafeRect();
        if (!safeRect) return null;
        const source = windowState.scrollLastVisibleGeometry;
        if (source) {
            const width = Math.max(1, Math.min(Number(source.width), safeRect.width));
            const height = Math.max(1, Math.min(Number(source.height), safeRect.height));
            return {
                x: Math.max(safeRect.x, Math.min(Number(source.x),
                    safeRect.x + safeRect.width - width)),
                y: Math.max(safeRect.y, Math.min(Number(source.y),
                    safeRect.y + safeRect.height - height)),
                width,
                height,
            };
        }
        const cascade = Math.max(0, Number(fallbackIndex) || 0) * 24;
        const width = Math.max(1, Math.floor(safeRect.width * 0.72));
        const height = Math.max(1, Math.floor(safeRect.height * 0.82));
        return {
            x: safeRect.x + Math.min(cascade, Math.max(0, safeRect.width - width)),
            y: safeRect.y + Math.min(cascade, Math.max(0, safeRect.height - height)),
            width,
            height,
        };
    }

    release(window, reason, ensureAccessible = false, fallbackIndex = 0) {
        const state = this.getState(window);
        if (!this.owns(window)) return false;
        if (ensureAccessible) {
            const target = this.recoveryRect(state, fallbackIndex);
            if (target) {
                state.internalChange = true;
                try {
                    window.frameGeometry = target;
                } finally {
                    state.internalChange = false;
                }
            }
        }
        window.opacity = state.scrollOriginalOpacity;
        if (state.scrollParkingMinimized && window.minimized) {
            window.minimized = false;
        }
        state.scrollParkedByScript = false;
        state.scrollParkingMinimized = false;
        state.scrollVisuallyHidden = false;
        this.debug(`[cc-stability] RELEASE_PARKING caption=${window.caption}` +
            ` accessible=${ensureAccessible} reason=${reason}`);
        return true;
    }
}

// Generated from src/kwin/stability/Recovery.js
class Recovery {
    constructor(options) {
        this.appState = options.appState;
        this.windowStates = options.windowStates;
        this.parking = options.parking;
        this.indexOfWindow = options.indexOfWindow;
        this.beforeRestore = options.beforeRestore;
        this.debug = options.debug;
    }

    restoreAll(reason) {
        this.beforeRestore(reason);
        let restored = 0;
        this.appState.columns.forEach((column, index) => {
            if (this.parking.release(column.window, reason, true, index)) restored += 1;
        });
        this.windowStates.forEach((_windowState, window) => {
            if (this.indexOfWindow(window) >= 0) return;
            if (this.parking.release(window, reason, true, restored)) restored += 1;
        });
        this.debug(`[cc-stability] EMERGENCY_RESTORE count=${restored} reason=${reason}`);
        return restored;
    }
}

// Generated from src/kwin/lifecycle/AdoptionController.js
class AdoptionController {
    constructor(options) {
        this.phases = options.phases;
        this.stateFor = options.stateFor;
        this.hasState = options.hasState;
        this.indexOfWindow = options.indexOfWindow;
        this.getAppState = options.getAppState;
        this.refreshAppState = options.refreshAppState;
        this.isPlasmaShellWindow = options.isPlasmaShellWindow;
        this.isLayoutMode = options.isLayoutMode;
        this.isTileMode = options.isTileMode;
        this.detectQuickTileMode = options.detectQuickTileMode;
        this.fullMaximizeMode = options.fullMaximizeMode;
        this.scrollEligible = options.scrollEligible;
        this.adoptWindow = options.adoptWindow;
        this.settleLayout = options.settleLayout;
        this.rectText = options.rectText;
        this.debug = options.debug;
    }

    transition(window, windowState, phase, reason) {
        const previous = windowState.adoptionPhase;
        windowState.adoptionPhase = phase;
        windowState.adoptionLastEvent = reason;
        if (previous !== phase) {
            this.debug(`[cc-adoption] PHASE ${previous}->${phase}` +
                ` caption=${window.caption} reason=${reason}`);
        }
    }

    waitPhase(window, windowState) {
        const state = this.getAppState();
        if (this.isPlasmaShellWindow(window)) return this.phases.ignored;
        if (windowState.floating) return this.phases.floating;
        if (!state.enabled || !state.targetOutput ||
                window.output !== state.targetOutput) {
            return this.phases.waitingPrimary;
        }
        if (window.fullScreen || this.isLayoutMode(windowState.layoutMode) ||
                Number(window.maximizeMode) === this.fullMaximizeMode ||
                this.isTileMode(this.detectQuickTileMode(window))) {
            return this.phases.waitingNormal;
        }
        if (!this.scrollEligible(window)) return this.phases.waitingEligible;
        if (!window.active) return this.phases.waitingActivation;
        return null;
    }

    settle(window, windowState, reason) {
        const index = this.indexOfWindow(window);
        if (index < 0) {
            this.transition(window, windowState, this.phases.waitingEligible,
                `${reason}-missing-column`);
            return false;
        }
        if (!window.active) {
            this.transition(window, windowState, this.phases.managed,
                `${reason}-inactive-after-adopt`);
            return true;
        }
        const result = this.settleLayout(window, index, reason);
        if (result.settled) {
            this.transition(window, windowState, this.phases.managed, reason);
            this.debug(`[cc-scroll] ADOPT_SETTLED column=${result.column.id}` +
                ` caption=${window.caption} geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }
        this.transition(window, windowState, this.phases.settling, reason);
        this.debug(`[cc-scroll] ADOPT_PENDING column=${result.column.id}` +
            ` caption=${window.caption} actual=${this.rectText(window.frameGeometry)}` +
            ` expected=${this.rectText(result.expected)} reason=${reason}`);
        return false;
    }

    advance(window, reason) {
        if (!window || !this.hasState(window)) return false;
        const windowState = this.stateFor(window);
        if (windowState.adoptionPhase === this.phases.managed) {
            return this.indexOfWindow(window) >= 0;
        }
        if (windowState.adoptionPhase === this.phases.floating ||
                windowState.adoptionPhase === this.phases.ignored) return false;
        if (windowState.adoptionPhase === this.phases.settling &&
                this.indexOfWindow(window) >= 0) {
            return this.settle(window, windowState, reason);
        }
        if (windowState.adoptionPhase === this.phases.untracked) return false;

        this.refreshAppState();
        const waitPhase = this.waitPhase(window, windowState);
        if (waitPhase) {
            this.transition(window, windowState, waitPhase, reason);
            return false;
        }

        this.transition(window, windowState, this.phases.adopting, reason);
        windowState.adoptionAttempts += 1;
        this.transition(window, windowState, this.phases.settling, reason);
        if (!this.adoptWindow(window, reason, true)) {
            this.transition(window, windowState, this.phases.waitingEligible,
                `${reason}-adopt-rejected`);
            return false;
        }
        return this.settle(window, windowState, reason);
    }

    begin(window, origin) {
        if (!window) return false;
        const windowState = this.stateFor(window);
        if (windowState.managedByScrollLayout || this.indexOfWindow(window) >= 0) {
            this.transition(window, windowState, this.phases.managed, origin);
            return true;
        }
        if (windowState.floating) {
            this.transition(window, windowState, this.phases.floating, origin);
            return false;
        }
        windowState.adoptionOrigin = origin;
        this.transition(window, windowState, this.phases.waitingEligible, origin);
        return this.advance(window, origin);
    }

    onWindowAdded(window) {
        return this.begin(window, "window-added");
    }

    onActivated(window, reason = "window-activated-after-add") {
        return this.advance(window, reason);
    }

    onReady(window, reason = "ready-for-painting") {
        return this.advance(window, reason);
    }

    onGeometryChanged(window, reason = "pending-geometry-changed") {
        return this.advance(window, reason);
    }

    onOutputChanged(window, reason = "output-entered-primary") {
        return this.advance(window, reason);
    }

    onFullscreenChanged(window, reason = "fullscreen-exit") {
        return this.advance(window, reason);
    }
}

// Generated from src/kwin/lifecycle/FloatingController.js
class FloatingController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.hasState = options.hasState;
        this.indexOfWindow = options.indexOfWindow;
        this.getAppState = options.getAppState;
        this.refreshAppState = options.refreshAppState;
        this.scrollEligible = options.scrollEligible;
        this.prepareWindow = options.prepareWindow;
        this.adoptWindow = options.adoptWindow;
        this.removeColumn = options.removeColumn;
        this.transitionAdoption = options.transitionAdoption;
        this.floatingPhase = options.floatingPhase;
        this.settlingPhase = options.settlingPhase;
        this.managedPhase = options.managedPhase;
        this.getActiveWindow = options.getActiveWindow;
        this.setActiveWindow = options.setActiveWindow;
        this.rectText = options.rectText;
        this.debug = options.debug;
        this.warn = options.warn;
        this.now = options.now;
        this.focusGuardMs = options.focusGuardMs;
        this.rememberedWindow = null;
        this.detachedAt = 0;
        this.focusGuardUntil = 0;
    }

    detach(window, reason) {
        const index = this.indexOfWindow(window);
        if (!window || index < 0) return false;
        const windowState = this.stateFor(window);
        windowState.floating = true;
        this.transitionAdoption(window, windowState, this.floatingPhase, reason);
        this.removeColumn(window, reason, false);
        if (window.minimized) window.minimized = false;
        if (this.getActiveWindow() !== window) this.setActiveWindow(window);
        this.debug(`[cc-scroll] FLOAT caption=${window.caption}` +
            ` geometry=${this.rectText(window.frameGeometry)} reason=${reason}`);
        return true;
    }

    attach(window, reason) {
        if (!window || window.fullScreen) return false;
        this.refreshAppState();
        const appState = this.getAppState();
        if (!appState.enabled || !appState.targetOutput ||
                window.output !== appState.targetOutput ||
                !this.scrollEligible(window) || this.indexOfWindow(window) >= 0) {
            return false;
        }
        const windowState = this.stateFor(window);
        if (!this.prepareWindow(window)) {
            this.warn(`[cc-scroll] MANAGE rejected caption=${window.caption}` +
                ` reason=layout-detach-failed`);
            return false;
        }
        windowState.floating = false;
        this.transitionAdoption(window, windowState, this.settlingPhase, reason);
        if (!this.adoptWindow(window, reason, true)) {
            windowState.floating = true;
            this.transitionAdoption(
                window,
                windowState,
                this.floatingPhase,
                `${reason}-rollback`
            );
            return false;
        }
        this.transitionAdoption(window, windowState, this.managedPhase, reason);
        this.debug(`[cc-scroll] MANAGE caption=${window.caption}` +
            ` geometry=${this.rectText(window.frameGeometry)} reason=${reason}`);
        return true;
    }

    remember(window, guardFocus) {
        this.rememberedWindow = window;
        this.detachedAt = this.now();
        this.focusGuardUntil = guardFocus
            ? this.detachedAt + this.focusGuardMs
            : 0;
        this.debug(`[cc-scroll] REMEMBER_FLOAT caption=${window.caption}` +
            ` guard=${guardFocus}`);
    }

    hasRememberedFloating() {
        return Boolean(this.rememberedWindow &&
            this.hasState(this.rememberedWindow) &&
            this.stateFor(this.rememberedWindow).floating &&
            this.indexOfWindow(this.rememberedWindow) < 0);
    }

    toggle(window) {
        const rememberedFloating = this.hasRememberedFloating();
        let target = window;
        if (rememberedFloating && target !== this.rememberedWindow) {
            target = this.rememberedWindow;
        }
        if (!target) return false;
        if (this.indexOfWindow(target) >= 0) {
            if (this.detach(target, "shortcut-toggle-floating")) {
                this.remember(target, true);
                this.setActiveWindow(target);
                return true;
            }
            return false;
        }
        if (this.attach(target, "shortcut-toggle-managed") &&
                target === this.rememberedWindow) {
            this.clearRemembered();
            return true;
        }
        return false;
    }

    redirectActivation(window) {
        if (this.rememberedWindow && this.now() <= this.focusGuardUntil &&
                this.hasState(this.rememberedWindow) &&
                this.stateFor(this.rememberedWindow).floating &&
                window !== this.rememberedWindow) {
            this.setActiveWindow(this.rememberedWindow);
            return true;
        }
        if (this.now() > this.focusGuardUntil) this.focusGuardUntil = 0;
        return false;
    }

    onInteractiveMoveResize(window) {
        if (this.indexOfWindow(window) < 0) return false;
        const state = this.stateFor(window);
        state.interactiveMoveResize = true;
        if (this.detach(window, "interactive-move-resize")) {
            this.remember(window, false);
        }
        return true;
    }

    onWindowClosed(window) {
        if (window === this.rememberedWindow) this.clearRemembered();
    }

    clearRemembered() {
        this.rememberedWindow = null;
        this.detachedAt = 0;
        this.focusGuardUntil = 0;
    }
}

// Generated from src/kwin/lifecycle/OutputController.js
class OutputController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.indexOfWindow = options.indexOfWindow;
        this.resolvePrimaryOutput = options.resolvePrimaryOutput;
        this.clearPresentationForWindow = options.clearPresentationForWindow;
        this.removeColumn = options.removeColumn;
        this.transitionAdoption = options.transitionAdoption;
        this.phases = options.phases;
        this.profileForOutput = options.profileForOutput;
        this.translateRestoreGeometry = options.translateRestoreGeometry;
        this.fullMaximizeMode = options.fullMaximizeMode;
        this.maximizeMode = options.maximizeMode;
        this.applyLayoutGeometry = options.applyLayoutGeometry;
        this.detectQuickTileMode = options.detectQuickTileMode;
        this.isTileMode = options.isTileMode;
        this.applyDetectedTile = options.applyDetectedTile;
        this.beginAdoption = options.beginAdoption;
        this.advanceAdoption = options.advanceAdoption;
        this.setLayoutMode = options.setLayoutMode;
        this.rectText = options.rectText;
        this.debug = options.debug;
    }

    onOutputChanged(window) {
        const state = this.stateFor(window);
        if (state.internalChange || state.interactiveMoveResize || window.fullScreen) {
            return false;
        }

        const primary = this.resolvePrimaryOutput();
        if (this.indexOfWindow(window) >= 0 && window.output !== primary) {
            this.clearPresentationForWindow(window);
            this.removeColumn(window, "output-left-primary", false);
            this.transitionAdoption(
                window,
                state,
                this.phases.waitingPrimary,
                "output-left-primary"
            );
            this.debug(`[cc-scroll] LEAVE_PRIMARY caption=${window.caption}` +
                ` output=${this.outputName(window.output)}`);
            return true;
        }

        if (window.output !== primary &&
                state.adoptionPhase !== this.phases.untracked &&
                state.adoptionPhase !== this.phases.floating &&
                state.adoptionPhase !== this.phases.ignored) {
            this.transitionAdoption(
                window,
                state,
                this.phases.waitingPrimary,
                "output-wait-primary"
            );
        }

        const profile = this.profileForOutput(window.output);
        this.translateRestoreGeometry(state, window.output);
        if (profile) {
            if (Number(window.maximizeMode) === this.fullMaximizeMode ||
                    state.layoutMode === this.maximizeMode) {
                this.applyLayoutGeometry(
                    window,
                    state,
                    this.maximizeMode,
                    "output-adopt-maximize"
                );
            } else if (this.isTileMode(this.detectQuickTileMode(window))) {
                this.applyDetectedTile(window, "output-adopt-tile");
            } else if (window.output === primary) {
                if (state.adoptionPhase === this.phases.untracked) {
                    this.beginAdoption(window, "output-entered-primary");
                } else {
                    this.advanceAdoption(window, "output-entered-primary");
                }
            }
            return true;
        }

        if (state.layoutMode === this.maximizeMode &&
                Number(window.maximizeMode) !== this.fullMaximizeMode) {
            state.internalChange = true;
            try {
                window.setMaximize(true, true);
            } finally {
                state.internalChange = false;
            }
            this.debug(`NATIVE-TRANSFER ${window.caption} mode=maximize` +
                ` output=${this.outputName(window.output)}` +
                ` geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }

        const tileMode = this.detectQuickTileMode(window);
        if (this.isTileMode(tileMode)) {
            this.setLayoutMode(state, tileMode);
            this.debug(`NATIVE-TRANSFER ${window.caption} mode=${tileMode}` +
                ` output=${this.outputName(window.output)}` +
                ` geometry=${this.rectText(window.frameGeometry)}`);
            return true;
        }
        return false;
    }

    outputName(output) {
        return output ? output.name : "<none>";
    }
}

// Generated from src/kwin/lifecycle/FullscreenController.js
class FullscreenController {
    constructor(options) {
        this.stateFor = options.stateFor;
        this.indexOfWindow = options.indexOfWindow;
        this.relayout = options.relayout;
        this.onManagedOutput = options.onManagedOutput;
        this.isLayoutMode = options.isLayoutMode;
        this.applyLayoutGeometry = options.applyLayoutGeometry;
        this.advanceAdoption = options.advanceAdoption;
        this.normalMode = options.normalMode;
        this.debug = options.debug;
    }

    onFullscreenChanged(window) {
        const state = this.stateFor(window);
        if (state.internalChange) return false;

        if (window.fullScreen) {
            state.layoutModeBeforeFullscreen = state.layoutMode;
            this.debug(`FULLSCREEN enter ${window.caption} prior=${state.layoutMode}`);
            return true;
        }

        const prior = state.layoutModeBeforeFullscreen;
        state.layoutModeBeforeFullscreen = this.normalMode;
        if (this.indexOfWindow(window) >= 0) {
            this.relayout("fullscreen-exit");
        } else if (this.onManagedOutput(window) && this.isLayoutMode(prior)) {
            this.applyLayoutGeometry(window, state, prior, "fullscreen-exit");
        } else {
            this.advanceAdoption(window, "fullscreen-exit");
        }
        return true;
    }
}

// Generated from src/kwin/integration/DockGateway.js
class DockGateway {
    constructor(options) {
        this.invoke = options.invoke;
        this.service = options.service;
        this.path = options.path;
        this.interfaceName = options.interfaceName;
        this.snapshotProvider = options.snapshotProvider;
        this.handlers = options.handlers;
        this.debug = options.debug;
        this.warn = options.warn;
        this.protocol = options.protocol || 1;
        this.sessionIdValue = options.sessionId ||
            `${options.now().toString(16)}-` +
            `${Math.floor(options.random() * 0x100000000).toString(16)}`;
        this.generationValue = 0;
    }

    sessionId() {
        return this.sessionIdValue;
    }

    generation() {
        return this.generationValue;
    }

    envelopeSnapshot(snapshot) {
        return Object.assign({}, snapshot, {
            protocol: this.protocol,
            sessionId: this.sessionIdValue,
            generation: this.generationValue,
        });
    }

    publish(snapshot, reason) {
        const envelope = this.envelopeSnapshot(snapshot);
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "PublishState",
            JSON.stringify(envelope),
            accepted => this.debug(`[cc-dock] PUBLISH reason=${reason}` +
                ` generation=${this.generationValue}` +
                ` columns=${envelope.columns.length} accepted=${accepted}`)
        );
        return envelope;
    }

    commit(snapshot, reason) {
        this.generationValue += 1;
        return this.publish(snapshot, reason);
    }

    reject(command, reason) {
        this.warn(`[cc-dock] REJECT reason=${reason}`);
        return this.publish(this.snapshotProvider(), `reject-${reason}`);
    }

    commandEnvelope(command) {
        const baseGeneration = command.baseGeneration === undefined
            ? this.generationValue
            : command.baseGeneration;
        return Object.assign({}, command, {
            protocol: this.protocol,
            sessionId: this.sessionIdValue,
            baseGeneration,
        });
    }

    requestDeferred(command, delayMs, callback) {
        const envelope = this.commandEnvelope(command);
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "RequestDeferredCommand",
            JSON.stringify(envelope),
            delayMs,
            callback
        );
        return envelope;
    }

    validEnvelope(command) {
        return Boolean(command && command.protocol === this.protocol &&
            command.commandId && Object.prototype.hasOwnProperty.call(
                this.handlers,
                command.type
            ));
    }

    dispatch(command) {
        if (!this.validEnvelope(command)) {
            this.reject(command, "invalid-schema");
            return false;
        }
        if (String(command.sessionId) !== this.sessionIdValue) {
            this.reject(command, "session-mismatch");
            return false;
        }
        if (Number(command.baseGeneration) !== this.generationValue) {
            this.reject(command, "stale-generation");
            return false;
        }
        return this.handlers[command.type](command) !== false;
    }

    acceptPendingJson(json) {
        if (!json) return false;
        let command;
        try {
            command = JSON.parse(String(json));
        } catch (error) {
            this.reject(null, "invalid-json");
            return false;
        }
        return this.dispatch(command);
    }

    takePendingCommand() {
        this.invoke(
            this.service,
            this.path,
            this.interfaceName,
            "TakePendingCommand",
            json => this.acceptPendingJson(json)
        );
    }
}

// Generated from src/kwin/presentation/PresentationController.js
class PresentationController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.stateFor = options.stateFor;
        this.setLayoutMode = options.setLayoutMode;
        this.modes = options.modes;
        this.normalLayoutMode = options.normalLayoutMode;
        this.maximizeLayoutMode = options.maximizeLayoutMode;
        this.wideRatio = options.wideRatio;
        this.rectCopy = options.rectCopy;
        this.cancelPendingDockScroll = options.cancelPendingDockScroll;
        this.cancelPendingWideTransition = options.cancelPendingWideTransition;
        this.focusColumn = options.focusColumn;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.ensureColumnVisible = options.ensureColumnVisible;
        this.relayout = options.relayout;
        this.getActiveWindow = options.getActiveWindow;
        this.setActiveWindow = options.setActiveWindow;
        this.commitDockState = options.commitDockState;
        this.debug = options.debug;
    }

    isMode(mode) {
        return mode === this.modes.normal || mode === this.modes.wide ||
            mode === this.modes.maximized;
    }

    column() {
        const appState = this.getAppState();
        if (appState.presentation.mode === this.modes.normal ||
                !appState.presentation.windowUuid) return null;
        return appState.columns.find(column =>
            this.normalizeUuid(column.window.internalId) ===
                appState.presentation.windowUuid) || null;
    }

    wideRect() {
        const safeRect = this.getAppState().safeRect;
        const width = Math.max(1, Math.min(
            safeRect.width,
            Math.round(safeRect.width * this.wideRatio)
        ));
        return {
            x: safeRect.x + Math.floor((safeRect.width - width) / 2),
            y: safeRect.y,
            width,
            height: safeRect.height,
        };
    }

    rect() {
        const appState = this.getAppState();
        return appState.presentation.mode === this.modes.wide
            ? this.wideRect()
            : this.rectCopy(appState.safeRect);
    }

    resetPresentedWindowLayoutState() {
        const column = this.column();
        if (!column) return false;
        const windowState = this.stateFor(column.window);
        if (windowState.layoutMode !== this.maximizeLayoutMode) return false;
        this.setLayoutMode(windowState, this.normalLayoutMode);
        windowState.pendingAction = null;
        return true;
    }

    clear() {
        const appState = this.getAppState();
        this.resetPresentedWindowLayoutState();
        appState.presentation.windowUuid = null;
        appState.presentation.mode = this.modes.normal;
    }

    selectPersistent(column) {
        const appState = this.getAppState();
        const oldWindowUuid = appState.presentation.windowUuid;
        const oldMode = appState.presentation.mode;
        this.clear();
        if (column && column.persistentWide) {
            appState.presentation.windowUuid =
                this.normalizeUuid(column.window.internalId);
            appState.presentation.mode = this.modes.wide;
        }
        return oldWindowUuid !== appState.presentation.windowUuid ||
            oldMode !== appState.presentation.mode;
    }

    setMode(windowUuid, mode, reason) {
        if (!this.isMode(mode)) return false;
        const appState = this.getAppState();
        const normalizedUuid = this.normalizeUuid(windowUuid);
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === normalizedUuid);
        if (!column || column.window.output !== appState.targetOutput) return false;

        this.cancelPendingDockScroll(reason);
        this.cancelPendingWideTransition(reason);
        this.resetPresentedWindowLayoutState();

        const oldScrollOffsetX = appState.scrollOffsetX;
        this.focusColumn(column);
        this.recomputeLogicalLayout();
        this.ensureColumnVisible(column);

        const targetState = this.stateFor(column.window);
        targetState.internalChange = true;
        try {
            column.window.setMaximize(false, false);
        } finally {
            targetState.internalChange = false;
        }

        if (mode === this.modes.normal) {
            column.persistentWide = false;
            appState.presentation.windowUuid = null;
            appState.presentation.mode = this.modes.normal;
        } else {
            if (mode === this.modes.wide) column.persistentWide = true;
            appState.presentation.windowUuid = normalizedUuid;
            appState.presentation.mode = mode;
            if (mode === this.modes.maximized) {
                targetState.internalChange = true;
                try {
                    this.setLayoutMode(targetState, this.maximizeLayoutMode);
                    targetState.pendingAction = null;
                } finally {
                    targetState.internalChange = false;
                }
            }
        }

        this.relayout(reason, {
            oldScrollOffsetX,
            newScrollOffsetX: appState.scrollOffsetX,
        });
        if (this.getActiveWindow() !== column.window) {
            this.setActiveWindow(column.window);
        }
        this.debug(`[cc-presentation] SET mode=${mode} uuid=${normalizedUuid}` +
            ` reason=${reason}`);
        this.commitDockState(reason);
        return true;
    }
}

// Generated from src/kwin/presentation/WideTransition.js
class WideTransition {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.phases = options.phases;
        this.normalPresentationMode = options.normalPresentationMode;
        this.widePresentationMode = options.widePresentationMode;
        this.timings = options.timings;
        this.maxGeometryAttempts = options.maxGeometryAttempts;
        this.getDockGeneration = options.getDockGeneration;
        this.getDockSessionId = options.getDockSessionId;
        this.requestDeferred = options.requestDeferred;
        this.relayout = options.relayout;
        this.commitDockState = options.commitDockState;
        this.presentationRect = options.presentationRect;
        this.sameRectNear = options.sameRectNear;
        this.clearPresentation = options.clearPresentation;
        this.selectPersistentPresentation = options.selectPersistentPresentation;
        this.setColumnVisibility = options.setColumnVisibility;
        this.applyColumnGeometry = options.applyColumnGeometry;
        this.isFullyVisible = options.isFullyVisible;
        this.projectedRectForColumn = options.projectedRectForColumn;
        this.rectText = options.rectText;
        this.debug = options.debug;
        this.warn = options.warn;
        this.pendingTransition = null;
        this.nextToken = 1;
    }

    pending() {
        return this.pendingTransition;
    }

    cancel() {
        const hadPending = Boolean(this.pendingTransition);
        this.pendingTransition = null;
        return hadPending;
    }

    matchesWindow(windowUuid) {
        return Boolean(this.pendingTransition &&
            this.pendingTransition.windowUuid === this.normalizeUuid(windowUuid));
    }

    pendingColumn(pending = this.pendingTransition) {
        if (!pending) return null;
        const appState = this.getAppState();
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === pending.windowUuid);
        if (!column || !column.persistentWide ||
                appState.columns.indexOf(column) !== appState.focusedColumnIndex ||
                column.window.output !== appState.targetOutput) {
            return null;
        }
        return column;
    }

    finalize(column) {
        const pending = this.pendingTransition;
        if (!pending || pending.phase !== this.phases.animating ||
                !column || this.pendingColumn(pending) !== column) {
            return false;
        }
        this.pendingTransition = null;
        const offset = this.getAppState().scrollOffsetX;
        this.relayout(`${pending.reason}-finalize-wide`, {
            oldScrollOffsetX: offset,
            newScrollOffsetX: offset,
        });
        this.commitDockState(`${pending.reason}-finalize-wide`);
        this.debug(`[cc-presentation] DEFERRED_WIDE_COMPLETE token=${pending.token}` +
            ` uuid=${pending.windowUuid}`);
        return true;
    }

    finalizeCommand(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingTransition;
        if (!pending || token !== pending.token ||
                pending.phase !== this.phases.animating) {
            return false;
        }
        const column = this.pendingColumn(pending);
        if (!column ||
                !this.sameRectNear(column.window.frameGeometry, this.presentationRect())) {
            this.pendingTransition = null;
            this.debug(`[cc-presentation] DEFERRED_WIDE_FINALIZE_CANCEL token=${token}`);
            return false;
        }
        return this.finalize(column);
    }

    acknowledgeGeometry(column) {
        const pending = this.pendingTransition;
        if (!pending || pending.phase !== this.phases.expanding ||
                this.pendingColumn(pending) !== column ||
                !this.sameRectNear(column.window.frameGeometry, this.presentationRect())) {
            return false;
        }
        pending.phase = this.phases.animating;
        /* The 72% client geometry is authoritative now. Park every neighbor in
         * the same acknowledgement turn instead of leaving a 50% window visible
         * underneath the expanding target for the paint-animation duration. */
        const offset = this.getAppState().scrollOffsetX;
        this.relayout(`${pending.reason}-park-wide-neighbors`, {
            oldScrollOffsetX: offset,
            newScrollOffsetX: offset,
        });
        this.requestStage(
            "finalize-wide-transition",
            pending,
            this.getDockGeneration(),
            this.timings.expansion
        );
        this.debug(`[cc-presentation] DEFERRED_WIDE_ACK token=${pending.token}` +
            ` actual=${this.rectText(column.window.frameGeometry)}` +
            ` animation=${this.timings.expansion}`);
        return true;
    }

    checkGeometry(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingTransition;
        if (!pending || token !== pending.token ||
                pending.phase !== this.phases.expanding) {
            return false;
        }
        const column = this.pendingColumn(pending);
        if (!column) {
            this.pendingTransition = null;
            return false;
        }
        const target = this.presentationRect();
        if (this.sameRectNear(column.window.frameGeometry, target)) {
            return this.acknowledgeGeometry(column);
        }
        if (pending.geometryAttempts >= this.maxGeometryAttempts) {
            this.warn(`[cc-presentation] WIDE_GEOMETRY_TIMEOUT token=${token}` +
                ` actual=${this.rectText(column.window.frameGeometry)}`);
            this.pendingTransition = null;
            this.clearPresentation();
            const offset = this.getAppState().scrollOffsetX;
            this.relayout(`${pending.reason}-wide-timeout`, {
                oldScrollOffsetX: offset,
                newScrollOffsetX: offset,
            });
            return false;
        }
        pending.geometryAttempts += 1;
        this.applyColumnGeometry(column, target, `${pending.reason}-retry-wide`);
        this.requestStage(
            "check-wide-transition",
            pending,
            this.getDockGeneration(),
            this.timings.geometryRetry
        );
        return true;
    }

    beginExpansion(pending, column, reason) {
        if (!pending || !column || this.pendingTransition !== pending ||
                this.pendingColumn(pending) !== column) return false;
        pending.reason = reason || pending.reason;
        this.selectPersistentPresentation(column);
        pending.phase = this.phases.expanding;
        pending.geometryAttempts = 1;
        const target = this.presentationRect();
        /* Wayland clients may acknowledge frameGeometry asynchronously. Keep the
         * normal-pair neighbor visible only until the target really reaches 72%;
         * acknowledgeGeometry parks it before the paint animation. */
        this.setColumnVisibility(column, true);
        this.applyColumnGeometry(column, target, `${pending.reason}-request-wide`);
        this.debug(`[cc-presentation] DEFERRED_WIDE_REQUEST token=${pending.token}` +
            ` requested=${this.rectText(target)}` +
            ` actual=${this.rectText(column.window.frameGeometry)}`);
        if (this.sameRectNear(column.window.frameGeometry, target)) {
            this.acknowledgeGeometry(column);
        } else {
            this.requestStage(
                "check-wide-transition",
                pending,
                this.getDockGeneration(),
                this.timings.geometryRetry
            );
        }
        return true;
    }

    complete(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingTransition;
        if (!pending || token !== pending.token ||
                pending.phase !== this.phases.settled) {
            return false;
        }
        const column = this.pendingColumn(pending);
        if (!column) {
            this.pendingTransition = null;
            this.debug(`[cc-presentation] DEFERRED_WIDE_CANCEL token=${token}`);
            return false;
        }
        return this.beginExpansion(pending, column, pending.reason);
    }

    requestStage(type, pending, baseGeneration, delayMs) {
        const sessionId = this.getDockSessionId();
        const command = {
            protocol: 1,
            commandId: `${sessionId}-wide-${pending.token}-${type}-` +
                `${pending.deferredSequence++}`,
            sessionId,
            baseGeneration,
            type,
            transitionToken: pending.token,
            windowUuid: pending.windowUuid,
        };
        this.requestDeferred(command, delayMs, accepted => {
            if (accepted) return;
            this.debug(`[cc-presentation] DEFERRED_WIDE_FALLBACK` +
                ` token=${pending.token} type=${type}`);
            if (type === "settle-wide-transition") {
                this.settle(command);
            } else if (type === "check-wide-transition") {
                this.checkGeometry(command);
            } else if (type === "finalize-wide-transition") {
                this.finalizeCommand(command);
            } else {
                this.complete(command);
            }
        });
    }

    settle(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingTransition;
        if (!pending || token !== pending.token ||
                pending.phase !== this.phases.scrolling) {
            return false;
        }
        const appState = this.getAppState();
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === pending.windowUuid);
        if (!column || !column.persistentWide ||
                appState.columns.indexOf(column) !== appState.focusedColumnIndex ||
                column.window.output !== appState.targetOutput ||
                appState.presentation.mode !== this.normalPresentationMode) {
            this.pendingTransition = null;
            this.debug(`[cc-presentation] DEFERRED_PAIR_CANCEL token=${token}`);
            return false;
        }

        /* Reassert the normal layout after the movement phase. This restores both
         * members of the destination pair even if an activation/minimize signal
         * raced with the initial reveal. No presentation window is selected yet. */
        this.relayout(`${pending.reason}-settle-pair`, {
            oldScrollOffsetX: appState.scrollOffsetX,
            newScrollOffsetX: appState.scrollOffsetX,
        });
        pending.phase = this.phases.settled;
        pending.revealWindowUuids = appState.columns
            .filter(item => this.isFullyVisible(this.projectedRectForColumn(item)))
            .map(item => this.normalizeUuid(item.window.internalId));
        this.requestStage(
            "complete-wide-transition",
            pending,
            Number(command.baseGeneration),
            this.timings.pairHold
        );
        this.debug(`[cc-presentation] DEFERRED_PAIR_SETTLED token=${token}` +
            ` visible=${pending.revealWindowUuids.join(",")}` +
            ` hold=${this.timings.pairHold}`);
        return true;
    }

    schedule(column, reason, baseGeneration) {
        const token = String(this.nextToken++);
        const appState = this.getAppState();
        const windowUuid = this.normalizeUuid(column.window.internalId);
        const revealWindowUuids = appState.columns
            .filter(item => this.isFullyVisible(this.projectedRectForColumn(item)))
            .map(item => this.normalizeUuid(item.window.internalId));
        this.pendingTransition = {
            token,
            windowUuid,
            reason,
            phase: this.phases.scrolling,
            revealWindowUuids,
            deferredSequence: 1,
        };
        this.requestStage(
            "settle-wide-transition",
            this.pendingTransition,
            baseGeneration,
            this.timings.scroll
        );
        this.debug(`[cc-presentation] DEFERRED_WIDE_SCHEDULE token=${token}` +
            ` uuid=${windowUuid} phase=${this.phases.scrolling}` +
            ` visible=${revealWindowUuids.join(",")}` +
            ` delay=${this.timings.scroll}`);
    }

    armStep(column, reason, direction) {
        const token = String(this.nextToken++);
        const windowUuid = this.normalizeUuid(column.window.internalId);
        this.pendingTransition = {
            token,
            windowUuid,
            reason,
            phase: this.phases.awaitingStep,
            entryDirection: direction,
            deferredSequence: 1,
        };
        this.debug(`[cc-presentation] WIDE_STEP_ARM token=${token}` +
            ` uuid=${windowUuid} direction=${direction}`);
    }

    beginStepIfPending(column, direction, reason) {
        const pending = this.pendingTransition;
        if (!column || !column.persistentWide || !pending ||
                pending.phase !== this.phases.awaitingStep ||
                pending.windowUuid !==
                    this.normalizeUuid(column.window.internalId) ||
                pending.entryDirection !== direction) {
            return false;
        }
        return this.beginExpansion(pending, column, reason);
    }

    onGeometryChanged(window) {
        const pending = this.pendingTransition;
        if (!pending || pending.phase !== this.phases.expanding ||
                pending.windowUuid !== this.normalizeUuid(window.internalId) ||
                !this.sameRectNear(window.frameGeometry, this.presentationRect())) {
            return false;
        }
        this.acknowledgeGeometry(this.pendingColumn(pending));
        return true;
    }

    transitionFocused(column, reason, oldScrollOffsetX,
            newScrollOffsetX, wideStepDirection = 0) {
        const appState = this.getAppState();
        const oldWindowUuid = appState.presentation.windowUuid;
        const oldMode = appState.presentation.mode;
        const columnUuid = column
            ? this.normalizeUuid(column.window.internalId)
            : null;
        const alreadySelectedWide = Boolean(column && column.persistentWide &&
            oldMode === this.widePresentationMode && oldWindowUuid === columnUuid);
        if (this.pendingTransition &&
                this.pendingTransition.windowUuid !== columnUuid) {
            this.debug(`[cc-presentation] DEFERRED_WIDE_SUPERSEDE` +
                ` token=${this.pendingTransition.token} reason=${reason}`);
            this.pendingTransition = null;
        }
        if (this.pendingTransition &&
                this.pendingTransition.windowUuid === columnUuid &&
                column && column.persistentWide && !alreadySelectedWide) {
            this.debug(`[cc-presentation] DEFERRED_WIDE_REUSE` +
                ` token=${this.pendingTransition.token} reason=${reason}`);
            return oldWindowUuid !== appState.presentation.windowUuid ||
                oldMode !== appState.presentation.mode;
        }

        if (column && column.persistentWide && !alreadySelectedWide) {
            /* KWin cannot paint between two synchronous geometry commits. Reveal
             * the real 50% slot now, then request the 72% commit after scrolling. */
            this.clearPresentation();
            this.relayout(`${reason}-reveal-wide`, {
                oldScrollOffsetX,
                newScrollOffsetX,
            });
            if (wideStepDirection !== 0) {
                this.armStep(column, reason, wideStepDirection);
            } else {
                const presentationChangedNow = oldWindowUuid !==
                        appState.presentation.windowUuid ||
                    oldMode !== appState.presentation.mode;
                this.schedule(
                    column,
                    reason,
                    this.getDockGeneration() + (presentationChangedNow ? 1 : 0)
                );
            }
        } else {
            this.selectPersistentPresentation(column);
            this.relayout(reason, { oldScrollOffsetX, newScrollOffsetX });
        }

        return oldWindowUuid !== appState.presentation.windowUuid ||
            oldMode !== appState.presentation.mode;
    }
}

// Generated from src/kwin/navigation/DockScrollController.js
class DockScrollController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.clampScrollOffset = options.clampScrollOffset;
        this.stripWidth = options.stripWidth;
        this.isFullyVisible = options.isFullyVisible;
        this.projectedRectForColumn = options.projectedRectForColumn;
        this.requestDeferred = options.requestDeferred;
        this.getSessionId = options.getSessionId;
        this.stepMs = options.stepMs;
        this.cancelWideTransition = options.cancelWideTransition;
        this.clearPresentation = options.clearPresentation;
        this.normalPresentationMode = options.normalPresentationMode;
        this.commitDockState = options.commitDockState;
        this.publishDockState = options.publishDockState;
        this.focusIndex = options.focusIndex;
        this.transitionFocused = options.transitionFocused;
        this.setActiveWindow = options.setActiveWindow;
        this.relayout = options.relayout;
        this.debug = options.debug;
        this.pendingScroll = null;
        this.nextToken = 1;
    }

    pending() {
        return this.pendingScroll;
    }

    hasPending() {
        return Boolean(this.pendingScroll);
    }

    cancel(reason) {
        if (!this.pendingScroll) return false;
        this.debug(`[cc-dock] SCROLL_CANCEL token=${this.pendingScroll.token}` +
            ` reason=${reason}`);
        this.pendingScroll = null;
        return true;
    }

    boundedOffset(offset) {
        const appState = this.getAppState();
        const viewportWidth = appState.safeRect ? appState.safeRect.width : 0;
        const maximum = Math.max(0, this.stripWidth() - viewportWidth);
        return Math.max(0, Math.min(Number(offset) || 0, maximum));
    }

    offsetsToTarget(column) {
        const appState = this.getAppState();
        if (!column || !appState.safeRect) return [];
        this.recomputeLogicalLayout();
        this.clampScrollOffset();
        if (this.isFullyVisible(this.projectedRectForColumn(column))) return [];

        const currentOffset = appState.scrollOffsetX;
        const targetOffset = this.boundedOffset(
            column.logicalX + column.pixelWidth - appState.safeRect.width
        );
        if (targetOffset === currentOffset) return [];

        const direction = targetOffset > currentOffset ? 1 : -1;
        const offsets = [];
        const seen = new Set();
        appState.columns.forEach(item => {
            const offset = this.boundedOffset(
                item.logicalX + item.pixelWidth - appState.safeRect.width
            );
            const between = direction > 0
                ? offset > currentOffset && offset <= targetOffset
                : offset < currentOffset && offset >= targetOffset;
            if (!between || seen.has(offset)) return;
            seen.add(offset);
            offsets.push(offset);
        });
        if (!seen.has(targetOffset)) offsets.push(targetOffset);
        offsets.sort((left, right) =>
            direction > 0 ? left - right : right - left);
        return offsets;
    }

    requestStep(pending) {
        const command = {
            commandId: `${this.getSessionId()}-dock-scroll-${pending.token}-` +
                `${pending.deferredSequence++}`,
            type: "advance-dock-scroll",
            transitionToken: pending.token,
            windowUuid: pending.windowUuid,
        };
        this.requestDeferred(command, this.stepMs, accepted => {
            if (accepted) return;
            this.debug(`[cc-dock] SCROLL_DEFER_FALLBACK token=${pending.token}`);
            this.advance(command);
        });
    }

    finish(pending, column) {
        const appState = this.getAppState();
        if (!pending || this.pendingScroll !== pending || !column) return false;
        const index = appState.columns.indexOf(column);
        if (index < 0 || column.window.output !== appState.targetOutput) {
            this.cancel("finish-target-missing");
            return false;
        }

        this.pendingScroll = null;
        const offset = appState.scrollOffsetX;
        this.focusIndex(index);
        const presentationChanged = this.transitionFocused(
            column,
            `${pending.reason}-arrive`,
            offset,
            offset
        );
        if (column.window.minimized) column.window.minimized = false;
        this.setActiveWindow(column.window);
        this.debug(`[cc-dock] SCROLL_COMPLETE token=${pending.token}` +
            ` index=${index} offset=${offset} caption=${column.window.caption}`);
        if (presentationChanged) {
            this.commitDockState(`${pending.reason}-presentation`);
        } else {
            this.publishDockState(pending.reason);
        }
        return true;
    }

    advance(command) {
        const token = String(command.transitionToken || "");
        const pending = this.pendingScroll;
        if (!pending || token !== pending.token ||
                this.normalizeUuid(command.windowUuid) !== pending.windowUuid) {
            return false;
        }
        const appState = this.getAppState();
        const column = appState.columns.find(item =>
            this.normalizeUuid(item.window.internalId) === pending.windowUuid);
        if (!column || column.window.output !== appState.targetOutput) {
            this.cancel("advance-target-missing");
            return false;
        }
        if (!pending.offsets.length) return this.finish(pending, column);

        const oldScrollOffsetX = appState.scrollOffsetX;
        appState.scrollOffsetX = pending.offsets.shift();
        this.clampScrollOffset();
        const newScrollOffsetX = appState.scrollOffsetX;
        this.relayout(`${pending.reason}-step`, {
            oldScrollOffsetX,
            newScrollOffsetX,
        });
        this.debug(`[cc-dock] SCROLL_STEP token=${pending.token}` +
            ` old=${oldScrollOffsetX} new=${newScrollOffsetX}` +
            ` remaining=${pending.offsets.length}`);
        if (pending.offsets.length) this.requestStep(pending);
        else this.finish(pending, column);
        return true;
    }

    begin(column, reason) {
        const appState = this.getAppState();
        if (!column || !appState.safeRect) return false;
        this.cancel("superseded-by-dock-click");
        this.cancelWideTransition("superseded-by-dock-click");
        const offsets = this.offsetsToTarget(column);

        if (offsets.length &&
                appState.presentation.mode !== this.normalPresentationMode) {
            this.clearPresentation();
            this.commitDockState(`${reason}-clear-presentation`);
        }

        const pending = {
            token: String(this.nextToken++),
            windowUuid: this.normalizeUuid(column.window.internalId),
            reason,
            offsets,
            deferredSequence: 1,
        };
        this.pendingScroll = pending;
        this.debug(`[cc-dock] SCROLL_BEGIN token=${pending.token}` +
            ` target=${pending.windowUuid}` +
            ` steps=${offsets.join(",") || "focus-only"}`);
        if (!offsets.length) return this.finish(pending, column);
        return this.advance({
            transitionToken: pending.token,
            windowUuid: pending.windowUuid,
        });
    }
}

// Generated from src/kwin/navigation/ReorderController.js
class ReorderController {
    constructor(options) {
        this.getAppState = options.getAppState;
        this.normalizeUuid = options.normalizeUuid;
        this.rejectDockCommand = options.rejectDockCommand;
        this.cancelDockScroll = options.cancelDockScroll;
        this.getFocusedColumn = options.getFocusedColumn;
        this.reorderColumns = options.reorderColumns;
        this.recomputeLogicalLayout = options.recomputeLogicalLayout;
        this.ensureColumnVisible = options.ensureColumnVisible;
        this.relayout = options.relayout;
        this.getGeneration = options.getGeneration;
        this.commitDockState = options.commitDockState;
        this.getActiveWindow = options.getActiveWindow;
        this.indexOfWindow = options.indexOfWindow;
        this.focusIndex = options.focusIndex;
        this.focusedIndex = options.focusedIndex;
        this.moveFocusedColumn = options.moveFocusedColumn;
        this.debug = options.debug;
    }

    applyDockCommand(command) {
        if (!Array.isArray(command.order)) {
            this.rejectDockCommand("invalid-column-order");
            return false;
        }
        const appState = this.getAppState();
        const requested = command.order.map(value => this.normalizeUuid(value));
        const current = appState.columns.map(column =>
            this.normalizeUuid(column.window.internalId));
        const requestedSet = new Set(requested);
        const currentSet = new Set(current);
        if (requested.length !== current.length ||
                requestedSet.size !== requested.length ||
                requested.some(uuid => !uuid || !currentSet.has(uuid))) {
            this.rejectDockCommand("invalid-column-set");
            return false;
        }

        const columnsByUuid = new Map(appState.columns.map(column => [
            this.normalizeUuid(column.window.internalId),
            column,
        ]));
        this.cancelDockScroll("dock-reorder");
        const focusedColumn = this.getFocusedColumn();
        const oldScrollOffsetX = appState.scrollOffsetX;
        this.reorderColumns(requested.map(uuid => columnsByUuid.get(uuid)));
        this.recomputeLogicalLayout();
        if (focusedColumn) this.ensureColumnVisible(focusedColumn);
        const newScrollOffsetX = appState.scrollOffsetX;
        this.relayout("dock-reorder", {
            oldScrollOffsetX,
            newScrollOffsetX,
        });
        this.debug(`[cc-dock] APPLY command=${command.commandId}` +
            ` generation=${this.getGeneration()} columns=${requested.length}`);
        this.commitDockState("dock-reorder");
        return true;
    }

    moveFocused(delta) {
        const appState = this.getAppState();
        const columns = appState.columns;
        if (!appState.enabled || columns.length < 2) return false;
        const reason = delta < 0 ? "move-column-left" : "move-column-right";
        this.cancelDockScroll(reason);
        const activeIndex = this.indexOfWindow(this.getActiveWindow());
        if (activeIndex >= 0) this.focusIndex(activeIndex);
        const oldIndex = this.focusedIndex();
        if (oldIndex < 0 || oldIndex >= columns.length) return false;
        const nextIndex = Math.max(0, Math.min(
            columns.length - 1,
            oldIndex + delta
        ));
        if (nextIndex === oldIndex) return false;

        const movement = this.moveFocusedColumn(delta);
        if (!movement) return false;
        const focusedColumn = movement.column;
        this.recomputeLogicalLayout();
        this.ensureColumnVisible(focusedColumn);
        this.relayout(reason);
        this.debug(`[cc-scroll] MOVE column=${focusedColumn.id}` +
            ` from=${oldIndex} to=${nextIndex}`);
        this.commitDockState(reason);
        return true;
    }
}
/* END GENERATED KWIN MODULES */

const TAG = "[cc-niri-maximize]";
const FULL_MAXIMIZE_MODE = 3;
const NORMAL_MODE = "normal";
const MAXIMIZE_MODE = "maximize";
const PRESENTATION_NORMAL = "normal";
const PRESENTATION_WIDE = "wide";
const PRESENTATION_MAXIMIZED = "maximized";
const WIDE_RATIO = 0.72;
const COLUMN_WIDTH_THIRD = "third";
const COLUMN_WIDTH_HALF = "half";
const COLUMN_WIDTH_TWO_THIRDS = "twoThirds";
const PARKING_MARGIN = 4096;
const FLOATING_FOCUS_GUARD_MS = 1200;
const WIDE_SCROLL_PHASE_MS = 220;
const WIDE_PAIR_HOLD_MS = 180;
const WIDE_EXPANSION_PHASE_MS = 240;
const WIDE_GEOMETRY_RETRY_MS = 50;
const WIDE_GEOMETRY_MAX_ATTEMPTS = 20;
const DOCK_SCROLL_STEP_MS = 140;
const WIDE_REVEAL_PHASE_SCROLLING = "scrolling-to-normal-pair";
const WIDE_REVEAL_PHASE_AWAITING_STEP = "awaiting-wide-step";
const WIDE_REVEAL_PHASE_SETTLED = "settled-normal-pair";
const WIDE_REVEAL_PHASE_EXPANDING = "expanding-wide";
const WIDE_REVEAL_PHASE_ANIMATING = "animating-wide";
const ADOPTION_UNTRACKED = "untracked";
const ADOPTION_WAITING_ACTIVATION = "waiting-activation";
const ADOPTION_WAITING_PRIMARY = "waiting-primary";
const ADOPTION_WAITING_ELIGIBLE = "waiting-eligible";
const ADOPTION_WAITING_NORMAL = "waiting-normal";
const ADOPTION_ADOPTING = "adopting";
const ADOPTION_SETTLING = "settling";
const ADOPTION_MANAGED = "managed";
const ADOPTION_FLOATING = "floating";
const ADOPTION_IGNORED = "ignored";
const DOCK_BRIDGE_SERVICE = "org.cc.ScrollDockBridge";
const DOCK_BRIDGE_PATH = "/ScrollDock";
const DOCK_BRIDGE_INTERFACE = "org.cc.ScrollDockBridge1";

const mainScreenState = {
    targetOutput: null,
    safeRect: null,
    columns: [],
    focusedColumnIndex: -1,
    scrollOffsetX: 0,
    innerGap: 8,
    enabled: true,
    nextColumnId: 1,
    presentation: {
        windowUuid: null,
        mode: PRESENTATION_NORMAL,
    },
};
const columnStore = new ColumnStore(mainScreenState);
const states = new WindowStateStore(createWindowState);
const runtimeConfig = loadRuntimeConfig(readConfig);
const runtimeLogger = new RuntimeLogger({
    tag: TAG,
    enabled: runtimeConfig.debugLogging,
    infoSink: message => console.info(message),
    warnSink: message => console.warn(message),
});
const outputTopology = new OutputTopology({
    getScreens: () => workspace.screens,
    config: runtimeConfig,
    computeSafeRect,
    warn,
});
const innerGap = runtimeConfig.primary.inner;
const includeDialogs = runtimeConfig.includeDialogs;
const dockGateway = new DockGateway({
    invoke: callDBus,
    service: DOCK_BRIDGE_SERVICE,
    path: DOCK_BRIDGE_PATH,
    interfaceName: DOCK_BRIDGE_INTERFACE,
    snapshotProvider: createDockSnapshot,
    handlers: {
        "emergency-restore": () => emergencyRestoreAllWindows("bridge-unload"),
        "settle-wide-transition": settlePendingWideTransition,
        "complete-wide-transition": completePendingWideTransition,
        "finalize-wide-transition": finalizePendingWideTransitionCommand,
        "check-wide-transition": checkPendingWideGeometry,
        "advance-dock-scroll": advancePendingDockScroll,
        "set-presentation-mode": handleDockPresentationCommand,
        "focus-column-right": handleDockFocusCommand,
        "set-column-order": handleDockReorderCommand,
    },
    debug,
    warn,
    now: () => Date.now(),
    random: () => Math.random(),
});
let connectedManagedOutputs = new Set();
let scrollLayoutInitialized = false;
let cancelWideTransitionState = () => false;
const parkingManager = new ParkingManager({
    stateFor,
    getState: window => states.get(window),
    refreshSafeArea: refreshMainScreenState,
    getSafeRect: () => mainScreenState.safeRect,
    debug,
});
const geometryCommitter = new GeometryCommitter({
    stateFor,
    sameRect,
    rectCopy,
    rectText,
    isTileMode,
    isRectInsideAnyOutput,
    setWindowVisibility: (window, visible) =>
        parkingManager.setVisibility(window, visible),
    isWindowHidden: window => parkingManager.isHidden(window),
    rememberVisibleGeometry: (window, rect) =>
        parkingManager.rememberVisibleGeometry(window, rect),
    debug,
    warn,
});
const invariantChecker = new InvariantChecker({
    appState: mainScreenState,
    windowStates: states,
    normalizeUuid: normalizeWindowUuid,
    stripWidth,
    managedPhases: [ADOPTION_MANAGED, ADOPTION_SETTLING],
    normalPresentationMode: PRESENTATION_NORMAL,
    debug,
    warn,
});
const layoutTransaction = new LayoutTransaction({
    audit: (reason, epoch) => invariantChecker.check(reason, epoch),
    debug,
});
const recovery = new Recovery({
    appState: mainScreenState,
    windowStates: states,
    parking: parkingManager,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    beforeRestore: reason => {
        mainScreenState.enabled = false;
        cancelWideTransitionState(reason);
        cancelPendingDockScroll(reason);
    },
    debug,
});
const adoptionController = new AdoptionController({
    phases: {
        untracked: ADOPTION_UNTRACKED,
        waitingActivation: ADOPTION_WAITING_ACTIVATION,
        waitingPrimary: ADOPTION_WAITING_PRIMARY,
        waitingEligible: ADOPTION_WAITING_ELIGIBLE,
        waitingNormal: ADOPTION_WAITING_NORMAL,
        adopting: ADOPTION_ADOPTING,
        settling: ADOPTION_SETTLING,
        managed: ADOPTION_MANAGED,
        floating: ADOPTION_FLOATING,
        ignored: ADOPTION_IGNORED,
    },
    stateFor,
    hasState: window => states.has(window),
    indexOfWindow: window => columnStore.indexOfWindow(window),
    getAppState: () => mainScreenState,
    refreshAppState: refreshMainScreenState,
    isPlasmaShellWindow,
    isLayoutMode,
    isTileMode,
    detectQuickTileMode,
    fullMaximizeMode: FULL_MAXIMIZE_MODE,
    scrollEligible,
    adoptWindow: adoptNewWindowAsColumn,
    settleLayout: settleAdoptionGeometry,
    rectText,
    debug,
});
const floatingController = new FloatingController({
    stateFor,
    hasState: window => states.has(window),
    indexOfWindow: window => columnStore.indexOfWindow(window),
    getAppState: () => mainScreenState,
    refreshAppState: refreshMainScreenState,
    scrollEligible,
    prepareWindow: prepareInitialColumn,
    adoptWindow: adoptNewWindowAsColumn,
    removeColumn,
    transitionAdoption: (window, windowState, phase, reason) =>
        adoptionController.transition(window, windowState, phase, reason),
    floatingPhase: ADOPTION_FLOATING,
    settlingPhase: ADOPTION_SETTLING,
    managedPhase: ADOPTION_MANAGED,
    getActiveWindow: () => workspace.activeWindow,
    setActiveWindow: window => { workspace.activeWindow = window; },
    rectText,
    debug,
    warn,
    now: () => Date.now(),
    focusGuardMs: FLOATING_FOCUS_GUARD_MS,
});
const outputController = new OutputController({
    stateFor,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    resolvePrimaryOutput: resolveTargetOutput,
    clearPresentationForWindow: window => {
        if (mainScreenState.presentation.windowUuid ===
                normalizeWindowUuid(window.internalId)) {
            clearPresentationState();
        }
    },
    removeColumn,
    transitionAdoption: (window, windowState, phase, reason) =>
        adoptionController.transition(window, windowState, phase, reason),
    phases: {
        untracked: ADOPTION_UNTRACKED,
        waitingPrimary: ADOPTION_WAITING_PRIMARY,
        floating: ADOPTION_FLOATING,
        ignored: ADOPTION_IGNORED,
    },
    profileForOutput,
    translateRestoreGeometry,
    fullMaximizeMode: FULL_MAXIMIZE_MODE,
    maximizeMode: MAXIMIZE_MODE,
    applyLayoutGeometry,
    detectQuickTileMode,
    isTileMode,
    applyDetectedTile,
    beginAdoption: beginWindowAdoption,
    advanceAdoption: advanceWindowAdoption,
    setLayoutMode,
    rectText,
    debug,
});
const fullscreenController = new FullscreenController({
    stateFor,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    relayout,
    onManagedOutput,
    isLayoutMode,
    applyLayoutGeometry,
    advanceAdoption: (window, reason) =>
        adoptionController.onFullscreenChanged(window, reason),
    normalMode: NORMAL_MODE,
    debug,
});
const presentationController = new PresentationController({
    getAppState: () => mainScreenState,
    normalizeUuid: normalizeWindowUuid,
    stateFor,
    setLayoutMode,
    modes: {
        normal: PRESENTATION_NORMAL,
        wide: PRESENTATION_WIDE,
        maximized: PRESENTATION_MAXIMIZED,
    },
    normalLayoutMode: NORMAL_MODE,
    maximizeLayoutMode: MAXIMIZE_MODE,
    wideRatio: WIDE_RATIO,
    rectCopy,
    cancelPendingDockScroll,
    cancelPendingWideTransition: reason => cancelWideTransitionState(reason),
    focusColumn: column => columnStore.focusColumn(column),
    recomputeLogicalLayout,
    ensureColumnVisible,
    relayout,
    getActiveWindow: () => workspace.activeWindow,
    setActiveWindow: window => { workspace.activeWindow = window; },
    commitDockState,
    debug,
});
const wideTransition = new WideTransition({
    getAppState: () => mainScreenState,
    normalizeUuid: normalizeWindowUuid,
    phases: {
        scrolling: WIDE_REVEAL_PHASE_SCROLLING,
        awaitingStep: WIDE_REVEAL_PHASE_AWAITING_STEP,
        settled: WIDE_REVEAL_PHASE_SETTLED,
        expanding: WIDE_REVEAL_PHASE_EXPANDING,
        animating: WIDE_REVEAL_PHASE_ANIMATING,
    },
    normalPresentationMode: PRESENTATION_NORMAL,
    widePresentationMode: PRESENTATION_WIDE,
    timings: {
        scroll: WIDE_SCROLL_PHASE_MS,
        pairHold: WIDE_PAIR_HOLD_MS,
        expansion: WIDE_EXPANSION_PHASE_MS,
        geometryRetry: WIDE_GEOMETRY_RETRY_MS,
    },
    maxGeometryAttempts: WIDE_GEOMETRY_MAX_ATTEMPTS,
    getDockGeneration: () => dockGateway.generation(),
    getDockSessionId: () => dockGateway.sessionId(),
    requestDeferred: (command, delayMs, callback) =>
        dockGateway.requestDeferred(command, delayMs, callback),
    relayout,
    commitDockState,
    presentationRect,
    sameRectNear,
    clearPresentation: clearPresentationState,
    selectPersistentPresentation,
    setColumnVisibility: setColumnVisualVisibility,
    applyColumnGeometry,
    isFullyVisible: isFullyVisibleInSafeRect,
    projectedRectForColumn,
    rectText,
    debug,
    warn,
});
cancelWideTransitionState = reason => wideTransition.cancel(reason);
const dockScrollController = new DockScrollController({
    getAppState: () => mainScreenState,
    normalizeUuid: normalizeWindowUuid,
    recomputeLogicalLayout,
    clampScrollOffset,
    stripWidth,
    isFullyVisible: isFullyVisibleInSafeRect,
    projectedRectForColumn,
    requestDeferred: (command, delayMs, callback) =>
        dockGateway.requestDeferred(command, delayMs, callback),
    getSessionId: () => dockGateway.sessionId(),
    stepMs: DOCK_SCROLL_STEP_MS,
    cancelWideTransition: reason => wideTransition.cancel(reason),
    clearPresentation: clearPresentationState,
    normalPresentationMode: PRESENTATION_NORMAL,
    commitDockState,
    publishDockState,
    focusIndex: index => columnStore.focusIndex(index),
    transitionFocused: relayoutFocusedColumnTransition,
    setActiveWindow: window => { workspace.activeWindow = window; },
    relayout,
    debug,
});
const reorderController = new ReorderController({
    getAppState: () => mainScreenState,
    normalizeUuid: normalizeWindowUuid,
    rejectDockCommand,
    cancelDockScroll: cancelPendingDockScroll,
    getFocusedColumn: () => columnStore.focusedColumn(),
    reorderColumns: columns => columnStore.reorder(columns),
    recomputeLogicalLayout,
    ensureColumnVisible,
    relayout,
    getGeneration: () => dockGateway.generation(),
    commitDockState,
    getActiveWindow: () => workspace.activeWindow,
    indexOfWindow: window => columnStore.indexOfWindow(window),
    focusIndex: index => columnStore.focusIndex(index),
    focusedIndex: () => columnStore.focusedIndex(),
    moveFocusedColumn: delta => columnStore.moveFocused(delta),
    debug,
});
const controllerComposition = new ControllerComposition({
    parking: parkingManager,
    geometry: geometryCommitter,
    invariants: invariantChecker,
    transactions: layoutTransaction,
    recovery,
    adoption: adoptionController,
    floating: floatingController,
    output: outputController,
    fullscreen: fullscreenController,
    presentation: presentationController,
    wide: wideTransition,
    dockGateway,
    dockScroll: dockScrollController,
    reorder: reorderController,
}, [
    "parking", "geometry", "invariants", "transactions", "recovery",
    "adoption", "floating", "output", "fullscreen", "presentation",
    "wide", "dockGateway", "dockScroll", "reorder",
]);

function debug(message) {
    runtimeLogger.debug(message);
}

function warn(message) {
    runtimeLogger.warn(message);
}

function normalizeWindowUuid(value) {
    return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
}

function createDockSnapshot() {
    const focusedColumn = mainScreenState.columns[mainScreenState.focusedColumnIndex] || null;
    return {
        targetOutput: mainScreenState.targetOutput ? mainScreenState.targetOutput.name : "",
        focusedUuid: focusedColumn
            ? normalizeWindowUuid(focusedColumn.window.internalId)
            : "",
        presentation: {
            windowUuid: mainScreenState.presentation.windowUuid || null,
            mode: mainScreenState.presentation.mode,
        },
        columns: mainScreenState.columns.map(column => ({
            uuid: normalizeWindowUuid(column.window.internalId),
            widthMode: column.widthMode,
        })),
    };
}

function publishDockState(reason) {
    return dockGateway.publish(createDockSnapshot(), reason);
}

function commitDockState(reason) {
    return dockGateway.commit(createDockSnapshot(), reason);
}

function rejectDockCommand(reason) {
    return dockGateway.reject(null, reason);
}

function handleDockPresentationCommand(command) {
    const windowUuid = normalizeWindowUuid(command.windowUuid);
    const mode = String(command.mode || "");
    const column = mainScreenState.columns.find(item =>
        normalizeWindowUuid(item.window.internalId) === windowUuid);
    if (!column || column.window.output !== mainScreenState.targetOutput ||
            !isPresentationMode(mode)) {
        rejectDockCommand("invalid-presentation-target");
        return false;
    }
    return setPresentationMode(windowUuid, mode, "dock-presentation");
}

function handleDockFocusCommand(command) {
    const windowUuid = normalizeWindowUuid(command.windowUuid);
    const index = mainScreenState.columns.findIndex(item =>
        normalizeWindowUuid(item.window.internalId) === windowUuid);
    const column = index >= 0 ? mainScreenState.columns[index] : null;
    if (!column || column.window.output !== mainScreenState.targetOutput) {
        rejectDockCommand("invalid-focus-target");
        return false;
    }
    return beginDockScroll(column, "dock-focus-right");
}

function handleDockReorderCommand(command) {
    return reorderController.applyDockCommand(command);
}

function applyPendingDockCommand() {
    return dockGateway.takePendingCommand();
}

function rectCopy(rect) {
    return copyRect(rect);
}

function rectText(rect) {
    return formatRect(rect);
}

function sameRect(a, b) {
    return rectsEqual(a, b);
}

function sameRectNear(a, b) {
    return rectsNearlyEqual(a, b);
}

function sameSizeNear(a, b) {
    return sizesNearlyEqual(a, b);
}

function orderedOutputs() {
    return outputTopology.ordered();
}

function resolveTargetOutput() {
    return outputTopology.primary();
}

function resolveSecondaryOutput() {
    return outputTopology.secondary();
}

function profileForOutput(output) {
    return outputTopology.profile(output);
}

function managedOutputs() {
    return outputTopology.managed();
}

function safeRectFor(output) {
    return outputTopology.safeRect(output);
}

function isPlasmaShellWindow(window) {
    if (!window) return false;
    const shellIdentities = new Set([
        "plasmashell",
        "org.kde.plasmashell",
        "org.kde.plasma.desktop",
    ]);
    return [window.resourceClass, window.resourceName, window.desktopFileName]
        .map(value => String(value || "").trim().toLowerCase())
        .some(value => shellIdentities.has(value));
}

function scrollEligible(window) {
    return Boolean(window && window.managed && window.normalWindow &&
        window.moveable && window.resizeable &&
        !window.specialWindow && !window.skipTaskbar && !window.fullScreen &&
        !isPlasmaShellWindow(window));
}

function refreshMainScreenState() {
    mainScreenState.targetOutput = resolveTargetOutput();
    mainScreenState.safeRect = mainScreenState.targetOutput
        ? safeRectFor(mainScreenState.targetOutput)
        : null;
    mainScreenState.innerGap = innerGap;
}

function widthForMode(mode) {
    const safeRect = mainScreenState.safeRect;
    if (!safeRect) return 1;
    return computeColumnWidth(mode, safeRect.width, mainScreenState.innerGap);
}

function recomputeLogicalLayout() {
    const layout = deriveColumnLayout(
        mainScreenState.columns,
        mainScreenState.safeRect.width,
        mainScreenState.innerGap
    );
    mainScreenState.columns.forEach((column, index) => {
        column.pixelWidth = layout[index].pixelWidth;
        column.logicalX = layout[index].logicalX;
    });
}

function stripWidth() {
    return computeStripWidth(mainScreenState.columns);
}

function clampScrollOffset() {
    const viewportWidth = mainScreenState.safeRect ? mainScreenState.safeRect.width : 0;
    mainScreenState.scrollOffsetX = boundScrollOffset(
        mainScreenState.scrollOffsetX,
        stripWidth(),
        viewportWidth
    );
}

function ensureColumnVisible(column) {
    if (!column || !mainScreenState.safeRect) return;
    const oldOffset = mainScreenState.scrollOffsetX;
    mainScreenState.scrollOffsetX = scrollOffsetToRevealColumn(
        oldOffset,
        column,
        stripWidth(),
        mainScreenState.safeRect.width
    );
    if (oldOffset !== mainScreenState.scrollOffsetX) {
        debug(`[cc-scroll] SCROLL old=${oldOffset} new=${mainScreenState.scrollOffsetX}`);
    }
}

function projectedRectForColumnAtOffset(column, scrollOffsetX) {
    return projectColumnRect(column, mainScreenState.safeRect, scrollOffsetX);
}

function projectedRectForColumn(column) {
    return projectedRectForColumnAtOffset(column, mainScreenState.scrollOffsetX);
}

function isPresentationMode(mode) {
    return presentationController.isMode(mode);
}

function presentationColumn() {
    return presentationController.column();
}

function wideRect() {
    return presentationController.wideRect();
}

function presentationRect() {
    return presentationController.rect();
}

function isFullyVisibleInSafeRect(rect) {
    return isRectFullyVisible(rect, mainScreenState.safeRect);
}

function rectIntersects(a, b) {
    return rectanglesIntersect(a, b);
}

function isRectInsideAnyOutput(rect) {
    return workspace.screens.some(output => rectIntersects(rect, output.geometry));
}

function virtualScreenLeft() {
    const geometry = workspace.virtualScreenGeometry;
    if (geometry && Number.isFinite(Number(geometry.x))) return Number(geometry.x);
    return workspace.screens.reduce(
        (left, output) => Math.min(left, output.geometry.x),
        0
    );
}

function looksLikeInheritedParking(window) {
    const rect = window.frameGeometry;
    return Number(window.opacity) <= 0 && window.minimized && rect &&
        Number(rect.x) < virtualScreenLeft();
}

function parkingBaseX() {
    return computeParkingBaseX(
        mainScreenState.columns,
        virtualScreenLeft(),
        PARKING_MARGIN
    );
}

function applyColumnGeometry(column, target, reason) {
    geometryCommitter.commitGeometry(column, target, reason);
}

function setColumnVisualVisibility(column, visible) {
    parkingManager.setVisibility(column.window, visible);
}

function parkingRecoveryRect(windowState, fallbackIndex) {
    return parkingManager.recoveryRect(windowState, fallbackIndex);
}

function releaseParkingOwnership(window, reason, ensureAccessible = false,
        fallbackIndex = 0) {
    return parkingManager.release(
        window,
        reason,
        ensureAccessible,
        fallbackIndex
    );
}

function emergencyRestoreAllWindows(reason) {
    return recovery.restoreAll(reason);
}

function beginLayoutTransaction(reason) {
    return layoutTransaction.begin(reason);
}

function validateLayoutInvariants(reason, epoch) {
    return invariantChecker.check(reason, epoch);
}

function endLayoutTransaction(reason, epoch) {
    layoutTransaction.end(reason, epoch);
}

function relayoutImpl(reason, scrollOffsets) {
    if (!mainScreenState.enabled || !mainScreenState.columns.length) return;
    refreshMainScreenState();
    if (!mainScreenState.safeRect) return;
    recomputeLogicalLayout();
    clampScrollOffset();

    const presentedColumn = presentationColumn();
    const plan = computeLayoutPlan({
        reason,
        epoch: layoutTransaction.currentEpoch(),
        columns: mainScreenState.columns,
        safeRect: mainScreenState.safeRect,
        innerGap: mainScreenState.innerGap,
        parkingBaseX: parkingBaseX(),
        scrollOffsetX: mainScreenState.scrollOffsetX,
        scrollOffsets,
        presentedColumn,
        presentedRect: presentedColumn ? presentationRect() : null,
    });
    geometryCommitter.commit(plan);
}

function relayout(reason, scrollOffsets) {
    const epoch = beginLayoutTransaction(reason);
    try {
        relayoutImpl(reason, scrollOffsets);
    } finally {
        endLayoutTransaction(reason, epoch);
    }
}

function columnIndexForWindow(window) {
    return columnStore.indexOfWindow(window);
}

function resetPresentedWindowLayoutState() {
    return presentationController.resetPresentedWindowLayoutState();
}

function clearPresentationState() {
    return presentationController.clear();
}

function cancelPendingDockScroll(reason) {
    return dockScrollController.cancel(reason);
}

function boundedScrollOffset(offset) {
    return dockScrollController.boundedOffset(offset);
}

function dockScrollOffsetsToTarget(column) {
    return dockScrollController.offsetsToTarget(column);
}

function requestDeferredDockScrollStep(pending) {
    return dockScrollController.requestStep(pending);
}

function finishDockScroll(pending, column) {
    return dockScrollController.finish(pending, column);
}

function advancePendingDockScroll(command) {
    return dockScrollController.advance(command);
}

function beginDockScroll(column, reason) {
    return dockScrollController.begin(column, reason);
}

function selectPersistentPresentation(column) {
    return presentationController.selectPersistent(column);
}

function pendingWideColumn(pending) {
    return wideTransition.pendingColumn(pending);
}

function finalizePendingWideTransition(column) {
    return wideTransition.finalize(column);
}

function finalizePendingWideTransitionCommand(command) {
    return wideTransition.finalizeCommand(command);
}

function acknowledgePendingWideGeometry(column) {
    return wideTransition.acknowledgeGeometry(column);
}

function checkPendingWideGeometry(command) {
    return wideTransition.checkGeometry(command);
}

function beginPendingWideExpansion(pending, column, reason) {
    return wideTransition.beginExpansion(pending, column, reason);
}

function completePendingWideTransition(command) {
    return wideTransition.complete(command);
}

function requestDeferredWideStage(type, pending, baseGeneration, delayMs) {
    return wideTransition.requestStage(type, pending, baseGeneration, delayMs);
}

function settlePendingWideTransition(command) {
    return wideTransition.settle(command);
}

function schedulePersistentWideTransition(column, reason, baseGeneration) {
    return wideTransition.schedule(column, reason, baseGeneration);
}

function armPersistentWideStep(column, reason, direction) {
    return wideTransition.armStep(column, reason, direction);
}

function relayoutFocusedColumnTransition(column, reason, oldScrollOffsetX,
        newScrollOffsetX, wideStepDirection = 0) {
    return wideTransition.transitionFocused(
        column,
        reason,
        oldScrollOffsetX,
        newScrollOffsetX,
        wideStepDirection
    );
}

function setPresentationMode(windowUuid, mode, reason) {
    return presentationController.setMode(windowUuid, mode, reason);
}

function addColumnAt(window, insertionIndex, reason) {
    if (columnIndexForWindow(window) >= 0) return null;
    const windowState = stateFor(window);
    const column = columnStore.insertWindow(
        window,
        insertionIndex,
        COLUMN_WIDTH_HALF
    );
    if (!column) return null;
    windowState.managedByScrollLayout = true;
    windowState.columnId = column.id;
    const index = columnStore.indexOf(column);
    debug(`[cc-scroll] ADD_WINDOW caption=${window.caption}` +
        ` column=${column.id} index=${index} width=${column.widthMode}` +
        ` reason=${reason}`);
    return column;
}

function addInitialColumn(window) {
    const column = addColumnAt(
        window,
        mainScreenState.columns.length,
        "startup"
    );
    if (column) {
        const windowState = stateFor(window);
        adoptionController.transition(
            window,
            windowState,
            ADOPTION_MANAGED,
            "startup"
        );
    }
    return column;
}

function prepareInitialColumn(window) {
    const windowState = stateFor(window);
    const tileMode = detectQuickTileMode(window);
    const hadLayoutOverride = isLayoutMode(windowState.layoutMode) ||
        Number(window.maximizeMode) === FULL_MAXIMIZE_MODE || isTileMode(tileMode);
    if (!hadLayoutOverride) return true;

    windowState.internalChange = true;
    try {
        if (isTileMode(tileMode)) {
            /*
             * KWin exposes no writable tile property. A maximize -> restore
             * round trip is the verified public operation that detaches the
             * native Quick Tile object before scroll-layout adoption.
             */
            window.setMaximize(true, true);
            window.setMaximize(false, false);
        } else {
            window.setMaximize(false, false);
        }
        clearLayoutState(windowState);
        windowState.layoutModeBeforeFullscreen = NORMAL_MODE;
        windowState.temporarilyMaximized = false;
        windowState.temporarilyQuickTiled = false;
    } finally {
        windowState.internalChange = false;
    }

    const detached = detectQuickTileMode(window) === NORMAL_MODE &&
        Number(window.maximizeMode) !== FULL_MAXIMIZE_MODE;
    if (!detached) {
        warn(`[cc-scroll] failed to detach startup layout caption=${window.caption}` +
            ` tile=${detectQuickTileMode(window)} maximize=${window.maximizeMode}`);
    } else {
        debug(`[cc-scroll] ADOPT_STARTUP_OVERRIDE caption=${window.caption}` +
            ` previous=${tileMode}`);
    }
    return detached;
}

function removeColumn(window, reason, activateSuccessor = true) {
    const index = columnIndexForWindow(window);
    if (index < 0) return;
    cancelPendingDockScroll(reason);
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    const focusedColumn = columnStore.focusedColumn();
    const removedColumn = mainScreenState.columns[index];
    if (reason !== "window-closed") {
        const needsAccessibleGeometry = reason === "shortcut-toggle-floating" ||
            reason === "interactive-move-resize";
        releaseParkingOwnership(
            removedColumn.window,
            reason,
            needsAccessibleGeometry,
            index
        );
    }
    const removedGeometry = removedColumn.window.frameGeometry;
    const removedWasVisibleLeft = mainScreenState.safeRect &&
        isFullyVisibleInSafeRect(removedGeometry) &&
        removedGeometry.x + removedGeometry.width / 2 <
            mainScreenState.safeRect.x + mainScreenState.safeRect.width / 2;
    if (mainScreenState.presentation.windowUuid ===
            normalizeWindowUuid(removedColumn.window.internalId)) {
        clearPresentationState();
    }
    const removedFocusedColumn = focusedColumn === removedColumn;
    columnStore.removeWindow(window);
    const windowState = states.get(window);
    if (windowState) {
        windowState.managedByScrollLayout = false;
        windowState.columnId = null;
        adoptionController.transition(
            window,
            windowState,
            windowState.floating ? ADOPTION_FLOATING : ADOPTION_UNTRACKED,
            `${reason}-removed`
        );
    }
    if (!mainScreenState.columns.length) {
        mainScreenState.scrollOffsetX = 0;
        commitDockState(reason);
        return;
    }

    recomputeLogicalLayout();
    const nextFocusedColumn = columnStore.focusedColumn();
    if (removedWasVisibleLeft && index > 0) {
        /* Keep the existing right-hand window fixed in its right slot. The
         * predecessor becomes the new left-hand window instead of shifting
         * the entire visible pair left after the left window closes. */
        mainScreenState.scrollOffsetX = oldScrollOffsetX -
            removedColumn.pixelWidth - mainScreenState.innerGap;
        clampScrollOffset();
    } else {
        ensureColumnVisible(nextFocusedColumn);
    }
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX,
    });

    if (activateSuccessor && removedFocusedColumn && nextFocusedColumn &&
            workspace.activeWindow !== nextFocusedColumn.window) {
        workspace.activeWindow = nextFocusedColumn.window;
    }
    debug(`[cc-scroll] REMOVE_WINDOW column=${removedColumn.id}` +
        ` index=${index} focused=${removedFocusedColumn}` +
        ` next=${nextFocusedColumn ? nextFocusedColumn.id : "<none>"}` +
        ` reason=${reason}`);
    commitDockState(reason);
}

function initializeScrollLayout() {
    /* This immutable startup snapshot is the only path allowed to adopt an
     * inactive window. Anything arriving later through windowAdded follows
     * the runtime state machine and waits for its first activation. */
    refreshMainScreenState();
    if (!mainScreenState.enabled || !mainScreenState.targetOutput) return;
    workspace.windowList().filter(window =>
        scrollEligible(window) &&
        window.output === mainScreenState.targetOutput
    ).filter(prepareInitialColumn).forEach(addInitialColumn);

    if (!mainScreenState.columns.length) return;
    const activeIndex = columnIndexForWindow(workspace.activeWindow);
    columnStore.focusIndex(activeIndex >= 0 ? activeIndex : 0);
    recomputeLogicalLayout();
    ensureColumnVisible(columnStore.focusedColumn());
    relayout("startup");
}

function adoptNewWindowAsColumn(window, reason, focusNew = true) {
    if (!scrollLayoutInitialized || !window) return false;
    refreshMainScreenState();
    if (!mainScreenState.enabled || !mainScreenState.targetOutput ||
            window.output !== mainScreenState.targetOutput ||
            !scrollEligible(window) || columnIndexForWindow(window) >= 0) {
        return false;
    }

    cancelPendingDockScroll(reason);
    const windowState = stateFor(window);
    if (windowState.floating || isLayoutMode(windowState.layoutMode) ||
            Number(window.maximizeMode) === FULL_MAXIMIZE_MODE ||
            isTileMode(detectQuickTileMode(window))) {
        return false;
    }

    if (focusNew && mainScreenState.presentation.mode !== PRESENTATION_NORMAL) {
        clearPresentationState();
    }

    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    const focusedIndex = mainScreenState.columns.length
        ? Math.max(0, Math.min(
            mainScreenState.focusedColumnIndex,
            mainScreenState.columns.length - 1
        ))
        : -1;
    const focusedColumn = focusedIndex >= 0
        ? mainScreenState.columns[focusedIndex]
        : null;
    const insertionIndex = focusNew
        ? focusedIndex + 1
        : mainScreenState.columns.length;
    const column = addColumnAt(window, insertionIndex, reason);
    if (!column) return false;

    if (focusNew || !focusedColumn) columnStore.focusColumn(column);
    else columnStore.focusColumn(focusedColumn);
    recomputeLogicalLayout();
    if (focusNew || !focusedColumn) ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayout(reason, {
        oldScrollOffsetX,
        newScrollOffsetX,
    });
    debug(`[cc-scroll] ADOPT_NEW index=${insertionIndex}` +
        ` focused=${focusNew} caption=${window.caption}`);
    commitDockState(reason);
    return true;
}

function setAdoptionPhase(window, windowState, phase, reason) {
    adoptionController.transition(window, windowState, phase, reason);
}

function settleAdoptionGeometry(window, index, reason) {
    const column = mainScreenState.columns[index];
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    columnStore.focusIndex(index);
    recomputeLogicalLayout();
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    relayoutFocusedColumnTransition(
        column,
        `${reason}-settle`,
        oldScrollOffsetX,
        newScrollOffsetX
    );

    const expected = projectedRectForColumn(column);
    return {
        column,
        expected,
        settled: isFullyVisibleInSafeRect(expected) &&
            sameRect(window.frameGeometry, expected),
    };
}

function advanceWindowAdoption(window, reason) {
    return adoptionController.advance(window, reason);
}

function beginWindowAdoption(window, origin) {
    return adoptionController.begin(window, origin);
}

function onWindowActivatedForScrollLayout(window) {
    if (!window) return;
    if (layoutTransaction.isActive()) {
        debug(`[cc-stability] SUPPRESS activation epoch=${layoutTransaction.currentEpoch()}` +
            ` caption=${window.caption}`);
        return;
    }
    if (floatingController.redirectActivation(window)) return;
    adoptionController.onActivated(window);

    const index = columnIndexForWindow(window);
    if (index < 0) return;
    if (dockScrollController.hasPending()) {
        cancelPendingDockScroll("window-activated");
    }
    const column = mainScreenState.columns[index];
    const windowUuid = normalizeWindowUuid(window.internalId);
    const deferredWideMatches = wideTransition.matchesWindow(windowUuid);
    const presentationMatches = deferredWideMatches || (column.persistentWide
        ? mainScreenState.presentation.mode === PRESENTATION_WIDE &&
            mainScreenState.presentation.windowUuid === windowUuid
        : mainScreenState.presentation.mode === PRESENTATION_NORMAL);
    if (index === mainScreenState.focusedColumnIndex && presentationMatches) return;
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    columnStore.focusIndex(index);
    recomputeLogicalLayout();
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        "window-activated",
        oldScrollOffsetX,
        newScrollOffsetX
    );
    debug(`[cc-scroll] FOCUS_ACTIVE index=${index} caption=${window.caption}`);
    if (presentationChanged) commitDockState("focus-selected-presentation");
    else publishDockState("window-activated");
}

function focusRelativeColumn(delta) {
    const columns = mainScreenState.columns;
    if (!mainScreenState.enabled || !columns.length) return;
    cancelPendingDockScroll(delta < 0 ? "focus-previous" : "focus-next");
    const activeIndex = columnIndexForWindow(workspace.activeWindow);
    if (activeIndex >= 0) columnStore.focusIndex(activeIndex);
    const oldIndex = columnStore.focusedIndex();
    const currentColumn = oldIndex >= 0 ? columns[oldIndex] : null;
    if (wideTransition.beginStepIfPending(
        currentColumn,
        delta,
        delta < 0 ? "focus-previous-wide-step" : "focus-next-wide-step"
    )) {
        debug(`[cc-scroll] WIDE_STEP index=${oldIndex} direction=${delta}`);
        return;
    }
    const nextIndex = Math.max(0, Math.min(columns.length - 1, oldIndex + delta));
    if (nextIndex === oldIndex) return;

    columnStore.focusIndex(nextIndex);
    const column = columns[nextIndex];
    recomputeLogicalLayout();
    const oldScrollOffsetX = mainScreenState.scrollOffsetX;
    ensureColumnVisible(column);
    const newScrollOffsetX = mainScreenState.scrollOffsetX;
    const presentationChanged = relayoutFocusedColumnTransition(
        column,
        delta < 0 ? "focus-previous" : "focus-next",
        oldScrollOffsetX,
        newScrollOffsetX,
        delta
    );
    /*
     * Never activate a window while its real geometry is still in the
     * off-screen parking area. KWin may compose one activation frame before
     * the following geometry transaction, which can surface on an adjacent
     * output. Commit the target's primary-screen slot first, then focus it.
     */
    workspace.activeWindow = column.window;
    debug(`[cc-scroll] FOCUS from=${oldIndex} to=${nextIndex}`);
    if (presentationChanged) {
        commitDockState(delta < 0 ? "focus-previous-presentation" :
            "focus-next-presentation");
    } else {
        publishDockState(delta < 0 ? "focus-previous" : "focus-next");
    }
}

function toggleFocusWide(window) {
    const index = columnIndexForWindow(window);
    if (!window || index < 0 || window.output !== mainScreenState.targetOutput ||
            window.fullScreen) return;
    const windowUuid = normalizeWindowUuid(window.internalId);
    const alreadyWide = mainScreenState.columns[index].persistentWide;
    setPresentationMode(
        windowUuid,
        alreadyWide ? PRESENTATION_NORMAL : PRESENTATION_WIDE,
        alreadyWide ? "shortcut-wide-to-normal" : "shortcut-focus-wide"
    );
}

function moveFocusedColumn(delta) {
    return reorderController.moveFocused(delta);
}

function detachColumnToFloating(window, reason) {
    return floatingController.detach(window, reason);
}

function attachFloatingToColumns(window, reason) {
    return floatingController.attach(window, reason);
}

function rememberFloatingWindow(window, guardFocus) {
    floatingController.remember(window, guardFocus);
}

function toggleFloating(window) {
    return floatingController.toggle(window);
}

function rectForLayout(mode, safeRect, requestedInnerGap) {
    return quickTileRect(mode, safeRect, requestedInnerGap, MAXIMIZE_MODE);
}

function detectQuickTileMode(window) {
    const relative = window.tile ? window.tile.relativeGeometry : null;
    if (!relative) return NORMAL_MODE;
    const key = [relative.x, relative.y, relative.width, relative.height]
        .map(value => Number(value).toFixed(2)).join(",");
    return ({
        "0.00,0.00,0.50,1.00": "left",
        "0.50,0.00,0.50,1.00": "right",
        "0.00,0.00,1.00,0.50": "top",
        "0.00,0.50,1.00,0.50": "bottom",
        "0.00,0.00,0.50,0.50": "topLeft",
        "0.50,0.00,0.50,0.50": "topRight",
        "0.00,0.50,0.50,0.50": "bottomLeft",
        "0.50,0.50,0.50,0.50": "bottomRight",
    })[key] || "unsupported";
}

function isTileMode(mode) {
    return mode !== NORMAL_MODE && mode !== MAXIMIZE_MODE && mode !== "unsupported";
}

function isLayoutMode(mode) {
    return mode === MAXIMIZE_MODE || isTileMode(mode);
}

function eligible(window) {
    if (!window || window.fullScreen || !window.resizeable || !window.maximizable ||
            window.skipTaskbar || isPlasmaShellWindow(window)) return false;
    return window.normalWindow || (includeDialogs && window.dialog);
}

function onManagedOutput(window) {
    return Boolean(window && profileForOutput(window.output));
}

function createWindowState(window) {
    const currentOpacity = Number(window.opacity);
    const inheritedParkingHidden = looksLikeInheritedParking(window);
    const currentGeometry = rectCopy(window.frameGeometry);
    return {
        pseudoMaximized: false,
        layoutMode: NORMAL_MODE,
        layoutModeBeforeFullscreen: NORMAL_MODE,
        restoreGeometry: null,
        restoreOutput: null,
        pendingAction: null,
        internalChange: false,
        interactiveMoveResize: false,
        managedByScrollLayout: false,
        columnId: null,
        floating: false,
        adoptionPhase: ADOPTION_UNTRACKED,
        adoptionOrigin: "",
        adoptionLastEvent: "",
        adoptionAttempts: 0,
        temporarilyMaximized: false,
        temporarilyQuickTiled: false,
        scrollOriginalOpacity: currentOpacity > 0 ? currentOpacity : 1,
        scrollVisuallyHidden: inheritedParkingHidden,
        scrollParkedByScript: inheritedParkingHidden,
        scrollParkingMinimized: inheritedParkingHidden && window.minimized,
        scrollLastVisibleGeometry: inheritedParkingHidden
            ? null
            : currentGeometry,
    };
}

function stateFor(window) {
    return states.ensure(window);
}

function setLayoutMode(state, mode) {
    state.layoutMode = mode;
    state.pseudoMaximized = mode === MAXIMIZE_MODE;
}

function clearLayoutState(state) {
    setLayoutMode(state, NORMAL_MODE);
    state.restoreGeometry = null;
    state.restoreOutput = null;
    state.pendingAction = null;
}

function rememberRestore(window, state, geometry) {
    if (state.restoreGeometry) return;
    state.restoreGeometry = rectCopy(geometry);
    state.restoreOutput = window.output;
    debug(`CAPTURE ${window.caption} restore=${rectText(state.restoreGeometry)}`);
}

function translateRestoreGeometry(state, newOutput) {
    if (!state.restoreGeometry || !newOutput) return;
    if (!state.restoreOutput) {
        state.restoreOutput = newOutput;
        return;
    }
    if (state.restoreOutput === newOutput) return;
    const oldScreen = state.restoreOutput.geometry;
    const newScreen = newOutput.geometry;
    state.restoreGeometry.x += newScreen.x - oldScreen.x;
    state.restoreGeometry.y += newScreen.y - oldScreen.y;
    state.restoreOutput = newOutput;
    debug(`TRANSLATE restore=${rectText(state.restoreGeometry)} output=${newOutput.name}`);
}

function applyLayoutGeometry(window, state, mode, reason) {
    const profile = profileForOutput(window.output);
    if (!profile || window.fullScreen) return false;
    const target = rectForLayout(mode, safeRectFor(window.output), profile.inner);
    if (!target) return false;
    state.internalChange = true;
    try {
        if (mode === MAXIMIZE_MODE) window.setMaximize(false, false);
        window.frameGeometry = target;
        setLayoutMode(state, mode);
        state.pendingAction = null;
    } finally {
        state.internalChange = false;
    }
    debug(`APPLY ${window.caption} reason=${reason} mode=${mode}` +
        ` geometry=${rectText(window.frameGeometry)} expected=${rectText(target)}` +
        ` restore=${rectText(state.restoreGeometry)}`);
    return sameRect(window.frameGeometry, target);
}

function leavePseudoMaximize(window, state, reason) {
    const restore = rectCopy(state.restoreGeometry);
    state.internalChange = true;
    try {
        window.setMaximize(false, false);
        if (restore) window.frameGeometry = restore;
        clearLayoutState(state);
    } finally {
        state.internalChange = false;
    }
    debug(`RESTORE ${window.caption} reason=${reason} geometry=${rectText(window.frameGeometry)}`);
}

function onFrameGeometryChanged(window, oldGeometry) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    if (wideTransition.onGeometryChanged(window)) return;
    if (window.active && state.adoptionPhase !== ADOPTION_UNTRACKED &&
            state.adoptionPhase !== ADOPTION_MANAGED &&
            state.adoptionPhase !== ADOPTION_FLOATING &&
            state.adoptionPhase !== ADOPTION_IGNORED) {
        adoptionController.onGeometryChanged(window);
        return;
    }
    const detectedMode = detectQuickTileMode(window);
    if (state.layoutMode === NORMAL_MODE) {
        if (isTileMode(detectedMode)) rememberRestore(window, state, oldGeometry);
        return;
    }

    /*
     * Plasma edit mode changes panel struts and KWin silently reapplies native
     * Quick Tile geometry without tileChanged/quickTileModeChanged. Correct
     * only that recognizable native-size reset; this is not a general geometry
     * enforcement path and interactive move/resize is excluded above.
     */
    if (isTileMode(state.layoutMode) && state.layoutMode === detectedMode &&
            onManagedOutput(window) && window.tile &&
            sameSizeNear(window.frameGeometry, window.tile.absoluteGeometryInScreen)) {
        const profile = profileForOutput(window.output);
        const expected = rectForLayout(
            state.layoutMode,
            safeRectFor(window.output),
            profile.inner
        );
        if (!sameRect(window.frameGeometry, expected)) {
            applyLayoutGeometry(window, state, state.layoutMode, "native-tile-geometry-reset");
        }
    }
}

function applyDetectedTile(window, signalName) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    const mode = detectQuickTileMode(window);
    const profile = profileForOutput(window.output);
    if (!profile) {
        if (isTileMode(mode)) {
            setLayoutMode(state, mode);
            debug(`NATIVE ${window.caption} mode=${mode} output=${window.output.name}`);
        } else if (mode === NORMAL_MODE && isTileMode(state.layoutMode)) {
            clearLayoutState(state);
        }
        return;
    }
    if (isTileMode(mode)) {
        applyLayoutGeometry(window, state, mode, signalName);
        return;
    }
    if (mode === NORMAL_MODE && isTileMode(state.layoutMode)) {
        if (state.pendingAction === "enterMaximize") return;
        const restore = rectCopy(state.restoreGeometry);
        state.internalChange = true;
        try {
            if (restore) window.frameGeometry = restore;
            clearLayoutState(state);
        } finally {
            state.internalChange = false;
        }
        debug(`RESTORE ${window.caption} reason=${signalName}-untile` +
            ` geometry=${rectText(window.frameGeometry)}`);
        advanceWindowAdoption(window, `${signalName}-untile`);
    }
}

function onMaximizedAboutToChange(window, mode) {
    const state = stateFor(window);
    if (state.internalChange || state.interactiveMoveResize || window.fullScreen) return;
    const onTarget = onManagedOutput(window);
    const managedColumn = columnIndexForWindow(window) >= 0 &&
        window.output === mainScreenState.targetOutput;
    if (Number(mode) === FULL_MAXIMIZE_MODE) {
        if (!managedColumn && state.layoutMode === NORMAL_MODE) {
            rememberRestore(window, state, window.frameGeometry);
        }
        if (onTarget && state.layoutMode === MAXIMIZE_MODE) {
            state.pendingAction = "leaveMaximize";
        } else {
            state.pendingAction = onTarget ? "enterMaximize" : "nativeMaximize";
        }
    } else if (!onTarget && state.layoutMode === MAXIMIZE_MODE) {
        state.pendingAction = "nativeRestore";
    }
}

function onMaximizedChanged(window) {
    const state = stateFor(window);
    if (state.internalChange || !state.pendingAction) return;
    const action = state.pendingAction;
    state.pendingAction = null;
    const managedColumn = columnIndexForWindow(window) >= 0 &&
        window.output === mainScreenState.targetOutput;
    if (managedColumn && action === "enterMaximize") {
        setPresentationMode(
            normalizeWindowUuid(window.internalId),
            PRESENTATION_MAXIMIZED,
            "native-maximize"
        );
        return;
    }
    if (managedColumn && action === "leaveMaximize") {
        const column = mainScreenState.columns[columnIndexForWindow(window)];
        setPresentationMode(
            normalizeWindowUuid(window.internalId),
            column && column.persistentWide
                ? PRESENTATION_WIDE
                : PRESENTATION_NORMAL,
            "native-restore"
        );
        return;
    }
    if (action === "enterMaximize") {
        applyLayoutGeometry(window, state, MAXIMIZE_MODE, "maximize-request");
    } else if (action === "leaveMaximize") {
        leavePseudoMaximize(window, state, "maximize-toggle");
    } else if (action === "nativeMaximize") {
        setLayoutMode(state, MAXIMIZE_MODE);
        debug(`NATIVE ${window.caption} mode=maximize output=${window.output.name}`);
    } else if (action === "nativeRestore") {
        clearLayoutState(state);
    }
    advanceWindowAdoption(window, `maximize-${action}`);
}

function onOutputChanged(window) {
    return outputController.onOutputChanged(window);
}

function onFullScreenChanged(window) {
    return fullscreenController.onFullscreenChanged(window);
}

function onInteractiveMoveResizeStarted(window) {
    const state = stateFor(window);
    if (floatingController.onInteractiveMoveResize(window)) return;
    if (state.internalChange || !isLayoutMode(state.layoutMode)) return;
    state.interactiveMoveResize = true;
    clearLayoutState(state);
    debug(`CLEAR ${window.caption} reason=interactive-move-resize`);
}

function setupWindow(window) {
    if (!window || states.has(window)) return;
    const state = stateFor(window);
    window.frameGeometryChanged.connect(oldGeometry =>
        onFrameGeometryChanged(window, oldGeometry));
    window.tileChanged.connect(() => applyDetectedTile(window, "tileChanged"));
    window.quickTileModeChanged.connect(() => applyDetectedTile(window, "quickTileModeChanged"));
    window.maximizedAboutToChange.connect(mode => onMaximizedAboutToChange(window, mode));
    window.maximizedChanged.connect(() => onMaximizedChanged(window));
    window.outputChanged.connect(() => onOutputChanged(window));
    window.fullScreenChanged.connect(() => onFullScreenChanged(window));
    if (window.skipTaskbarChanged) {
        window.skipTaskbarChanged.connect(() => {
            if (window.skipTaskbar && columnIndexForWindow(window) >= 0) {
                removeColumn(window, "skip-taskbar", false);
            }
        });
    }
    window.activeChanged.connect(() => {
        if (window.active && !layoutTransaction.isActive()) {
            adoptionController.onActivated(window, "active-changed");
        }
    });
    window.readyForPaintingChanged.connect(() => {
        adoptionController.onReady(window);
    });
    if (window.windowShown) {
        window.windowShown.connect(() => {
            adoptionController.onReady(window, "window-shown");
        });
    }
    window.interactiveMoveResizeStarted.connect(() => onInteractiveMoveResizeStarted(window));
    window.interactiveMoveResizeFinished.connect(() => {
        stateFor(window).interactiveMoveResize = false;
    });
    window.closed.connect(() => {
        removeColumn(window, "window-closed");
        floatingController.onWindowClosed(window);
        states.delete(window);
    });

    if (window.fullScreen) return;
    if (Number(window.maximizeMode) === FULL_MAXIMIZE_MODE) {
        setLayoutMode(state, MAXIMIZE_MODE);
        if (onManagedOutput(window)) {
            applyLayoutGeometry(window, state, MAXIMIZE_MODE, "startup-adopt-maximize");
        }
        return;
    }
    const tileMode = detectQuickTileMode(window);
    if (isTileMode(tileMode)) {
        setLayoutMode(state, tileMode);
        if (onManagedOutput(window)) {
            applyLayoutGeometry(window, state, tileMode, "startup-adopt-tile");
        }
    }
}

function reapplyManagedLayouts(reason) {
    states.forEach((state, window) => {
        if (!state.internalChange && !state.interactiveMoveResize && !window.fullScreen &&
                !state.managedByScrollLayout && onManagedOutput(window) &&
                isLayoutMode(state.layoutMode)) {
            applyLayoutGeometry(window, state, state.layoutMode, reason);
        }
    });
}

function connectManagedGeometry() {
    managedOutputs().forEach(output => {
        if (connectedManagedOutputs.has(output)) return;
        connectedManagedOutputs.add(output);
        output.geometryChanged.connect(() => {
            if (profileForOutput(output)) {
                reapplyManagedLayouts("managed-output-geometry-changed");
                relayout("managed-output-geometry-changed");
            }
        });
    });
}

function onScreensChanged() {
    connectedManagedOutputs = new Set();
    connectManagedGeometry();
    reapplyManagedLayouts("screens-changed");
    relayout("screens-changed");
}

const shortcuts = createShortcutCatalog({
    focusPrevious: () => focusRelativeColumn(-1),
    focusNext: () => focusRelativeColumn(1),
    toggleWide: () => toggleFocusWide(workspace.activeWindow),
    moveLeft: () => moveFocusedColumn(-1),
    moveRight: () => moveFocusedColumn(1),
    toggleFloating: () => toggleFloating(workspace.activeWindow),
    publishDockState: () => publishDockState("bridge-request"),
    applyDockCommand: applyPendingDockCommand,
    emergencyRestore: () => emergencyRestoreAllWindows("external-unload"),
});

const app = new CCNiri({
    controllers: controllerComposition,
    lifecycle: {
        workspace,
        setupWindow,
        onWindowAdded: window => {
            setupWindow(window);
            adoptionController.onWindowAdded(window);
        },
        onWindowActivated: onWindowActivatedForScrollLayout,
        onScreensChanged,
        onVirtualScreenGeometryChanged: () => {
            reapplyManagedLayouts("virtual-screen-geometry-changed");
            relayout("virtual-screen-geometry-changed");
        },
        connectManagedGeometry,
        initializeScrollLayout,
        markInitialized: value => { scrollLayoutInitialized = value; },
        registerShortcut,
        shortcuts,
        commitInitialState: () => commitDockState("script-start"),
    },
    onStarted: () => debug(
        `loaded primary=${resolveTargetOutput() ? resolveTargetOutput().name : "<none>"}` +
        ` secondary=${resolveSecondaryOutput() ? resolveSecondaryOutput().name : "<none>"}` +
        ` primaryOuter=${runtimeConfig.primary.top}/${runtimeConfig.primary.right}/` +
            `${runtimeConfig.primary.bottom}/${runtimeConfig.primary.left}` +
        ` secondaryOuter=${runtimeConfig.secondary.top}/${runtimeConfig.secondary.right}/` +
            `${runtimeConfig.secondary.bottom}/${runtimeConfig.secondary.left}`
    ),
    onStopping: () => emergencyRestoreAllWindows("runtime-stop"),
});

app.start();
