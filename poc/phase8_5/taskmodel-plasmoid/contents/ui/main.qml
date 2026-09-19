import QtQuick
import org.kde.plasma.plasmoid
import org.kde.taskmanager 0.1 as TaskManager

PlasmoidItem {
    id: root
    preferredRepresentation: fullRepresentation
    implicitWidth: 1
    implicitHeight: 1

    function normalizeUuid(value) {
        return String(value || "").toLowerCase().replace(/^\{/, "").replace(/\}$/, "")
    }

    function order(model) {
        const result = []
        for (let row = 0; row < model.count; ++row) {
            const index = model.index(row, 0)
            const ids = model.data(index, TaskManager.AbstractTasksModel.WinIdList)
            if (ids && ids.length === 1) result.push(normalizeUuid(ids[0]))
        }
        return result.join(",")
    }

    TaskManager.TasksModel {
        id: modelA
        sortMode: TaskManager.TasksModel.SortManual
        groupMode: TaskManager.TasksModel.GroupDisabled
        separateLaunchers: true
        launcherList: []
        taskReorderingEnabled: true
    }

    TaskManager.TasksModel {
        id: modelB
        sortMode: TaskManager.TasksModel.SortManual
        groupMode: TaskManager.TasksModel.GroupDisabled
        separateLaunchers: true
        launcherList: []
        taskReorderingEnabled: true
    }

    Timer {
        interval: 2500
        running: true
        repeat: false
        onTriggered: {
            console.warn("[cc-scroll-phase85-shared-order] BEFORE A=" + root.order(modelA))
            console.warn("[cc-scroll-phase85-shared-order] BEFORE B=" + root.order(modelB))
            if (modelA.count >= 2) modelA.move(0, 1)
            verifyTimer.start()
        }
    }

    Timer {
        id: verifyTimer
        interval: 300
        repeat: false
        onTriggered: {
            console.warn("[cc-scroll-phase85-shared-order] MOVED A=" + root.order(modelA))
            console.warn("[cc-scroll-phase85-shared-order] MOVED B=" + root.order(modelB))
            if (modelA.count >= 2) modelA.move(1, 0)
            restoreTimer.start()
        }
    }

    Timer {
        id: restoreTimer
        interval: 300
        repeat: false
        onTriggered: {
            console.warn("[cc-scroll-phase85-shared-order] RESTORED A=" + root.order(modelA))
            console.warn("[cc-scroll-phase85-shared-order] RESTORED B=" + root.order(modelB))
        }
    }

    fullRepresentation: Item {
        implicitWidth: 1
        implicitHeight: 1
    }
}
