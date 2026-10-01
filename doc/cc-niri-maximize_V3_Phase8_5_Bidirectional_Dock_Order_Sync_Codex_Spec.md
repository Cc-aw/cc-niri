# `cc-niri-maximize` V3 Phase 8.5：Dock ↔ Logical Column 双向顺序同步实现规格

> 交给 Codex 直接实现。
>
> 目标：让主屏底部 Dock 中的运行窗口顺序与 `cc-niri-maximize` 的 `columns[]` 逻辑顺序始终一致，并实现真正的双向通信：
>
> ```text
> KWin columns[] reorder
>     → Dock 自动同步
>
> Dock 拖动 task reorder
>     → KWin columns[] 自动同步
>     → scrolling layout 立即重排
> ```
>
> 核心原则：
>
> ```text
> columns[] = canonical source of truth
> Dock       = synchronized view + reorder controller
> ```
>
> Dock 只能发起 reorder request；最终 commit 必须由 KWin Column Model 完成。

---

## 1. 前置条件

Phase 8.5 开始前，以下内容应已稳定：

```text
Phase 0–5
- Column model
- logicalX
- scrollOffsetX
- relayout()
- Meta+H/L
- minimal scrolling

Phase 5.5
- Parking / viewport virtualization
- parked windows 保持主屏 output ownership

Phase 6
- Meta+Shift+H/L Move Column

Phase 7
- Meta+R Cycle Width

Phase 8
- windowAdded / auto insertion
- window close/removal
```

尤其：

```text
columns[]
```

必须已经可靠表达 Logical Strip 的真实顺序。

---

## 2. 用户体验目标

假设：

```text
columns[]:

VS Code → ChatGPT → Zen → Dolphin → Terminal
```

Dock managed-window 区必须严格显示：

```text
[VS] [GPT] [Zen] [Files] [Terminal]
```

无论某个窗口：

```text
当前 visible
停在 Parking Zone
临时 pseudo-maximized
临时 Quick Tile
```

Dock slot 都只由 `columns[]` 决定。

---

## 3. Dock → KWin 反向 reorder

例如：

```text
Dock Before:
[VS] [GPT] [Zen] [Files]
```

用户把 Zen 拖到 GPT 左边：

```text
Dock optimistic order:
[VS] [Zen] [GPT] [Files]
```

Dock 发送 reorder request。

KWin 校验后 commit：

```text
columns[]:

VS → Zen → ChatGPT → Dolphin
```

然后：

```text
recomputeLogicalLayout()
ensureFocusedVisible()
relayout()
generation++
publishDockState()
```

最后 Dock 收到 KWin authoritative snapshot。

---

## 4. Source of Truth 只有一个

禁止：

```text
Dock 保存一套永久 order
KWin 又保存一套 columns[] order
```

正确语义：

```text
KWin columns[]
=
canonical committed state
```

Dock 的拖动只产生：

```text
ReorderRequest
```

KWin commit 后再广播正式状态。

---

## 5. 不能按 frameGeometry.x 排序

Phase 5.5 后：

```text
logical:
A B C D E

physical:
Parking: E C A
Viewport: B D
```

所以：

```text
frameGeometry.x != logical order
```

Dock 禁止根据物理 geometry 排序。

---

## 6. Window Identity：UUID

禁止使用：

```text
caption
PID
desktopFileName
AppId
resourceClass
```

作为窗口唯一标识。

KWin：

```text
Window.internalId
```

Plasma TaskManager：

```text
WinIdList
```

优先建立 1:1 UUID 映射。

---

## 7. UUID POC

先打开至少：

```text
Konsole #1
Konsole #2
Dolphin
Zen
```

KWin 打印：

```text
window.internalId.toString()
caption
```

TaskModel 打印：

```text
WinIdList
display
```

确认：

```text
KWin internalId
↔
TaskManager WinIdList[0]
```

统一 normalization：

```text
lowercase
strip leading/trailing {}
```

如果 UUID 不能可靠一一对应，停止 Phase 8.5，不允许 fallback 到 caption/PID 猜测。

---

## 8. Managed Tasks 禁止 Grouping

Scrolling layout：

```text
1 Column = 1 Window
```

Dock：

```text
1 Icon = 1 Window
```

因此 managed task model 必须：

```text
GroupDisabled
```

否则：

```text
Konsole1 → VS Code → Konsole2
```

