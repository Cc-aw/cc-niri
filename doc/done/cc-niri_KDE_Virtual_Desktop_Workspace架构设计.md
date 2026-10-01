# cc-niri 基于 KDE Virtual Desktop 的纵向 Workspace 架构设计

> **归档状态（2026-10-01）：** 当前主屏范围 W0–W9 已实现、部署并由用户验收；见 test/WORKSPACE_W9_RESULTS.md。历史双屏要求不作为本轮验收范围。
> 文档状态与阅读顺序见 [文档索引](../README.md)。原设计正文保留作为历史依据。

> 目标：在保留现有横向 Column 架构的前提下，引入类似 niri 的纵向 Workspace。KDE Virtual Desktop 负责 Workspace，cc-niri 只管理当前 Workspace 内部的 Columns。
>
> 当前基线：`main`，已完成 V1 `MotionProfiles`。目标环境：Fedora 44 / Plasma / KWin 6.7.5 / Wayland。
>
> 核心原则：不要把 `mainScreenState` 改造成复杂的多 Workspace 全局状态树；不要自己实现 Workspace compositor；不要叠加自定义 Workspace 动画。

---

## 1. 目标交互

```text
                 Workspace 1
        ← 1 | 2 → 3 → 4 → 5
                H / L

                    ↑ K
                    │
                    ↓ J

                 Workspace 2
        ← A | B → C → D

                    ↑
                    │
                    ↓

                 Workspace 3
        ← X | Y → Z
```

推荐快捷键：

```text
Meta+H / Meta+L  当前 Workspace 内横向 Column
Meta+K           上一个 Workspace
Meta+J           下一个 Workspace
```

第一版不 wrap。

---

## 2. 总体架构

### 不推荐

不要把现有：

```js
mainScreenState = {
    columns: [],
    focusedColumnIndex: -1,
    scrollOffsetX: 0,
    ...
}
```

直接改成：

```js
workspaces[currentWorkspaceId].columns
```

再让 `ColumnStore / ContextualViewport / PresentationController / InvariantChecker / Recovery` 全部理解 Workspace。

这样侵入太大。

### 推荐：Active Workspace + Sleeping Snapshots

保持：

```text
mainScreenState
=
当前正在显示的 Workspace
```

其它 Workspace 只保存轻量 Snapshot：

```text
WorkspaceSnapshotStore
├── workspace-A → snapshot
├── workspace-B → snapshot
└── workspace-C → snapshot
```

切换：

```text
capture current
    ↓
KDE Virtual Desktop switch
    ↓
reconcile target windows
    ↓
hydrate mainScreenState
    ↓
single relayout()
```

现有 Column/Viewport/Presentation 引擎仍只面对一套 active state。

---

## 3. 新增模块

```text
src/kwin/workspace/
├── VirtualDesktopTopology.js
├── WorkspaceMembership.js
├── WorkspaceSnapshotStore.js
├── WorkspaceMountController.js
├── WorkspaceSwitchController.js
└── WorkspaceTransferController.js
```

Effect 侧：

```text
src/effect/
└── WorkspaceEffectGuard.js
```

建议测试：

```text
test/
├── virtual-desktop-topology.test.js
├── workspace-membership.test.js
├── workspace-snapshot-store.test.js
├── workspace-mount-controller.test.js
├── workspace-switch-controller.test.js
├── workspace-transfer-controller.test.js
├── workspace-invariants.test.js
└── workspace-startup-restore.test.js
```

---

## 4. VirtualDesktopTopology

职责：

- 读取 KDE Virtual Desktop；
- 获取当前 desktop；
- 获取前后 desktop；
- 用稳定 ID 做 Workspace 主键；
- 过滤只针对 `targetOutput` 的 desktop change。

建议 API：

```js
class VirtualDesktopTopology {
    ordered()
    current(output)
    id(desktop)
    indexOf(desktop)
    previous(desktop)
    next(desktop)
    byId(id)
}
```

Workspace 主键使用：

```text
VirtualDesktop.id
```

不要把数组 index 或 X11 desktop number 当持久主键。

---

## 5. Global State 与 Workspace State

当前 `mainScreenState` 中：

### 全局保留

```text
targetOutput
safeRect
innerGap
enabled
nextColumnId
```

其中 `nextColumnId` 建议整个 session 单调递增，不要每个 Workspace 重置。

### Workspace Snapshot 保存

```text
columns
focusedUuid
viewportAnchor
viewport
presentation
persistentWide
widthMode
```

---

