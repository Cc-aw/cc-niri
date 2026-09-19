import QtQuick
import QtQuick.Window
import org.kde.taskmanager 0.1 as TaskManager

Window {
    width: 1
    height: 1
    visible: true

    TaskManager.TasksModel {
        id: tasksModel
        sortMode: TaskManager.TasksModel.SortManual
        groupMode: TaskManager.TasksModel.GroupDisabled
        separateLaunchers: true
        launcherList: []
        taskReorderingEnabled: true
    }

    Timer {
        interval: 1500
        running: true
        repeat: false
        onTriggered: {
            console.warn("[cc-scroll-phase85-taskmodel] CONFIG" +
                " count=" + tasksModel.count +
                " sortManual=" + (tasksModel.sortMode === TaskManager.TasksModel.SortManual) +
                " groupDisabled=" + (tasksModel.groupMode === TaskManager.TasksModel.GroupDisabled))
            for (let row = 0; row < tasksModel.count; ++row) {
                const index = tasksModel.index(row, 0)
                const isWindow = tasksModel.data(index, TaskManager.AbstractTasksModel.IsWindow)
                const winIds = tasksModel.data(index, TaskManager.AbstractTasksModel.WinIdList)
                const appId = tasksModel.data(index, TaskManager.AbstractTasksModel.AppId)
                const display = tasksModel.data(index, Qt.DisplayRole)
                console.warn("[cc-scroll-phase85-taskmodel] TASK" +
                    " row=" + row +
                    " isWindow=" + isWindow +
                    " winIds=" + JSON.stringify(winIds) +
                    " appId=" + appId +
                    " display=" + display)
            }
            Qt.quit()
        }
    }
}