会被错误折叠成：

```text
Konsole ×2
VS Code
```

---

## 9. Pinned Launchers 不参与 Column 排序

建议 Dock 逻辑分区：

```text
Pinned │ Managed Columns │ Floating │ Secondary
```

Phase 8.5 P0 只同步：

```text
Managed Columns
```

Pinned 保持左侧固定。

---

## 10. Secondary Screen Tasks 不参加本 Phase

副屏 SSH/Terminal 区继续现有实现。

Phase 8.5 只同步：

```text
target/main-output managed columns
```

---

## 11. Temporary Override 不改变 Dock slot

例如：

```text
A B [C] D
```

C 临时进入：

```text
Pseudo Maximize
Quick Tile
Fullscreen
```

Dock 仍然：

```text
[A][B][C][D]
```

因为 C 的 logical Column 位置没有变化。

---

# 12. 双向 IPC 的现实约束

普通 KWin JavaScript Scripting API 支持：

```text
callDBus(...)
```

也就是：

```text
KWin Script → D-Bus service
```

但不要假定普通 KWin JS Script 可以直接暴露任意自定义 D-Bus method 或监听任意自定义 D-Bus signal。

因此 Phase 8.5 推荐增加一个非常小的、纯事件驱动的 IPC bridge。

---

# 13. 总体架构

```text
                  KWin
         cc-niri-maximize
                │
                │ PublishState()
                ▼
       ┌────────────────────┐
       │ CC Scroll Bridge   │
       │ Qt6 + QtDBus       │
       │                    │
       │ last state         │
       │ pending commands   │
       └────────────────────┘
          │             ▲
 StateChanged          │ RequestReorder
          │             │
          ▼             │
    CC Scroll Tasks Plasmoid
```

反向：

```text
Dock RequestReorder
        ↓
Bridge queues command
        ↓
KGlobalAccel invokeShortcut
        ↓
KWin registered callback wakes
        ↓
KWin callDBus TakePendingCommand()
        ↓
validate → commit columns[] → relayout()
        ↓
PublishState()
```

---

# 14. Bridge 职责

Bridge **不是 Window Manager**。

禁止 Bridge：

```text
修改 geometry
修改 columns[]
决定 focus
自己重排 KWin window
```

它只负责：

```text
IPC relay
保存最后 snapshot
暂存 Dock command
event-driven 唤醒 KWin command callback
```

---

# 15. Bridge 技术实现

建议：

```text
cc-scroll-dock-bridge
```

Qt6 C++ 小进程，仅依赖：

```text
Qt6::Core
Qt6::DBus
```

D-Bus：

```text
Service:
org.cc.ScrollDockBridge

Path:
/ScrollDock

Interface:
org.cc.ScrollDockBridge1
```

---

# 16. IPC 数据统一使用 JSON String

避免复杂 D-Bus 自定义结构。

Methods：

```text
PublishState(QString json)
RequestReorder(QString json)
TakePendingCommand() -> QString
GetState() -> QString
```

Signal：

```text
StateChanged(QString json)
```

---

# 17. KWin → Bridge State Schema

推荐：

```json
{
  "protocol": 1,
  "sessionId": "3eb89f4a-...",
  "generation": 83,
  "targetOutput": "DP-1",
  "focusedUuid": "uuid-c",
  "columns": [
    {
      "uuid": "uuid-a",
      "widthMode": "half"
    },
    {
      "uuid": "uuid-c",
      "widthMode": "twoThirds"
    },
    {
      "uuid": "uuid-b",
      "widthMode": "third"
    }
  ]
}
```

Phase 8.5 排序真正需要：

```text
sessionId
generation
focusedUuid
ordered UUID list
```

---

# 18. sessionId

KWin Script 每次 load 生成新：

```text
sessionId
```

用于区分：

```text
script reload 前后
```

Bridge 发现 sessionId 改变：

```text
清空旧 pending command
替换 lastState
通知 Dock
```

---

# 19. generation

每次 logical committed state 改变：

```text
generation++
```

至少包括：

```text
Column reorder
window insert
window remove
Managed/Floating transition（未来）
跨屏 transition（未来）
```

---

# 20. KWin Publish API

新增：

```js
publishDockState(reason)
```

内部：

```text
callDBus(
  "org.cc.ScrollDockBridge",
  "/ScrollDock",
  "org.cc.ScrollDockBridge1",
  "PublishState",
  JSON.stringify(snapshot)
)
```