## 6. WorkspaceSnapshot 数据结构

建议：

```js
{
    workspaceId: "desktop-id",

    columns: [
        {
            uuid: "window-uuid-a",
            widthMode: "half",
            persistentWide: false
        },
        {
            uuid: "window-uuid-b",
            widthMode: "half",
            persistentWide: true
        }
    ],

    focusedUuid: "window-uuid-b",

    viewportAnchor: {
        uuid: "window-uuid-a",
        delta: 12
    },

    viewport: {
        mode: "pair",
        wideUuid: null
    },

    presentation: {
        mode: "normal",
        windowUuid: null
    }
}
```

不要保存 live Column object。

不要保存 `focusedColumnIndex`，保存 `focusedUuid`。

不要只保存 raw `scrollOffsetX`，继续使用当前 StartupLayout 已经验证过的 `anchor UUID + delta` 方案。

Wide 不保存 `wideColumnId`，保存 `wideUuid`，mount 后重新解析为新的 Column ID。

---

## 7. WindowState 必须区分 Owned 与 Mounted

当前：

```text
managedByScrollLayout
columnId
```

在单 Workspace 下基本等价于“这个窗口当前属于 cc-niri”。

多 Workspace 后不够。

新增：

```js
workspaceOwnerId: null
```

重新定义：

```text
workspaceOwnerId
= 这个窗口属于哪个 cc-niri Workspace

managedByScrollLayout
= 当前是否 mount 到 active mainScreenState

columnId
= 当前 mount 时临时 Column ID
```

例：

```text
Workspace 1 active：

Firefox:
workspaceOwnerId = WS1
managedByScrollLayout = true
columnId = 31
```

切 Workspace 2：

```text
Firefox:
workspaceOwnerId = WS1
managedByScrollLayout = false
columnId = null
```

它仍属于 cc-niri，只是当前未 mount。

---

## 8. Adoption 新 Phase

增加：

```text
ADOPTION_WAITING_WORKSPACE
```

`AdoptionController.waitPhase()` 的判断顺序建议：

```text
WindowPolicy
↓
Floating
↓
Workspace Membership
↓
Output
↓
Fullscreen / Tile / Maximize
↓
Activation
```

如果窗口不属于当前 Workspace：

```text
return ADOPTION_WAITING_WORKSPACE
```

避免 inactive Workspace 的窗口因为 `activeChanged / readyForPaintingChanged / geometryChanged` 被错误加入当前 Columns。

---

## 9. WorkspaceMembership

新增：

```text
WorkspaceMembership.js
```

职责：

```js
desktopIds(window)
belongsTo(window, workspaceId)
isSingleDesktop(window)
isSticky(window)
```

第一版规则：

```text
On All Desktops
或
desktops.length != 1
→ 不进入 Column
```

Sticky / multi-desktop window 保持 KDE Native。

原因：同一个窗口只有一份 geometry，不可能同时满足两个 Workspace 的不同 Column 位置。

新增 invariant：

```text
Managed Column Window
必须只属于一个 Virtual Desktop
```

---

## 10. WorkspaceSnapshotStore

纯 JS 数据模块：

```js
class WorkspaceSnapshotStore {
    get(id)
    set(id, snapshot)
    has(id)
    remove(id)
    removeWindow(uuid)
    workspaceForWindow(uuid)
    all()
    clear()
}
```

内部建议维护：

```text
uuidOwner: Map<windowUuid, workspaceId>
```

确保同一个 UUID 只能属于一个 Workspace Snapshot。

---

## 11. WorkspaceMountController

职责：

> 将目标 Workspace 的真实窗口 + snapshot 恢复为当前 active `mainScreenState`。

Mount 必须是 batch。

禁止：

```text
A adopt → relayout
B adopt → relayout
C adopt → relayout
```

正确流程：

```text
enumerate workspace windows
↓
filter policy/output/membership
↓
reconcile snapshot
↓
build all columns
↓
recompute logical layout
↓
restore focus
↓
restore scroll
↓
restore viewport
↓
restore presentation
↓
single relayout
```

---

## 12. Reconcile 算法

Snapshot：

```text
A B C D
```

真实窗口：

```text
A B D E
```

恢复：

```text
A B D E
```

规则：

1. Snapshot 中仍存在的 UUID 按旧顺序；
2. 已关闭 UUID 丢弃；
3. 新 eligible window append；
4. sticky/multi-desktop 不加入；
5. policy-floating 不加入；
6. output 不匹配不加入。

---

## 13. Focus 恢复优先级

