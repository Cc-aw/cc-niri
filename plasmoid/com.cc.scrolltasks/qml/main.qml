/*
    SPDX-FileCopyrightText: 2012-2016 Eike Hein <hein@kde.org>

    SPDX-License-Identifier: GPL-2.0-or-later
*/
pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts

import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.ksvg as KSvg
import org.kde.plasma.private.mpris as Mpris
import org.kde.kirigami as Kirigami

import org.kde.plasma.workspace.trianglemousefilter

import org.kde.taskmanager as TaskManager
import plasma.applet.com.cc.scrolltasks as TaskManagerApplet
import org.kde.plasma.workspace.dbus as DBus

PlasmoidItem {
    id: tasks

    // For making a bottom to top layout since qml flow can't do that.
    // We just hang the task manager upside down to achieve that.
    // This mirrors the tasks and group dialog as well, so we un-rotate them
    // to fix that (see Task.qml and GroupDialog.qml).
    rotation: Plasmoid.configuration.reverseMode && Plasmoid.formFactor === PlasmaCore.Types.Vertical ? 180 : 0

    readonly property bool shouldShrinkToZero: tasksModel.count === 0
    readonly property bool vertical: Plasmoid.formFactor === PlasmaCore.Types.Vertical
    readonly property bool iconsOnly: true

    property Task toolTipOpenedByClick
    property Task toolTipAreaItem
    property bool applyingRemoteOrder: false
    property bool dockUserReorderEnabled: true
    property string dockStateJson: ""
    property string dockSessionId: ""
    property int dockGeneration: -1
    property var dockManagedUuids: []
    property string dockPresentationUuid: ""
    property string dockPresentationMode: "normal"

    readonly property Component contextMenuComponent: Qt.createComponent("ContextMenu.qml")
    readonly property Component pulseAudioComponent: Qt.createComponent("PulseAudio.qml")

    property alias taskList: taskList

    preferredRepresentation: fullRepresentation

    Plasmoid.constraintHints: Plasmoid.CanFillArea

    Plasmoid.onUserConfiguringChanged: {
        if (Plasmoid.userConfiguring && groupDialog !== null) {
            groupDialog.visible = false;
        }
    }

    Layout.fillWidth: vertical ? true : Plasmoid.configuration.fill
    Layout.fillHeight: !vertical ? true : Plasmoid.configuration.fill
    Layout.minimumWidth: {
        if (shouldShrinkToZero) {
            return Kirigami.Units.gridUnit; // For edit mode
        }
        return vertical ? 0 : TaskManagerApplet.LayoutMetrics.preferredMinWidth();
    }
    Layout.minimumHeight: {
        if (shouldShrinkToZero) {
            return Kirigami.Units.gridUnit; // For edit mode
        }
        return !vertical ? 0 : TaskManagerApplet.LayoutMetrics.preferredMinHeight();
    }

//BEGIN TODO: this is not precise enough: launchers are smaller than full tasks
    Layout.preferredWidth: {
        if (shouldShrinkToZero) {
            return 0.01;
        }
        if (vertical) {
            return Kirigami.Units.gridUnit * 10;
        }
        return taskList.Layout.maximumWidth
    }
    Layout.preferredHeight: {
        if (shouldShrinkToZero) {
            return 0.01;
        }
        if (vertical) {
            return taskList.Layout.maximumHeight
        }
        return Kirigami.Units.gridUnit * 2;
    }
//END TODO

    property Item dragSource

    signal requestLayout

    function normalizeDockUuid(value): string {
        return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "");
    }

    function taskUuidAt(row): string {
        if (row < 0 || row >= tasksModel.count) {
            return "";
        }
        const index = tasksModel.index(row, 0);
        if (!tasksModel.data(index, TaskManager.AbstractTasksModel.IsWindow)) {
            return "";
        }
        const ids = tasksModel.data(index, TaskManager.AbstractTasksModel.WinIdList);
        return ids && ids.length === 1 ? normalizeDockUuid(ids[0]) : "";
    }

    function rowForDockUuid(uuid): int {
        for (let row = 0; row < tasksModel.count; ++row) {
            if (taskUuidAt(row) === uuid) {
                return row;
            }
        }
        return -1;
    }

    function firstWindowRow(): int {
        for (let row = 0; row < tasksModel.count; ++row) {
            if (taskUuidAt(row) !== "") {
                return row;
            }
        }
        return tasksModel.count;
    }

    function applyDockState(json): void {
        if (!json) {
            return;
        }
        let state;
        try {
            state = JSON.parse(String(json));
        } catch (error) {
            console.warn("[cc-scroll-tasks] invalid state JSON", error);
            return;
        }
        if (state.protocol !== 1 || !state.sessionId || !Array.isArray(state.columns)) {
            console.warn("[cc-scroll-tasks] invalid state schema");
            return;
        }
        if (state.sessionId === dockSessionId && Number(state.generation) < dockGeneration) {
            return;
        }

        const desired = state.columns.map(column => normalizeDockUuid(column.uuid));
        const unique = new Set(desired);
        if (unique.size !== desired.length || desired.some(uuid => !uuid)) {
            console.warn("[cc-scroll-tasks] rejected duplicate or empty UUID state");
            return;
        }
        const missing = desired.filter(uuid => rowForDockUuid(uuid) < 0);
        if (missing.length > 0) {
            const present = [];
            for (let row = 0; row < tasksModel.count; ++row) {
                const uuid = taskUuidAt(row);
                if (uuid) present.push(uuid);
            }
            dockStateJson = String(json);
            console.warn("[cc-scroll-tasks] waiting for TaskModel UUID mapping" +
                " missing=" + missing.join(",") +
                " present=" + present.join(","));
            return;
        }

        applyingRemoteOrder = true;
        try {
            const baseRow = firstWindowRow();
            for (let target = 0; target < desired.length; ++target) {
                const currentRow = rowForDockUuid(desired[target]);
                const targetRow = baseRow + target;
                if (currentRow !== targetRow && !tasksModel.move(currentRow, targetRow)) {
                    console.warn("[cc-scroll-tasks] TasksModel.move failed", currentRow, targetRow);
                    return;
                }
            }
            dockStateJson = String(json);
            dockSessionId = String(state.sessionId);
            dockGeneration = Number(state.generation);
            dockManagedUuids = desired;
            const presentation = state.presentation || {};
            dockPresentationUuid = normalizeDockUuid(presentation.windowUuid);
            dockPresentationMode = ["normal", "wide", "maximized"].includes(
                String(presentation.mode)) ? String(presentation.mode) : "normal";
            console.info("[cc-scroll-tasks] applied generation=" + dockGeneration +
                " columns=" + desired.length);
        } finally {
            applyingRemoteOrder = false;
        }
    }

    function requestDockState(): void {
        if (!dockBridgeWatcher.registered) {
            return;
        }
        DBus.SessionBus.asyncCall({
            service: "org.cc.ScrollDockBridge",
            path: "/ScrollDock",
            iface: "org.cc.ScrollDockBridge1",
            member: "GetState",
            arguments: [],
            signature: "()"
        }, reply => {
            applyDockState(reply.value);
            reply.destroy();
        }, reply => {
            console.warn("[cc-scroll-tasks] GetState failed", reply.error.message);
            reply.destroy();
        });
    }

    function currentManagedOrder(): var {
        const managed = new Set(dockManagedUuids);
        const order = [];
        for (let row = 0; row < tasksModel.count; ++row) {
            const uuid = taskUuidAt(row);
            if (managed.has(uuid)) {
                order.push(uuid);
            }
        }
        return order;
    }

    function requestDockReorder(): void {
        if (applyingRemoteOrder || !dockBridgeWatcher.registered ||
                !dockSessionId || dockGeneration < 0) {
            return;
        }
        const order = currentManagedOrder();
        const unique = new Set(order);
        if (order.length !== dockManagedUuids.length || unique.size !== order.length ||
                dockManagedUuids.some(uuid => !unique.has(uuid))) {
            console.warn("[cc-scroll-tasks] local reorder has invalid managed UUID set");
            requestDockState();
            return;
        }
        const command = {
            protocol: 1,
            commandId: dockSessionId + "-" + Date.now() + "-" +
                Math.floor(Math.random() * 0x100000000).toString(16),
            sessionId: dockSessionId,
            baseGeneration: dockGeneration,
            type: "set-column-order",
            order: order
        };
        DBus.SessionBus.asyncCall({
            service: "org.cc.ScrollDockBridge",
            path: "/ScrollDock",
            iface: "org.cc.ScrollDockBridge1",
            member: "RequestReorder",
            arguments: [JSON.stringify(command)],
            signature: "(s)"
        }, reply => {
            if (!reply.value) {
                console.warn("[cc-scroll-tasks] bridge rejected reorder command");
                requestDockState();
            }
            reply.destroy();
        }, reply => {
            console.warn("[cc-scroll-tasks] RequestReorder failed", reply.error.message);
            reply.destroy();
            requestDockState();
        });
    }

    function presentationModeFor(uuid): string {
        const normalized = normalizeDockUuid(uuid);
        return normalized && normalized === dockPresentationUuid
            ? dockPresentationMode
            : "normal";
    }

    function requestPresentationMode(uuid, mode): void {
        const normalized = normalizeDockUuid(uuid);
        if (!dockBridgeWatcher.registered || !dockSessionId || dockGeneration < 0 ||
                !dockManagedUuids.includes(normalized) ||
                !["normal", "wide", "maximized"].includes(String(mode))) {
            requestDockState();
            return;
        }
        const command = {
            protocol: 1,
            commandId: dockSessionId + "-presentation-" + Date.now() + "-" +
                Math.floor(Math.random() * 0x100000000).toString(16),
            sessionId: dockSessionId,
            baseGeneration: dockGeneration,
            type: "set-presentation-mode",
            windowUuid: normalized,
            mode: String(mode)
        };
        DBus.SessionBus.asyncCall({
            service: "org.cc.ScrollDockBridge",
            path: "/ScrollDock",
            iface: "org.cc.ScrollDockBridge1",
            member: "RequestCommand",
            arguments: [JSON.stringify(command)],
            signature: "(s)"
        }, reply => {
            if (!reply.value) {
                console.warn("[cc-scroll-tasks] bridge rejected presentation command");
                requestDockState();
            }
            reply.destroy();
        }, reply => {
            console.warn("[cc-scroll-tasks] RequestCommand failed", reply.error.message);
            reply.destroy();
            requestDockState();
        });
    }

    function requestDockFocusRight(uuid, fallbackModelIndex): bool {
        const normalized = normalizeDockUuid(uuid);
        if (!dockBridgeWatcher.registered || !dockSessionId || dockGeneration < 0 ||
                !dockManagedUuids.includes(normalized)) {
            return false;
        }
        const command = {
            protocol: 1,
            commandId: dockSessionId + "-focus-right-" + Date.now() + "-" +
                Math.floor(Math.random() * 0x100000000).toString(16),
            sessionId: dockSessionId,
            baseGeneration: dockGeneration,
            type: "focus-column-right",
            windowUuid: normalized
        };
        DBus.SessionBus.asyncCall({
            service: "org.cc.ScrollDockBridge",
            path: "/ScrollDock",
            iface: "org.cc.ScrollDockBridge1",
            member: "RequestCommand",
            arguments: [JSON.stringify(command)],
            signature: "(s)"
        }, reply => {
            if (!reply.value) {
                console.warn("[cc-scroll-tasks] bridge rejected Dock focus command");
                tasksModel.requestActivate(fallbackModelIndex);
                requestDockState();
            }
            reply.destroy();
        }, reply => {
            console.warn("[cc-scroll-tasks] Dock focus command failed", reply.error.message);
            reply.destroy();
            tasksModel.requestActivate(fallbackModelIndex);
            requestDockState();
        });
        return true;
    }

    onDragSourceChanged: {
        if (dragSource === null) {
            tasksModel.syncLaunchers();
        }
    }

    function windowsHovered(winIds: var, hovered: bool): DBus.DBusPendingReply {
        if (!Plasmoid.configuration.highlightWindows) {
            return;
        }
        return DBus.SessionBus.asyncCall({service: "org.kde.KWin.HighlightWindow", path: "/org/kde/KWin/HighlightWindow", iface: "org.kde.KWin.HighlightWindow", member: "highlightWindows", arguments: [hovered ? winIds : []], signature: "(as)"});
    }

    function cancelHighlightWindows(): DBus.DBusPendingReply {
        return DBus.SessionBus.asyncCall({service: "org.kde.KWin.HighlightWindow", path: "/org/kde/KWin/HighlightWindow", iface: "org.kde.KWin.HighlightWindow", member: "highlightWindows", arguments: [[]], signature: "(as)"});
    }

    function activateWindowView(winIds: var): DBus.DBusPendingReply {
        if (!effectWatcher.registered) {
            return;
        }
        cancelHighlightWindows();
        return DBus.SessionBus.asyncCall({service: "org.kde.KWin.Effect.WindowView1", path: "/org/kde/KWin/Effect/WindowView1", iface: "org.kde.KWin.Effect.WindowView1", member: "activate", arguments: [winIds.map(s => String(s))], signature: "(as)"});
    }

    function publishIconGeometries(taskItems: /*list<Item>*/var): void {
        if (TaskManagerApplet.TaskTools.taskManagerInstanceCount >= 2) {
            return;
        }
        for (let i = 0; i < taskItems.length - 1; ++i) {
            const task = taskItems[i];

            if (!task.model.IsLauncher && !task.model.IsStartup) {
                tasksModel.requestPublishDelegateGeometry(tasksModel.makeModelIndex(task.index),
                    backend.globalRect(task), task);
            }
        }
    }

    readonly property TaskManager.TasksModel tasksModel: TaskManager.TasksModel {
        id: tasksModel

        readonly property int logicalLauncherCount: {
            if (Plasmoid.configuration.separateLaunchers) {
                return launcherCount;
            }

            let startupsWithLaunchers = 0;

            for (let i = 0; i < taskRepeater.count; ++i) {
                const item = taskRepeater.itemAt(i) as Task;

                // During destruction required properties such as item.model can go null for a while,
                // so in paths that can trigger on those moments, they need to be guarded
                if (item?.model?.IsStartup && item.model.HasLauncher) {
                    ++startupsWithLaunchers;
                }
            }

            return launcherCount + startupsWithLaunchers;
        }

        screenGeometry: Plasmoid.containment.screenGeometry
        activity: activityInfo.currentActivity

        filterByCurrentVirtualDesktop: false
        filterByScreen: true
        filterByActivity: false
        filterNotMinimized: Plasmoid.configuration.showOnlyMinimized

        hideActivatedLaunchers: tasks.iconsOnly || Plasmoid.configuration.hideLauncherOnStart
        sortMode: TaskManager.TasksModel.SortManual
        // Column UUID order is independent of pinned launcher slots. Keeping
        // running windows in launcher positions would make a pinned window
        // immovable across the manual task section.
        launchInPlace: false
        separateLaunchers: {
            if (!tasks.iconsOnly && !Plasmoid.configuration.separateLaunchers
                && Plasmoid.configuration.sortingStrategy === 1) {
                return false;
            }

            return true;
        }

        groupMode: TaskManager.TasksModel.GroupDisabled
        taskReorderingEnabled: true
        groupInline: !Plasmoid.configuration.groupPopups && !tasks.iconsOnly
        groupingWindowTasksThreshold: (Plasmoid.configuration.onlyGroupWhenFull && !tasks.iconsOnly
            ? TaskManagerApplet.LayoutMetrics.optimumCapacity(tasks.width, tasks.height) + 1 : -1)

        onLauncherListChanged: {
            Plasmoid.configuration.launchers = launcherList;
        }

        onGroupingAppIdBlacklistChanged: {
            Plasmoid.configuration.groupingAppIdBlacklist = groupingAppIdBlacklist;
        }

        onGroupingLauncherUrlBlacklistChanged: {
            Plasmoid.configuration.groupingLauncherUrlBlacklist = groupingLauncherUrlBlacklist;
        }

        onCountChanged: {
            if (tasks.dockStateJson) {
                Qt.callLater(tasks.applyDockState, tasks.dockStateJson);
            }
        }

        function sortModeEnumValue(index: int): /*TaskManager.TasksModel.SortMode*/ int {
            switch (index) {
            case 0:
                return TaskManager.TasksModel.SortDisabled;
            case 1:
                return TaskManager.TasksModel.SortManual;
            case 2:
                return TaskManager.TasksModel.SortAlpha;
            case 3:
                return TaskManager.TasksModel.SortVirtualDesktop;
            case 4:
                return TaskManager.TasksModel.SortActivity;
            // 5 is SortLastActivated, skipped
            case 6:
                return TaskManager.TasksModel.SortWindowPositionHorizontal;
            default:
                return TaskManager.TasksModel.SortDisabled;
            }
        }

        function groupModeEnumValue(index: int): /*TaskManager.TasksModel.GroupMode*/ int {
            switch (index) {
            case 0:
                return TaskManager.TasksModel.GroupDisabled;
            case 1:
                return TaskManager.TasksModel.GroupApplications;
            }
        }

        Component.onCompleted: {
            launcherList = Plasmoid.configuration.launchers;
            groupingAppIdBlacklist = Plasmoid.configuration.groupingAppIdBlacklist;
            groupingLauncherUrlBlacklist = Plasmoid.configuration.groupingLauncherUrlBlacklist;

            // Only hook up view only after the above churn is done.
            taskRepeater.model = tasksModel;
        }
    }

    readonly property TaskManagerApplet.Backend backend: TaskManagerApplet.Backend {
        id: backend

        onAddLauncher: url => {
            tasks.addLauncher(url);
        }
    }

    DBus.DBusServiceWatcher {
        id: effectWatcher
        busType: DBus.BusType.Session
        watchedService: "org.kde.KWin.Effect.WindowView1"
    }

    DBus.DBusServiceWatcher {
        id: dockBridgeWatcher
        busType: DBus.BusType.Session
        watchedService: "org.cc.ScrollDockBridge"
        onRegisteredChanged: {
            if (registered) {
                tasks.requestDockState();
            }
        }
    }

    DBus.SignalWatcher {
        busType: DBus.BusType.Session
        service: "org.cc.ScrollDockBridge"
        path: "/ScrollDock"
        iface: "org.cc.ScrollDockBridge1"
        enabled: dockBridgeWatcher.registered

        function dbusStateChanged(json) {
            tasks.applyDockState(json);
        }
    }

    readonly property Component taskInitComponent: Component {
        Timer {
            interval: 200
            running: true

            onTriggered: {
                const task = parent as Task;
                if (task) {
                    tasks.tasksModel.requestPublishDelegateGeometry(task.modelIndex(), tasks.backend.globalRect(task), task);
                }
                destroy();
            }
        }
    }

    Connections {
        target: Plasmoid

        function onLocationChanged(): void {
            if (TaskManagerApplet.TaskTools.taskManagerInstanceCount >= 2) {
                return;
            }
            // This is on a timer because the panel may not have
            // settled into position yet when the location prop-
            // erty updates.
            iconGeometryTimer.start();
        }
    }

    Connections {
        target: Plasmoid.containment

        function onScreenGeometryChanged(): void {
            iconGeometryTimer.start();
        }
    }

    Mpris.Mpris2Model {
        id: mpris2Source
    }

    Item {
        anchors.fill: parent

        TaskManager.VirtualDesktopInfo {
            id: virtualDesktopInfo
        }

        TaskManager.ActivityInfo {
            id: activityInfo
            readonly property string nullUuid: "00000000-0000-0000-0000-000000000000"
        }

        Loader {
            id: pulseAudio
            sourceComponent: tasks.pulseAudioComponent
            active: tasks.pulseAudioComponent.status === Component.Ready
        }

        Timer {
            id: iconGeometryTimer

            interval: 500
            repeat: false

            onTriggered: {
                tasks.publishIconGeometries(taskList.children, tasks);
            }
        }

        Binding {
            target: Plasmoid
            property: "status"
            value: (tasksModel.anyTaskDemandsAttention && Plasmoid.configuration.unhideOnAttention
                ? PlasmaCore.Types.NeedsAttentionStatus : PlasmaCore.Types.PassiveStatus)
            restoreMode: Binding.RestoreBinding
        }

        Connections {
            target: Plasmoid.configuration

            function onLaunchersChanged(): void {
                tasksModel.launcherList = Plasmoid.configuration.launchers
            }
            function onGroupingAppIdBlacklistChanged(): void {
                tasksModel.groupingAppIdBlacklist = Plasmoid.configuration.groupingAppIdBlacklist;
            }
            function onGroupingLauncherUrlBlacklistChanged(): void {
                tasksModel.groupingLauncherUrlBlacklist = Plasmoid.configuration.groupingLauncherUrlBlacklist;
            }
        }

        Component {
            id: busyIndicator
            PlasmaComponents3.BusyIndicator {}
        }

        // Save drag data
        Item {
            id: dragHelper

            Drag.dragType: Drag.Automatic
            Drag.supportedActions: Qt.CopyAction | Qt.MoveAction | Qt.LinkAction
            Drag.onDragFinished: dropAction => {
                tasks.dragSource = null;
            }
        }

        KSvg.FrameSvgItem {
            id: taskFrame

            visible: false

            imagePath: "widgets/tasks"
            prefix: TaskManagerApplet.TaskTools.taskPrefix("normal", Plasmoid.location)
        }

        MouseHandler {
            id: mouseHandler

            anchors.fill: parent

            target: taskList

            onUrlsDropped: urls => {
                // If all dropped URLs point to application desktop files, we'll add a launcher for each of them.
                const createLaunchers = urls.every(item => tasks.backend.isApplication(item));

                if (createLaunchers) {
                    urls.forEach(item => addLauncher(item));
                    return;
                }

                if (!hoveredItem) {
                    return;
                }

                // Otherwise we'll just start a new instance of the application with the URLs as argument,
                // as you probably don't expect some of your files to open in the app and others to spawn launchers.
                tasksModel.requestOpenUrls((hoveredItem as Task).modelIndex(), urls);
            }
        }

        ToolTipDelegate {
            id: openWindowToolTipDelegate
            visible: false
        }

        ToolTipDelegate {
            id: pinnedAppToolTipDelegate
            visible: false
        }

        TriangleMouseFilter {
            id: tmf
            filterTimeOut: 300
            active: tasks.toolTipAreaItem && tasks.toolTipAreaItem.toolTipOpen
            blockFirstEnter: false

            edge: {
                switch (Plasmoid.location) {
                case PlasmaCore.Types.BottomEdge:
                    return Qt.TopEdge;
                case PlasmaCore.Types.TopEdge:
                    return Qt.BottomEdge;
                case PlasmaCore.Types.LeftEdge:
                    return Qt.RightEdge;
                case PlasmaCore.Types.RightEdge:
                    return Qt.LeftEdge;
                default:
                    return Qt.TopEdge;
                }
            }

            LayoutMirroring.enabled: tasks.shouldBeMirrored(Plasmoid.configuration.reverseMode, Application.layoutDirection, tasks.vertical)
            anchors {
                left: parent.left
                top: parent.top
            }

            height: taskList.height
            width: taskList.width

            TaskList {
                id: taskList

                LayoutMirroring.enabled: tasks.shouldBeMirrored(Plasmoid.configuration.reverseMode, Application.layoutDirection, tasks.vertical)
                anchors {
                    left: parent.left
                    top: parent.top
                }

                count: tasksModel.count

                readonly property real widthOccupation: taskRepeater.count / columns
                readonly property real heightOccupation: taskRepeater.count / rows

                Layout.maximumWidth: {
                    const totalMaxWidth = children.reduce((accumulator, child) => {
                            if (!isFinite(child.Layout.maximumWidth)) {
                                return accumulator;
                            }
                            return accumulator + child.Layout.maximumWidth
                        }, 0);
                    return Math.round(totalMaxWidth / widthOccupation);
                }
                Layout.maximumHeight: {
                    const totalMaxHeight = children.reduce((accumulator, child) => {
                            if (!isFinite(child.Layout.maximumHeight)) {
                                return accumulator;
                            }
                            return accumulator + child.Layout.maximumHeight
                        }, 0);
                    return Math.round(totalMaxHeight / heightOccupation);
                }
                width: {
                    if (tasks.shouldShrinkToZero) {
                        return 0;
                    }
                    if (tasks.vertical) {
                        return tasks.width * Math.min(1, widthOccupation);
                    } else {
                        return Math.min(tasks.width, Layout.maximumWidth);
                    }
                }
                height: {
                    if (tasks.shouldShrinkToZero) {
                        return 0;
                    }
                    if (tasks.vertical) {
                        return Math.min(tasks.height, Layout.maximumHeight);
                    } else {
                        return tasks.height * Math.min(1, heightOccupation);
                    }
                }

                flow: {
                    if (tasks.vertical) {
                        return Plasmoid.configuration.forceStripes ? Grid.LeftToRight : Grid.TopToBottom
                    }
                    return Plasmoid.configuration.forceStripes ? Grid.TopToBottom : Grid.LeftToRight
                }

                onAnimatingChanged: {
                    if (!animating) {
                        tasks.publishIconGeometries(children, tasks);
                    }
                }

                Repeater {
                    id: taskRepeater

                    delegate: Task {
                        tasksRoot: tasks
                    }
                }
            }
        }
    }

    readonly property Component groupDialogComponent: Qt.createComponent("GroupDialog.qml")
    property GroupDialog groupDialog

    readonly property bool supportsLaunchers: true

    function hasLauncher(url: url): bool {
        return tasksModel.launcherPosition(url) !== -1;
    }

    function addLauncher(url: url): void {
        if (Plasmoid.immutability !== PlasmaCore.Types.SystemImmutable) {
            tasksModel.requestAddLauncher(url);
        }
    }

    function removeLauncher(url: url): void {
        if (Plasmoid.immutability !== PlasmaCore.Types.SystemImmutable) {
            tasksModel.requestRemoveLauncher(url);
        }
    }

    // This is called by plasmashell in response to a Meta+number shortcut.
    // TODO: Change type to int
    function activateTaskAtIndex(index: var): void {
        if (typeof index !== "number") {
            return;
        }

        const task = taskRepeater.itemAt(index) as Task;
        if (task) {
            TaskManagerApplet.TaskTools.activateTask(task.modelIndex(), task.model, null, task, Plasmoid, this, effectWatcher.registered);
        }
    }

    function createContextMenu(rootTask, modelIndex, args = {}) {
        const initialArgs = Object.assign(args, {
            visualParent: rootTask,
            modelIndex,
            mpris2Source,
            backend,
            tasksRoot: tasks,
        });
        return contextMenuComponent.createObject(rootTask, initialArgs);
    }

    function shouldBeMirrored(reverseMode, layoutDirection, vertical): bool {
        // LayoutMirroring is only horizontal
        if (vertical) {
            return layoutDirection === Qt.RightToLeft;
        }

        if (layoutDirection === Qt.LeftToRight) {
            return reverseMode;
        }
        return !reverseMode;
    }

    Component.onCompleted: {
        TaskManagerApplet.TaskTools.taskManagerInstanceCount += 1;
        requestLayout.connect(iconGeometryTimer.restart);
        requestDockState();
    }

    Component.onDestruction: {
        TaskManagerApplet.TaskTools.taskManagerInstanceCount -= 1;
    }
}