调用时机：

```text
Meta+Shift+H/L reorder 后
windowAdded 后
windowClosed 后
Dock reorder commit 后
script startup
```

---

# 21. Bridge → Dock

Bridge 收到：

```text
PublishState
```

后：

```text
lastState = state
emit StateChanged(json)
```

Dock 启动：

```text
GetState()
```

之后监听：

```text
StateChanged
```

禁止 timer polling。

---

# 22. Dock 实现

不要外部操纵现有 `org.kde.plasma.icontasks` 黑盒对象。

推荐新增：

```text
CC Scroll Tasks
```

Plasma 6 Plasmoid。

尽可能基于当前 KDE：

```text
org.kde.plasma.icontasks
org.kde.plasma.taskmanager
```

做最小 fork/复用。

保留 KDE 原生：

```text
delegate
tooltip
right-click menu
audio indicator
progress
activation
middle click
drag behavior
```

只增加：

```text
logical order sync
D-Bus bridge client
```

---

# 23. 不要重写 Task UI

如果实现开始自行重写：

```text
Icon
MouseArea
ContextMenu
Tooltip
GroupDialog
```

说明方向偏了。

---

# 24. TaskModel P0 配置

Managed task section：

```text
SortManual
GroupDisabled
window-only
```

Launcher 尽量关闭/分离。

---

# 25. Task UUID 获取

每个 managed task：

```text
IsWindow == true
WinIdList.length == 1
```

normalize：

```text
taskUuid
```

无法映射时：

```text
skip reorder
debug warning
request authoritative resync
```

禁止猜。

---

# 26. KWin → Dock Order Apply

KWin snapshot：

```text
[A, C, B, D]
```

当前 TaskModel：

```text
[A, B, C, D]
```

使用：

```text
TasksModel SortManual
TasksModel.move(...)
```

将 UI 变为：

```text
[A, C, B, D]
```

---

# 27. 推荐 move 算法

每一步重新构建：

```text
uuid → current row
```

例如 desired：

```text
[A,C,B,D]
```

流程：

```text
target 0: A already correct
target 1: C currentRow=2 → move(2,1)
rebuild map
target 2: B correct
...
```

---

# 28. Remote Apply Guard

Dock 增加：

```text
applyingRemoteOrder
```

当 KWin state 驱动：

```text
tasksModel.move(...)
```

期间：

```text
禁止发送 RequestReorder
```

否则会 feedback loop。

---

# 29. Dock 用户 Drag

用户真正 drop 完成后：

```text
if applyingRemoteOrder:
    return
```

收集 managed UUID 顺序：

```text
[A,D,B,C]
```

发：

```text
RequestReorder(json)
```

只在 drop/committed move 后发一次，不要 pointer move 每帧发。

---

# 30. Dock → Bridge Request Schema

```json
{
  "protocol": 1,
  "commandId": "uuid-command",
  "sessionId": "current-session-id",
  "baseGeneration": 83,
  "type": "set-column-order",
  "order": [
    "uuid-a",
    "uuid-d",
    "uuid-b",
    "uuid-c"
  ]
}
```

---

# 31. baseGeneration

解决 stale drag。

例如：

```text
Dock 看到 gen=83
用户开始拖
期间 KWin 新增窗口 → gen=84
Dock 发 base=83
```

KWin 必须 reject。

禁止旧 Dock state 覆盖新 columns[]。

---

# 32. Stale Command

KWin：

```text
baseGeneration != currentGeneration
```

则：

```text
不修改 columns[]
publish 当前 authoritative state
```

P0 不做 merge。

---

# 33. Bridge Pending Command

`RequestReorder(json)`：

```text
基本 JSON 校验
保存 pending command
触发 KWin command pump
```

Bridge 不理解/修改 columns[]。

---

# 34. KWin 反向 command wakeup

由于普通 KWin JS 不应依赖自定义 inbound D-Bus callback，使用 KGlobalAccel 作为 event wakeup。

KWin 注册内部 action：

```text
CC Scroll Apply Dock Command
```

推荐：

```js
registerShortcut(
    "CC Scroll Apply Dock Command",
    "CC Scroll: Apply Dock Command",
    "",
    applyPendingDockCommand
)
```

默认不绑定物理按键。

---

# 35. 必须先做 KGlobalAccel POC