建议：

```text
1. KDE 当前 activeWindow
   且属于目标 Workspace 且在 columns

2. snapshot.focusedUuid

3. 第一列

4. 无窗口 → -1
```

避免和 KDE desktop switch 自己的 focus policy 打架。

---

## 14. Viewport 恢复顺序

必须：

```text
Columns
↓
logicalX
↓
scrollOffset
↓
viewport
↓
presentation
↓
relayout
```

不要先恢复 Wide 再 recompute。

第一版建议更保守：

```text
保存 persistentWide
但 Workspace mount 后统一恢复 Pair + normal presentation
```

等基本功能稳定后，再恢复 Wide active viewport。

---

## 15. WorkspaceSwitchController

状态机：

```text
IDLE
 ↓
PREPARING
 ↓
AWAITING_KWIN
 ↓
MOUNTING
 ↓
IDLE
```

不要简单：

```text
Meta+J
→ setCurrentDesktop
→ 靠各个 signal 自己处理
```

Workspace 切换必须事务化。

---

## 16. 完整切换流程

```text
Meta+J
 │
 ▼
resolve target desktop
 │
 ▼
PREPARING
 │
 ├─ mark workspaceSwitching
 ├─ cancel Dock scroll
 ├─ cancel contextual reveal
 ├─ cancel ContextualWideCoordinator
 ├─ capture current snapshot
 └─ block new active adoption
 │
 ▼
request KDE desktop switch
 │
 ▼
AWAITING_KWIN
 │
 ▼
currentDesktopChanged(old,new,targetOutput)
 │
 ▼
unmount old
 │
 ▼
MOUNTING
 │
 ▼
mount target workspace
 │
 ▼
single relayout
 │
 ▼
Dock commit
 │
 ▼
IDLE
```

---

## 17. Workspace Switch 是 Transaction Barrier

这是整个功能最重要的稳定性原则。

切换前必须结束/取消：

```text
pending Dock scroll
ContextualViewport pending reveal
ContextualWideCoordinator pendingPark
ContextualWideCoordinator pendingExit
Presentation transient
active Window Motion
```

否则旧 Workspace 的延迟 callback 可能在新 Workspace 已经 mount 后继续 park 或提交 geometry。

---

## 18. Wide 是最高风险之一

当前 `ContextualWideCoordinator` 有：

```text
pendingPark
pendingExit
timer
deferred Bridge callback
```

所以 Workspace 切换前：

```text
contextualWideCoordinator.cancel()
```

必须是硬要求。

旧 Wide pending state 永远不能 snapshot，也不能跨 Workspace 恢复。

禁止保存：

```text
pendingReveal
pendingFocusedWide
pendingPark
pendingExit
Dock pending plan
motion epoch
```

Snapshot 只保存稳态。

---

## 19. Dock Scroll 也必须 cancel

当前 hidden Dock task 会：

```text
1|2 → 2|3 → 3|4 → 4|5
```

这是 deferred transaction chain。

Workspace 切换前必须：

```text
cancelPendingDockScroll("workspace-switch")
```

---

## 20. Effect Workspace Barrier

新增：

```text
WorkspaceEffectGuard.js
```

职责只做：

```text
desktop change
→ motion.cancelAll()
→ clear viewport clip
→ clear temporary visual state
```

不要自己实现纵向 Workspace 动画。

横向：

```text
cc-niri Motion
```

纵向：

```text
KDE/KWin 原生 Virtual Desktop effect
```

---

## 21. Unmount 不能复用 removeColumn()

这是非常重要的实现边界。

不要：

```text
切 Workspace
→ 对每个窗口 removeColumn()
```

因为 `removeColumn()` 会：

- release parking；
- 改 Adoption；
- commit Dock；
- 处理 successor focus；
- 触发普通窗口离开 Column 的业务逻辑。

Workspace Unmount 是“休眠”，不是“退出 cc-niri”。

必须实现：

```text
WorkspaceMountController.unmount()
```

---

## 22. Unmount 语义

对当前 active columns：

```text
capture snapshot
```

然后每个窗口：

```text
managedByScrollLayout = false
columnId = null
adoptionPhase = WAITING_WORKSPACE
```

但：

```text
workspaceOwnerId
```

保留。

然后 active state 清空：

```text
columns = []
focusedColumnIndex = -1
scrollOffsetX = 0
viewport = pair
presentation = normal
```

---

## 23. Inactive Workspace 的 Parking

建议保持 script-owned parking。

例如 Workspace A：

```text
1 | 2
3 4 5 parked
```

切到 B 后，A 的 parked window 可以继续保持 parked。

因为 KDE 本来就不会显示 A。

这样避免每次切换都：

```text
release geometry
→ 再次 parking
```

减少 geometry signal 和闪动。

---

## 24. WorkspaceTransferController

监听：

```text
window.desktopsChanged
```

处理窗口跨 KDE Desktop。

第一版只支持：

```text
single-desktop A
→
single-desktop B
```

---

## 25. Active → Inactive Transfer

窗口当前属于 A 且在 active Column。

用户执行 KDE：

```text
Move to Desktop B
```

流程：

```text
cancel window related Wide state
↓
release parking ownership
↓
remove from active Column
↓
remove from snapshot A
↓
workspaceOwnerId = B
↓
append snapshot B
↓
managedByScrollLayout = false
columnId = null
↓
WAITING_WORKSPACE
```

---

## 26. Parked Window Transfer

如果被转移窗口当前：

```text
x < virtualScreenLeft
opacity = 0
minimized = true
```

移动到 B 前必须：

```text
releaseParkingOwnership()
```

否则到了 B 后仍然不可见。

这是必须测试的场景。

---

## 27. Inactive → Active Transfer

如果窗口从 B 移到当前 A：

```text
eligible
single desktop
target output
```

可以进入现有 Adoption。

第一版建议：

```text
active
→ adopt

inactive
→ waitingActivation
```

不要自动抢 focus。

---

## 28. Sticky 转换

如果一个 managed window 变成：

```text
On All Desktops
```

必须：

```text
release parking
detach from active Column/snapshot
workspaceOwnerId = null
managedByScrollLayout = false
KDE native
```

---

## 29. Inactive Workspace Window Close

`window.closed` 不能只调用 active `removeColumn()`。

还必须：

```text
WorkspaceSnapshotStore.removeWindow(uuid)
```

否则切回 Workspace 后会出现 ghost UUID。

---

## 30. Inactive Workspace New Window

如果当前在 A，但应用在 B 打开新窗口：

```text
resolve owner = B
↓
WAITING_WORKSPACE
↓
append B snapshot
```

不能加入 A。

---

## 31. Dock 策略

第一版 Dock 继续只表示：

> 当前 active Workspace 的 Columns。

不要让 Dock 同时理解所有 Workspace。

Dock snapshot 新增：

```text
workspaceId
workspaceIndex
```

例如：

```json
{
  "workspaceId": "workspace-b",
  "workspaceIndex": 1,
  "columns": [...]
}
```

Workspace mount 完成后：

```text
DockGateway.commit("workspace-switch")
```

让 generation++。

旧 Workspace 的 Dock command 自动 stale。

---

## 32. Bridge Persistence

为了 Script Reload 后恢复所有 Workspace，建议 snapshot protocol 升级。

例如：

```json
{
  "protocol": 2,
  "sessionId": "...",
  "generation": 84,

  "targetOutput": "DP-1",
  "workspaceId": "B",

  "columns": [...],

  "workspaces": [
    {
      "id": "A",
      "columns": [...],
      "focusedUuid": "...",
      "viewportAnchor": {...}
    },
    {
      "id": "B",
      "columns": [...]
    }
  ]
}
```

Dock 仍只消费 active `columns`。

KWin reload recovery 消费 `workspaces[]`。

---

## 33. Protocol 迁移

建议：

```text
protocol 1
= 旧单 Workspace

protocol 2
= Multi Workspace
```

如果读取到 protocol 1：

```text
旧 snapshot
→ 映射到当前 KDE Virtual Desktop ID
→ 生成一个 WorkspaceSnapshot
```

这样兼容当前 main。

---

## 34. StartupLayout 定位

不要删除现有 `StartupLayout.js`。

它的：

```text
saved order
viewport anchor
```

逻辑仍然有价值。

Workspace 功能可以：

```text
复用其排序/anchor 思想
```

并增加 protocol 1 migration。

---

## 35. RuntimeLifecycle 新增信号

需要接：

```text
workspace.currentDesktopChanged
workspace.desktopsChanged
```

以及每个 window：

```text
window.desktopsChanged
```

所有 signal wiring 仍通过 `RuntimeLifecycle` / `setupWindow` 的薄层完成。

复杂业务进入 Workspace modules。

---

## 36. ShortcutCatalog

新增：

```text
CCScrollWorkspacePrevious
CC Scroll: Previous Workspace
Meta+K

CCScrollWorkspaceNext
CC Scroll: Next Workspace
Meta+J
```