检查：

```bash
qdbus org.kde.kglobalaccel \
  /component/kwin \
  org.kde.kglobalaccel.Component.shortcutNames
```

确认 action 出现。

再：

```bash
qdbus org.kde.kglobalaccel \
  /component/kwin \
  org.kde.kglobalaccel.Component.invokeShortcut \
  "CC Scroll Apply Dock Command"
```

确认 callback 被执行。

---

# 36. 如果空 keySequence action 不可 invoke

停止正式双向实现。

不要加入 polling。

先记录：

```text
shortcutNames
invokeShortcut result
KWin journal
```

再评估：

```text
无物理键但可 invoke 的 action
或者最小 native KWin plugin
```

禁止正式方案使用文件轮询或 100ms DBus 查询。

---

# 37. Bridge 唤醒 KWin

Qt6 Bridge 调：

```text
service:
org.kde.kglobalaccel

path:
/component/kwin

interface:
org.kde.kglobalaccel.Component

method:
invokeShortcut

arg:
CC Scroll Apply Dock Command
```

---

# 38. KWin command callback

```js
function applyPendingDockCommand() {
    callDBus(
      "org.cc.ScrollDockBridge",
      "/ScrollDock",
      "org.cc.ScrollDockBridge1",
      "TakePendingCommand",
      function(json) {
          ...
      }
    );
}
```

没有 command：

```text
return
```

---

# 39. KWin Validation

依次检查：

```text
protocol
sessionId
baseGeneration
type
order length
duplicate UUID
UUID set equality
```

必须：

```text
set(command.order)
==
set(current managed column UUIDs)
```

任何失败：

```text
reject
republish current state
```

---

# 40. Commit Reorder

构建：

```text
uuid → existing Column object
```

然后：

```js
state.columns =
    command.order.map(uuid => columnByUuid[uuid])
```

不能重新创建 Column；保留：

```text
widthMode
window
column metadata
```

然后：

```text
recomputeLogicalLayout()
ensureFocusedVisible()
relayout()
generation++
publishDockState("dock-reorder")
```

---

# 41. Focus 保持

Dock reorder 不应改变 focused window。

例如：

```text
A [B] C D
```

拖 D 最左：

```text
D A [B] C
```

B 仍 focused。

如 B 被重排后超出 viewport：

```text
ensureFocusedVisible()
```

进行 minimal scroll。

---

# 42. Optimistic Dock UI

Dock 可以先显示用户 drop 后的顺序。

如果 KWin接受：

```text
authoritative state 与 UI 一致
```

如果 stale/reject：

```text
Dock 根据 KWin state 回滚
```

无需弹错误窗口。

---

# 43. Feedback Loop 防护

至少三层：

```text
Dock:
applyingRemoteOrder

Bridge:
commandId / pending dedup

KWin:
sessionId + generation + authoritative republish
```

---

# 44. KWin → Dock 完整流程

用户：

```text
Meta+Shift+H
```

KWin：

```text
columns swap
relayout
generation++
PublishState
```

Bridge：

```text
StateChanged
```

Dock：

```text
remote apply TasksModel.move()
```

不得发反向 RequestReorder。

---

# 45. Dock → KWin 完整流程

用户：

```text
Dock drag C before B
```

Dock：

```text
RequestReorder(baseGeneration)
```

Bridge：

```text
queue
invokeShortcut
```

KWin：

```text
TakePendingCommand
validate
columns reorder
relayout
generation++
PublishState
```

Dock：

```text
receive authoritative commit
```

---

# 46. Dock Click 不走 Bridge

点击 task：

```text
继续使用 KDE TaskManager 原生 activate
```

Phase 9 后：

```text
activeWindowChanged
→ scroll to corresponding Column
```

不要重复造 activation IPC。

---

# 47. Bridge Restart

Bridge 重启后 lastState 丢失。

推荐注册另一个 KWin internal action：

```text
CC Scroll Publish Dock State
```

Bridge startup 时通过 KGlobalAccel invoke：

```text
Publish Dock State
```

KWin：

```text
publishDockState("bridge-start")
```

也可以让同一个 command pump 在空队列时顺便 publish，但独立 action 更清晰。

---

# 48. Plasmashell Restart

CC Scroll Tasks 启动：

```text
GetState()
```

立刻恢复 order。

---

# 49. KWin Script Reload

新：