第一版不做：

```text
Meta+Shift+J/K
```

移动窗口。

先用 KDE 原生 Move to Desktop 验证 TransferController。

---

## 37. 第一版只支持固定 KDE Virtual Desktop

建议先在 KDE Settings 中建立：

```text
3~4 个 Virtual Desktop
```

cc-niri 只做：

```text
J/K
per-workspace Columns
snapshot restore
```

不要第一版就动态 create/remove。

---

## 38. Dynamic Workspace 后续再做

未来可新增：

```text
DynamicWorkspaceController.js
```

第一版 dynamic 只做：

```text
最后始终保留一个空 Workspace
```

例如：

```text
1 occupied
2 occupied
3 empty
```

在 3 打开窗口：

```text
1 occupied
2 occupied
3 occupied
4 empty
```

第一版：

```text
Auto Create ✅
Auto Delete ❌
```

不要自动删除 KDE Virtual Desktop。

---

## 39. 多屏策略

当前 cc-niri 仍只管理：

```text
targetOutput
```

所以 Workspace V1 也只管理主屏。

如果 `currentDesktopChanged` 发生在 secondary output：

```text
ignore
```

副屏继续 KDE Native。

不要第一版实现每个 output 独立 cc-niri workspace stack。

---

## 40. Workspace Invariants

必须新增：

### Active Column Membership

```text
active column.window
必须属于 activeWorkspaceId
```

错误：

```text
wrong-workspace:<uuid>
```

Critical。

### UUID Ownership

```text
一个 UUID
不能出现在两个 WorkspaceSnapshot
```

错误：

```text
duplicate-workspace-owner:<uuid>
```

Critical。

### Sticky Managed

```text
sticky/multi-desktop window
不能 managedByScrollLayout
```

错误：

```text
sticky-managed:<uuid>
```

Critical。

### Mounted Ownership

```text
managedByScrollLayout == true
→ workspaceOwnerId == activeWorkspaceId
```

### Inactive Workspace

```text
workspaceOwnerId != activeWorkspaceId
→ managedByScrollLayout == false
→ columnId == null
```

---

## 41. StabilitySupervisor

Workspace switch 在：

```text
PREPARING
MOUNTING
```

期间可能短暂出现：

```text
snapshot 与 active columns 不一致
```

所以 Workspace-specific parity invariant 可以在 transaction 内 temporarily suppress。

但以下仍要检查：

```text
wrong-output
parking ownership
duplicate UUID
critical state ownership
```

---

## 42. Emergency Restore

顺序建议：

```text
WorkspaceSwitchController.stop()
↓
invalidate pending switch epoch
↓
cancel Dock scroll
↓
ContextualWideCoordinator.cancel()
↓
cancel Window Motion
↓
Recovery.restoreAll()
```

现有 Recovery 会遍历整个 `WindowStateStore`，所以 inactive Workspace 的 script-owned parked window 也应该被恢复。

必须新增 regression 验证。

---

## 43. Switch Epoch

`WorkspaceSwitchController` 自己维护：

```text
switchEpoch
```

每次新 switch：

```text
switchEpoch++
```

所有 async callback：

```text
if callbackEpoch != currentEpoch
→ ignore
```

避免 stale desktop callback。

不要把它和 Dock generation 混用。

---

## 44. Switch Timeout

如果请求：

```text
switch to B
```

但一定时间未收到目标 `currentDesktopChanged`：

```text
abort
```

然后：

```text
读取 KDE 实际 current desktop
↓
重新 mount(actual)
↓
return IDLE
```

绝不能停在空 `mainScreenState`。

建议初始 timeout：

```text
300~500 ms
```

最终以 W0 实测为准。

---

## 45. Workspace 切换期间新窗口

如果处于：

```text
PREPARING / AWAITING_KWIN / MOUNTING
```

期间收到 `windowAdded`：

第一版：

```text
setup state
resolve actual desktop
assign owner
WAITING_WORKSPACE
```

不立即加入 active Column。

Mount reconcile 会统一处理。

---

## 46. Floating

Floating window 仍然属于某一个 KDE Virtual Desktop。

但：

```text
不进入 columns snapshot
```

可记录：

```text
workspaceOwnerId
```

如果 KDE 将 floating window 移到其它 desktop：

```text
只更新 owner
```

不要进入 Column。

---

## 47. Dialog / Popup

Dialog、modal、utility、popup 等继续按 `WindowPolicy`：

```text
policy-floating / native-only
```

不进入 WorkspaceSnapshot.columns。

WorkspaceMembership 不得绕过 WindowPolicy。

---

## 48. Fullscreen

Fullscreen 的 `workspaceOwnerId` 保持不变。

切 Workspace 时由 KDE 隐藏。

第一版不要为了切 Workspace 强制退出 Fullscreen。

---

## 49. Maximize / Tile

继续由：

```text
layoutMode
AdoptionController
OutputController
```

处理。

WorkspaceSnapshot 第一版只描述 Columns。

---

## 50. Dock 与其它 Desktop

建议 KDE TaskManager 配置为：

```text
只显示当前 Desktop
```

否则 Dock 会显示其它 Workspace 的窗口，而 cc-niri 的 Column order 只对应当前 Workspace。

Dock reorder 也只影响 active Workspace。

---

# 分阶段实现

## W0 — Virtual Desktop API POC

**只验证 KWin 6.7.5 实际行为，不改 geometry。**

新增：

```text
poc/kwin-workspace-api-probe.js
```

打印：

```text
workspace.desktops
desktop.id/name/order
current desktop for targetOutput
currentDesktopChanged old/new/output

window:
caption
desktops[]
onAllDesktops
desktopsChanged
```

人工测试：

```text
KDE Pager 切 desktop
快捷键切 desktop
Move Window to Desktop
On All Desktops
双屏分别切换
```

只有确认信号可靠后进入 W1。

---

## W1 — WorkspaceSnapshotStore

新增：

```text
src/kwin/workspace/WorkspaceSnapshotStore.js
test/workspace-snapshot-store.test.js
```

要求：

```text
纯 JS
Map<workspaceId,snapshot>
normalize
UUID uniqueness
removeWindow
legacy migration
```

不接 KWin。

---

## W2 — WorkspaceMembership + WAITING_WORKSPACE

新增：

```text
WorkspaceMembership.js
```

修改：

```text
WindowState.workspaceOwnerId
ADOPTION_WAITING_WORKSPACE
AdoptionController.waitPhase()
```

此阶段不做 J/K。

验收：

```text
当前 desktop 外窗口不进入 Column
当前 desktop 内保持原行为
sticky 保持 native
```

---

## W3 — WorkspaceMountController

先不用 cc-niri 自己切 desktop。

用户用 KDE 原生方式切换。

收到 `currentDesktopChanged` 后：

```text
mount target Workspace
```

恢复：

```text
Column order
focus
scroll anchor
persistentWide preference
```

第一版：

```text
强制 Pair + normal presentation
```

先验证基础结构稳定。

---

## W3.1 — Wide Restore

W3 稳定后再允许：

```text
snapshot.viewport.mode == wide
→ restore wide
```

只恢复稳态。

绝不恢复 pending Wide transition。

---

## W4 — WorkspaceSwitchController + Meta+J/K

增加：

```text
IDLE
PREPARING
AWAITING_KWIN
MOUNTING
```

事务。

切换前：

```text
cancel Dock scroll
cancel ContextualViewport reveal
cancel ContextualWideCoordinator
capture snapshot
mark switching
```

切换后：

```text
mount target
commit Dock
IDLE
```

第一版 switching 中再次 J/K：

```text
ignore
```

不要 queue。

---

## W5 — Bridge Multi-Workspace Persistence

升级 snapshot schema。

支持：

```text
workspaceId
workspaces[]
protocol 1 migration
protocol 2 publish/read
```

Dock 仍只读 active columns。

---

## W6 — WorkspaceTransferController

监听：

```text
window.desktopsChanged
```

支持：

```text
single desktop A → single desktop B
```

必须覆盖：

```text
visible managed
parked managed
inactive window
floating
Wide target
sticky transition
```

---

## W7 — WorkspaceEffectGuard

只做：

```text
desktop change
→ cancel MotionController
→ clear viewport clip
→ clear transient effect state
```

不增加自定义 Workspace animation。

---

## W8 — Dynamic Trailing Empty Workspace（可选）

确保末尾有一个空 desktop。

```text
create ✅
auto delete ❌
```

只有 W0~W7 日用稳定后再做。

---

## W9 — Auto Recycle Empty Workspace（后续扩展）

2026-10-01 用户在 W8 部署验收后明确要求增加自动回收，并保持模块化。
本节扩展 W8 的 create-only 范围；前文禁止 auto-delete 的要求仍适用于最初 MVP/W8。

新增独立模块：