```text
sessionId
generation
```

首次启动：

```text
PublishState("script-start")
```

Bridge：

```text
清空旧 pending
更新 session
emit StateChanged
```

---

# 50. Bridge 安装建议

Binary：

```text
~/.local/libexec/cc-scroll-dock-bridge
```

systemd user unit：

```text
~/.config/systemd/user/cc-scroll-dock-bridge.service
```

Bridge 空闲时只等待 D-Bus。

要求：

```text
0 synchronization timers
0 geometry polling
0 process scanning
```

它是 IPC relay，不是 WM daemon。

---

# 51. Plasmoid ↔ DBus

不要依赖 undocumented private Plasma QML DBus API。

推荐 custom Plasmoid 搭一个很薄的 C++ backend：

```text
DockBridgeClient
```

使用：

```text
Qt6::DBus
```

向 QML 暴露：

```text
connected
stateJson
requestReorder(json)
```

signals：

```text
stateChanged()
connectedChanged()
```

---

# 52. 项目目录建议

```text
/home/cc/Projects/FullScreen/

package/
  ... KWin script

effect/
  ... existing effect

bridge/
  CMakeLists.txt
  src/
    main.cpp
    ScrollDockBridge.h
    ScrollDockBridge.cpp

plasmoid/
  com.cc.scrolltasks/
    metadata.json
    contents/
      ui/
        main.qml
        ...

  plugin/
    CMakeLists.txt
    DockBridgeClient.cpp
    DockBridgeClient.h

test/
  dock-sync/
```

---

# 53. TaskManager POC

正式接 IPC 前：

```text
SortManual
GroupDisabled
```

打开：

```text
A B C D
```

手工：

```text
tasksModel.move(2,1)
```

确认：

```text
A C B D
```

---

# 54. Drag POC

确认原生 drag：

```text
C 拖到 B 前
```

最终 model rows：

```text
A C B D
```

确定在哪个“drop completed”节点读取 UUID order。

---

# 55. 多同应用窗口是强制测试

打开：

```text
Konsole1
VS Code
Konsole2
Konsole3
```

columns：

```text
K1 → VS → K2 → K3
```

Dock：

```text
[K][VS][K][K]
```

拖 K3 到最前：

```text
K3 → K1 → VS → K2
```

必须依靠 UUID 精确完成。

---

# 56. Parking 不影响 Dock Order

例如：

```text
A B C D E F G
```

只有 C/D visible。

Dock 仍：

```text
[A][B][C][D][E][F][G]
```

---

# 57. Scrolling 不改变 Dock Order

`Meta+H/L`：

```text
只改变 focusedColumn / scrollOffset
```

没有 reorder 时：

```text
Dock order 完全不变
```

---

# 58. Meta+R 不改变 Dock Order

只修改：

```text
widthMode
```

顺序不变。

---

# 59. V2 Override 不改变 Dock Order

```text
Pseudo Maximize
Quick Tile
F11
```

都不移动 Dock slot。

---

# 60. 测试：KWin → Dock

### T01

```text
A B [C] D
Meta+Shift+H
```

KWin：

```text
A C B D
```

Dock：

```text
[A][C][B][D]
```

### T02

Meta+Shift+L 同理。

### T03

Phase 8 新窗口插入后 Dock 同步。

### T04

窗口关闭后 Dock 同步且其它 order 不乱。

---

# 61. 测试：Dock → KWin

### T05 Dock Drag

```text
Dock:
A B C D
```

拖 D 到 A/B 之间：

```text
A D B C
```

KWin：

```text
columns = A D B C
```

窗口 Strip 同步重排。

### T06 Focus Preserve

```text
A [B] C D
```

Dock 拖 D 到最左：

```text
D A [B] C
```

B 保持 focus。

### T07 Minimal Scroll

重排后 focused B 若离开 viewport，只做 minimal scroll。

---

# 62. Race 测试

### T08 Stale Generation

Dock gen=20。

拖动过程中 KWin 添加 X：

```text
gen=21
```

Dock 发：

```text
base=20
```

KWin 必须 reject。

### T09 Fast Sequential Drag

快速两次拖动。

Bridge 不 crash，最终 state 必须来自最后一次有效 commit。

---

# 63. Restart Tests

### T10 Bridge Restart

```bash
systemctl --user restart cc-scroll-dock-bridge
```

自动恢复。

### T11 plasmashell Restart

Plasmoid `GetState()` 恢复。

### T12 KWin Script Reload

旧 session command 不得污染新 session。

---

# 64. Phase 8.5 不做

不要 scope creep：

```text
Floating 区最终设计
Secondary 双向 reorder
Dock mini-map
Column width visual bar
缩略图 strip
拖 icon 到副屏
动画重构
session persistence
```

---

# 65. 安全原则

如果 UUID mapping 不完整：

```text
不执行 reorder
```

宁可 resync，也不要猜。

Dock 永远不能直接移动真实 window geometry。

Dock 只发送：

```text
logical reorder request
```

KWin commit 后由现有 layout engine `relayout()`。

---

# 66. Definition of Done

- [ ] KWin `internalId` ↔ TaskManager `WinIdList` UUID POC 通过。
- [ ] Managed tasks `GroupDisabled`。
- [ ] Managed Dock order 严格等于 `columns[]`。
- [ ] Parking 不影响 Dock order。
- [ ] Scroll 不影响 Dock order。
- [ ] Width change 不影响 Dock order。
- [ ] Temporary overrides 不影响 Dock order。
- [ ] Meta+Shift+H/L → Dock 实时同步。
- [ ] Phase 8 add/remove → Dock 实时同步。
- [ ] Dock drag → KWin columns[] 实时同步。
- [ ] 无 feedback loop。
- [ ] sessionId 正常。
- [ ] generation/baseGeneration 正常。
- [ ] stale request 安全 reject。
- [ ] 同 App 多窗口 UUID 精确区分。
- [ ] reorder 保持 focus。
- [ ] 必要时 minimal scroll。
- [ ] Bridge 无 polling。
- [ ] KWin 无 polling。
- [ ] Bridge restart 可恢复。
- [ ] plasmashell restart 可恢复。
- [ ] KWin script reload 不接受旧 command。
- [ ] 副屏没有 regression。
- [ ] V2/V3 layout 没有 regression。
- [ ] journal 无持续错误。

---

# 67. Codex 实现顺序

严格按以下顺序：

```text
1. UUID identity POC

2. TaskManager SortManual + GroupDisabled POC

3. CC Scroll Tasks applet POC

4. Bridge：
   PublishState / GetState / StateChanged

5. KWin → Bridge → Dock 单向同步

6. remote-order feedback guard

7. Dock drag → RequestReorder

8. KGlobalAccel invokeShortcut POC

9. KWin TakePendingCommand

10. session/generation validation

11. KWin commit columns[] + relayout()

12. 双向闭环测试

13. restart / stale / multi-Konsole regression
```

---

# 68. KGlobalAccel POC 失败时

如果无物理按键的：

```text
CC Scroll Apply Dock Command
```

无法通过：

```text
/component/kwin invokeShortcut
```

触发：

**停止正式双向实现，不允许改成 polling。**

汇报：

```text
shortcutNames
action name
invokeShortcut 结果
KWin journal
```

再评估：

```text
其它 event-driven KWin callback
或
最小 native KWin plugin
```

---

# 69. 最终架构

```text
                 ┌──────────────────────────────┐
                 │            KWin              │
                 │ columns[] = canonical truth  │
                 │ A → C → B → D                │
                 └──────────────┬───────────────┘
                                │ PublishState
                                ▼
                 ┌──────────────────────────────┐
                 │   CC Scroll Dock Bridge      │
                 │ Qt6 / DBus / event-driven    │
                 └──────────────┬───────────────┘
                                │ StateChanged
                                ▼
                 ┌──────────────────────────────┐
                 │ CC Scroll Tasks              │
                 │ [A] [C] [B] [D]              │
                 └──────────────┬───────────────┘
                                │ user drag
                                ▼
                 ┌──────────────────────────────┐
                 │ RequestReorder               │
                 │ Bridge pending command       │
                 └──────────────┬───────────────┘
                                │ KGlobalAccel wakeup
                                ▼
                 ┌──────────────────────────────┐
                 │ KWin TakePendingCommand      │
                 │ validate → commit → relayout │
                 └──────────────────────────────┘
```

最终用户感知应是：

> **Dock 就是 Logical Strip 的顺序地图。**
>
> 用 `Meta+Shift+H/L` 移动 Column，Dock 跟着变；
> 直接拖 Dock 图标，真实 Column 顺序也跟着变。