```text
WorkspaceOccupancy.js
WorkspaceRecycleController.js
```

- AutoRecycleWorkspaces 默认 false，依赖 DynamicTrailingWorkspace=true。
- 回收空的非当前 desktop；末尾 desktop 永远保留。当前空 desktop 离开后再回收，
  不因关闭最后窗口强制切换当前桌面。
- 回收的空判定使用所有输出、所有活动的实际存活窗口，而不是 active Columns 或缓存。
  Floating / Fullscreen / minimized / Dialog / multi-desktop / native-only 都保护其归属桌面。
  Sticky 与 Plasma/Dock/Desktop 不算单桌面占用；无法确认归属时不删除。
- 每次只处理一个 UUID，延迟检查合并事件；启动、switch、transfer 和 W8 创建屏障期间不回收。
  删除前解析当前原生 Desktop，删除后根据实际 topology 确认，再清理 snapshot 并发布 Bridge。
- 原生失败或 no-op 按 topology 限制重试；Recovery / unload 取消任务。延迟任务仅保留 UUID，
  不缓存已销毁的 Window 或 Desktop QObject。
- W8 负责创建，W9 负责回收，共享占用判断并通过完成事件协调，避免创建/删除振荡。
  main.js 仅组合依赖和连接信号，纵向 rows=count 继续生效。
- 显式启用后，之前已有的空非当前桌面也可回收；不只限于 W9 本轮创建的桌面。

---

# 推荐 Git 分支

必须单独开发：

```bash
git switch main
git pull
git switch -c feature/workspace-stack
```

不要直接在日用 main 上做。

推荐 commit：

```text
poc: probe KWin virtual desktop runtime

feat: add workspace snapshot store

feat: add workspace membership policy

feat: mount per-desktop column sessions

feat: add workspace switch transaction

feat: persist workspace snapshots through bridge

feat: handle window desktop transfers

feat: cancel visual motion across workspace switches

feat: add optional trailing empty workspace
```

每个 commit 必须可单独回退。

---

# Codex 实现要求

每个 Phase：

1. 先读当前相关模块；
2. 新建独立 module；
3. 先写 test；
4. 再做最薄 wiring；
5. 更新 `tools/build.js`；
6. `node tools/build.js`；
7. `node tools/check.js`；
8. native CI；
9. 不顺手重构无关模块；
10. 一个 Phase 一个 commit。

`main.js` 只允许：

```text
实例化 Workspace controller
连接 signal
注入依赖
```

禁止重新堆大型 Workspace 算法。

---

# Codex Prompt：W0

```text
只实现 Virtual Desktop API POC，不修改 cc-niri 现有窗口管理。

新增：
poc/kwin-workspace-api-probe.js

打印：
- workspace.desktops
- desktop.id/name/order
- current desktop for target output
- currentDesktopChanged previous/current/output
- window.desktops
- window.onAllDesktops
- window.desktopsChanged

禁止：
- 写 frameGeometry
- 改 Column
- 改 Adoption
- 改 Dock
```

---

# Codex Prompt：W1

```text
只实现 WorkspaceSnapshotStore。

新增：
src/kwin/workspace/WorkspaceSnapshotStore.js
test/workspace-snapshot-store.test.js

要求：
- snapshot normalize
- Map<workspaceId,snapshot>
- UUID ownership uniqueness
- removeWindow(uuid)
- legacy single-workspace snapshot migration helper
- 纯 JS
- 不访问 workspace/window/DBus
```

---

# Codex Prompt：W2

```text
只实现 WorkspaceMembership 和 ADOPTION_WAITING_WORKSPACE。

新增：
src/kwin/workspace/WorkspaceMembership.js

修改：
WindowState 增加 workspaceOwnerId
Adoption phase 增加 ADOPTION_WAITING_WORKSPACE

规则：
- managed Column window 必须只属于一个 Virtual Desktop
- sticky/multi-desktop window 不进入 Column
- 非 active workspace window 返回 WAITING_WORKSPACE

不要实现 J/K。
```

---

# Codex Prompt：W3

```text
只实现 WorkspaceMountController。

目标：
用户通过 KDE 原生方式切换 Virtual Desktop 后，
cc-niri 为目标 Desktop 恢复独立 Column 集。

第一版恢复：
- Column order
- focus
- scroll anchor
- persistentWide preference

第一版 mount 后强制 Pair + normal presentation。

必须：
- batch mount
- single relayout
- 不逐窗口 relayout
```

---

# Codex Prompt：W4

```text
只实现 WorkspaceSwitchController + Meta+J/K。

状态机：
IDLE
PREPARING
AWAITING_KWIN
MOUNTING
IDLE

切换前：
- cancel Dock scroll
- cancel contextual reveal
- cancel ContextualWideCoordinator
- mark switching
- capture snapshot

切换后：
- mount target
- commit Dock
- return IDLE

第一版 switching 中忽略新的 J/K。
```

---

# Codex Prompt：W5

```text
只实现 Bridge multi-workspace persistence。

升级 snapshot schema。
支持：
- active workspaceId
- workspaces[]
- protocol 1 migration
- protocol 2 publish/read

Dock 仍只消费 active columns。
```

---

# Codex Prompt：W6

```text
只实现 WorkspaceTransferController。

监听：
window.desktopsChanged

支持：
single-desktop A -> single-desktop B

必须：
- parked window transfer 前 release parking
- active workspace remove
- inactive snapshot update
- sticky 转换后 detach 为 native
- 不破坏 Floating/Dialog
```

---

# Codex Prompt：W7

```text
只实现 WorkspaceEffectGuard。

desktop switch 时：
- cancel MotionController
- clear viewport clip
- clear transient visual state

不要实现自定义 vertical animation。
```

---

# Manual Acceptance

至少准备：

```text
Workspace 1:
5 columns

Workspace 2:
2 columns

Workspace 3:
empty
```

测试：

```text
1 → 2 → 1
2 → 3 → 2
```

检查：

```text
order
focus
scroll
Dock
```

组合测试：

```text
Workspace 1:
L L

J

Workspace 2:
L

K

Workspace 1:
H
```

要求两个 Workspace 的 scroll state 独立。

---

## Wide + Switch

```text
Pair → Wide
动画未结束
J
```

必须：

```text
无 ghost
无旧 timer
无错误 parking
```

---

## Dock Scroll + Switch

```text
点击远距离 Dock task
正在连续 scroll
J
```

必须：

```text
旧 Dock plan cancel
```

---

## Inactive Window Close

Workspace 1：

```text
A B C
```

切 Workspace 2 后关闭 A。

回 Workspace 1：

```text
Snapshot 不得包含 A
```

---

## Script Reload

至少三个 Workspace。

reload 后逐个切换验证：

```text
order
focus
scroll anchor
```

---

## Emergency Restore

多个 Workspace 都存在 parked window 时触发：

```text
Meta+Ctrl+Alt+Shift+F12
```

必须全部恢复可访问。

---

# 推荐 MVP

最稳的第一版：

```text
固定 3~4 个 KDE Virtual Desktop

Meta+J/K
→ 切换

每个 Desktop：
→ 独立 Column order
→ 独立 focus
→ 独立 scroll
→ persistentWide preference

切换回来：
→ Pair
```

先不要做：

```text
Wide active restore
Window transfer 快捷键
Dynamic auto-delete
Overview
Workspace 自定义动画
```

---

# 最终架构图

```text
                    KDE / KWin
                        │
                Virtual Desktops
                        │
             currentDesktopChanged
                        │
                        ▼
             VirtualDesktopTopology
                        │
                        ▼
             WorkspaceSwitchController
               │                  │
          capture old          mount new
               │                  │
               ▼                  ▼
       WorkspaceSnapshotStore ──────────────┐
                                            │
                                            ▼
                                    mainScreenState
                                            │
            ┌───────────────────────────────┼───────────────────────────┐
            │                               │                           │
            ▼                               ▼                           ▼
       ColumnStore                 ContextualViewport             Presentation
            │                               │                           │
            └───────────────────────────────┼───────────────────────────┘
                                            │
                                            ▼
                                        relayout()
                                            │
                                            ▼
                                     existing Motion
```

---

# 最重要的五条原则

1. **KDE Virtual Desktop 是 Workspace authority。**
2. **`mainScreenState` 永远只代表当前 active Workspace。**
3. **其它 Workspace 只保存 Snapshot，不保留 live Column graph。**
4. **Workspace Switch 必须是 Transaction Barrier。**
5. **纵向动画交给 KDE，cc-niri 不叠第二套 Workspace Effect。**

完成后，cc-niri 的模型就是：

```text
Horizontal Layer
────────────────
Column / Pair / Wide / Floating / H-L

Vertical Layer
────────────────
KDE Virtual Desktop
per-workspace Column Session
J-K
```

这能得到接近 niri 的二维工作流，同时最大限度保留 KDE/KWin 的原生稳定性。
