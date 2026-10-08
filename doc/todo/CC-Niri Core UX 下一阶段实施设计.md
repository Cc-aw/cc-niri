# CC-Niri Core UX 下一阶段实施设计

实施状态（2026-10-08，按用户最新要求收缩范围）：P1 Compact Safe Area、P2 Persistent Full Column 保留；P3 当前只提供 **half ↔ full（50% ↔ 100%）**，Meta+R / Meta+F 均切换这两档，并复用既有 Pair/Wide 动画事务、Scale / Translation、Native 裁剪与邻窗停放；Full 仍是持久列宽，逻辑 viewport 保持 pair，不新增时钟；用户已确认本次 half / Full 动画实机验收通过。**third / twoThirds 与 niri resize 协调开发暂缓**，对应实验实现已撤下，旧快照中的 third / twoThirds 与恢复记忆迁移为 half，并清除迁移工作区的分数视口偏移。下文四档宽度与动画设计属于延期目标，不代表当前生产行为。原因：用户实机报告在 Zed 输入与 J 切换时左侧部分窗口消失。详见 [P1](../../test/CORE_UX_P1_RESULTS.md)、[P2](../../test/CORE_UX_P2_RESULTS.md)、[P3](../../test/CORE_UX_P3_RESULTS.md) 记录。P4 已通过用户实机验收，P5–P7 已实现并部署，P8 尚未实施；本文继续保留在 `todo/`，下文“当前基线”记录设计编写时的 70px 默认值。

P4（2026-10-07）：新增正式 `WorkspaceMoveController`，Meta+Shift+J/K 移动主屏实际活动的受管列并跟随，复用 WorkspaceSwitch / Transfer / Mount；保留列宽、恢复记忆与 Wide 偏好，等待旧 Native Scroll disarm ACK 后才修改 KDE membership，挂载目标并提交几何后聚焦移动的列。源工作区快照优先右邻、否则左邻；沿用 W8/W9 的原生 ID 与回收保护。完整门禁通过：94 JS、30 Rust、Bridge 16 / Clip 15 / Ring 22 CTest、3 隔离 D-Bus、Plasmoid 与生产边界。已按 save-state / stop / upgrade / start 部署布局包，Native 产物与原设置保持。首次部署时会话锁屏；用户随后反馈“实机验收通过 进入下一阶段”，P4 用户实机验收通过。该反馈不代表 FPS / GPU 或长期压力测量。详见 [P4 记录](../../test/CORE_UX_P4_RESULTS.md)。

P5（2026-10-07）：Meta+1…9 按当前 KDE 顺序直达已存在工作区，复用 WorkspaceSwitchController 的 requestTo / barrier / 超时 / mount；当前或缺失目标 no-op，不创建工作区、不移动窗口。完整门禁通过：95 JS、30 Rust、Bridge 16 / Clip 15 / Ring 22 CTest、3 隔离 D-Bus、Plasmoid 与生产边界。布局包已部署，本机已备份并释放 Plasma 九个数字默认绑定，真实键 owner 归属 CC-Niri。UTC 11:52:06–11:52:27 自动实机核验通过非相邻直达、空目标、Full / Wide、Ring、滚动中断与重启；原工作区 / 焦点 / 偏好、主副屏、KWin PID 与 Native 安装字节保持。用户视觉验收待反馈，未测 FPS；详见 [P5 记录](../../test/CORE_UX_P5_RESULTS.md)。

Full / half 可见性修复（2026-10-07）：聚焦相邻 half 时，Full 窗口仍保持 100% 宽度，以正面积交集决定是否进入视口；仅完全离开视口的窗口停放。Rust Scroll v2 可选 `clipPartial` 校验与静态 owner 负责裁剪和输入边界；沿用原 Spring 与 half / Full 动画，不恢复分数宽度或 resize graph。阶段验证与实机状态见 [P3 最新记录](../../test/CORE_UX_P3_RESULTS.md)。

P6（2026-10-08）：Meta+Ctrl+1…9 将主屏实际活动的受管列移到当前 KDE 顺序中的已存在目标并跟随、聚焦；复用 P5 编号查询与 P4 的完整 moveTo 事务，保留 half / Full、恢复宽度及 Wide 偏好。在途目标固定 ID，当前 / 缺失目标 no-op，不由快捷键创建桌面。完整门禁通过：97 JS、31 Rust、fmt / locked clippy、Bridge 16 / Clip 15 / Ring 22 CTest、3 隔离 D-Bus、Plasmoid 与生产边界。布局包已部署，九键均无冲突且 owner 已核对；自动实机通过移动 / 返回、Full / Wide、滚动中断、Ring、重启与原状态恢复。主副屏、Native 安装字节、KWin PID 与设置保持。用户视觉验收待反馈，未测 FPS；详见 [P6 记录](../../test/CORE_UX_P6_RESULTS.md)。

P7（2026-10-08）：`EnableDockIntegration` 默认关闭，Dock UI 命令与 planner 为可选；通用 Bridge 的状态 / 动画 / Wide 完成 / 恢复入口继续保留。默认安装不构建或安装 Plasmoid、不重启 Plasma Shell；`--with-dock` 显式启用，已有包、配置和面板保持。99 JS、31 Rust、fmt / locked clippy、Bridge 16 / Clip 15 / Ring 22 CTest、3 隔离 D-Bus、Plasmoid 与生产边界通过，布局包与配置 UI 已部署。无 Plasma / Dock 的受控实机矩阵与原状态恢复核验通过，用户动画观感与日常 smoke 待反馈，详见 [P7 记录](../../test/CORE_UX_P7_RESULTS.md)。P8 保留 Bridge 命名 / 清理范围。

## 1. 文档目的

在 Rust Native Core 重构进入稳定阶段后，CC-Niri 下一阶段不优先增加 Overview、多窗口 Column、复杂视觉组件，而是补齐日常窗口管理所需的基础交互语义。

本阶段集中实现以下能力：

1. **持久化 100% Column**
2. **统一 Column Width Preset**
3. **窗口/Column 移动到相邻工作区**
4. **直接切换指定工作区**
5. **直接将当前 Column 移动到指定工作区**
6. **取消 Dock 后收紧 Safe Area**
7. **逐步退役 Dock 专用路径，但保留通用 Bridge**
8. **保持现有 Workspace / Spring / Focus Ring / Recovery 架构不退化**

本阶段目标不是模仿 niri 的全部功能，而是建立完整、稳定且符合 CC-Niri 当前交互体系的核心窗口管理模型。

---

# 2. 当前基线

当前已经完成：

- 单窗口 Column
- Pair 双列布局
- `third / half / twoThirds` 三种宽度
- Contextual Focus Wide
- `Meta+H/L` Column 导航
- `Meta+Shift+H/L` Column Reorder
- `Meta+J/K` Workspace 导航
- Workspace W0–W9
- Workspace Snapshot
- 动态末尾空工作区
- 空工作区自动回收
- Workspace Transfer
- Native ViewOffset + Spring
- Native Focus Ring
- Persistence
- Stability Supervisor
- Emergency Restore
- Dock 双向同步

当前默认 Safe Area：

```text
top    = 50
bottom = 70
left   = 24
right  = 24
inner  = 8
```

其中 `bottom = 70` 主要来源于早期 Dock 使用场景。

当前已经不再依赖 Dock 作为主要日常窗口入口，因此底部留白需要重新设计。

---

# 3. 本阶段原则

## 3.1 不与 Rust 重构混合修改语义

Rust Native Core 重构负责：

```text
C++ → Rust
```

本阶段负责：

```text
用户交互 / Layout Model / Workspace UX
```

禁止在同一个提交中同时：

```text
迁移 Native Rust
+
修改 Column Width
+
修改 Workspace Move
```

语言迁移与功能开发必须独立。

---

## 3.2 新功能必须进入现有模型

禁止通过额外临时状态实现：

```text
100% Width
Workspace Move
Direct Workspace
```

这些都必须进入现有：

```text
ColumnStore
WorkspaceSnapshot
LayoutEngine
WorkspaceController
ShortcutCatalog
```

等正式模型。

---

# 4. Phase A — Persistent Full Column

## 4.1 目标

增加真正持久化的：

```text
100% Column
```

其语义类似：

```text
widthMode = full
```

而不是 Focus Wide。

---

# 5. Column Width Model 扩展

当前：

```text
widthMode:
    third
    half
    twoThirds
```

扩展为：

```text
widthMode:
    third
    half
    twoThirds
    full
```

推荐明确含义：

| widthMode | 宽度 |
|---|---:|
| `third` | 约 33% |
| `half` | 约 50% |
| `twoThirds` | 约 67% |
| `full` | 100% |

---

# 6. Full Width 几何

在：

```text
ColumnLayout.computeColumnWidth()
```

增加：

```js
if (mode === "full") {
    return Math.max(1, safeWidth);
}
```

因此：

```text
pixelWidth(full) = safeWidth
```

Full Column 仍然属于：

```text
Column Strip
```

而不是：

```text
Fullscreen
```

---

# 7. Full 与 Fullscreen 的区别

必须保持：

```text
full Column
≠
KWin fullscreen
```

Full Column：

```text
受 Safe Area 控制
保留顶部 panel 区域
保留底部 outer gap
保留 Focus Ring
保留 H/L
保留 Workspace
保留 Column ordering
```

Fullscreen：

```text
交给 KWin 原生处理
不受 Safe Area 限制
```

禁止混淆。

---

# 8. Full 与 Focus Wide 的区别

当前：

```text
Focus Wide ≈ 72%
```

保留为：

```text
temporary Presentation
```

新增：

```text
full = persistent Column width
```

区别：

| 功能 | Focus Wide | Full Column |
|---|---|---|
| 所属模型 | Presentation | Column widthMode |
| 默认比例 | 72% | 100% |
| 离开焦点后 | 恢复 Pair | 保持 100% |
| Workspace Snapshot | 保存 Wide preference | 保存 `widthMode=full` |
| H/L 后回来 | 按上下文恢复 | 始终 100% |
| 重启后 | 按 Presentation 恢复 | 始终 100% |

两套语义第一阶段同时保留。

P2 已实现的优先级：`widthMode=full` 时不进入 72% Wide 视口，已有 `persistentWide` 偏好保留但暂不生效。方向导航、快照恢复及显式 Wide 命令均保持 Full 的 100% 几何；恢复非 Full 宽度后可继续使用原有 Wide 偏好。Full 不新增 Presentation mode 或动画时钟。

---

# 9. Full 必须持久化

以下流程后必须保持：

```text
Window A
widthMode = full
```

经过：

```text
H/L 切走
H/L 返回
J/K 切工作区
返回工作区
窗口迁移到其他 Workspace
cc-niri restart
KWin Script reload
Bridge reconnect
```

仍为：

```text
full
```

---

# 10. Workspace Snapshot 修改

当前 normalization：

```text
third
half
twoThirds
```

增加：

```text
full
```

即：

```js
[
    "third",
    "half",
    "twoThirds",
    "full",
]
```

Workspace Persistence、Bridge validation、Startup restore 等所有 `widthMode` validator 必须同步更新。

禁止出现：

```text
full 被 normalize 回 half
```

---

# 11. Width Preset Cycle

建议增加统一操作：

```text
Cycle Column Width
```

推荐顺序：

```text
third
  ↓
half
  ↓
twoThirds
  ↓
full
  ↓
third
```

默认快捷键建议：

```text
Meta+R
```

动作名：

```text
CCScrollCycleColumnWidth
```

description：

```text
CC Scroll: Cycle Column Width
```

---

# 12. Toggle Full

另外提供快速：

```text
当前宽度 ↔ full
```

建议快捷键：

```text
Meta+F
```

行为：

```text
half → full
full → previousWidthMode
```

推荐额外在 Column 中保存：

```text
widthBeforeFull
```

但该字段是否需要持久化，应谨慎处理。

更简单方案：

```text
full → half
```

但用户体验较差。

推荐实现：

```text
ColumnState:
    widthMode
    previousNonFullWidthMode
```

其中：

```text
previousNonFullWidthMode
```

只保存：

```text
third
half
twoThirds
```

P3 已采用 `previousNonFullWidthMode`，随 protocol 1/2 兼容的 Workspace Snapshot 保存，只允许上述三种值。缺少或无效记忆时，普通列以当前非 Full 宽度初始化，旧 Full 以 half 初始化。Meta+R 进入 Full 时保存刚离开的宽度，离开 Full 到 third 时更新记忆；Meta+F 从 Full 恢复保存值。

宽度操作只作用于当前活动的受管列。Fullscreen、浮动、副屏、无活动列和工作区切换期间 no-op；改宽度退出 Wide / 安全区域最大化展示，保留 persistentWide 偏好。复用现有 LayoutTransaction / LayoutEngine，退役旧 ACK 写回；宽度修改前保存 strip 矩形，Native ACK 后统一提交，Rust 从最后绘制矩形接续 resize / 视口与邻居运动，完成后按现有规则停车，不新增独立动画时钟。宽度循环不强制恢复原来的 A｜B。几何提交同时考虑实际 frame 与最后发出的请求，避免 Wayland 延迟 configure ACK 下快速 Full 往返丢失最终宽度。

---

# 13. Full 与 Strip Layout

Full Column 进入 Strip 后仍应正常拥有：

```text
logicalX
pixelWidth
```

例如：

```text
A half
B full
C half
```

逻辑布局：

```text
A
    gap
B(full)
    gap
C
```

H/L 应继续基于：

```text
logicalX
scrollOffsetX
```

运行。

禁止为 Full 单独建立：

```text
特殊 viewport 模式
```

Full 应尽可能只是：

```text
一种 widthMode
```

从而减少复杂度。

---

# 14. Full Column 验收

测试：

```text
half → full
full → half

third → full
twoThirds → full

A half
B full
C half
```

测试：

```text
A → B → C
C → B → A
```

要求：

```text
无 snap
无错误 scrollOffset
无异常 parking
无 viewport overshoot
无 Ring 错位
```

---

# 15. Phase B — Workspace Move

## 15.1 目标

增加：

```text
Move current Column to previous Workspace
Move current Column to next Workspace
```

并保持现有 Width / Wide Preference / Window Policy。

---

# 16. 快捷键设计

当前：

```text
Meta+H
Meta+L
    → Focus Column

Meta+Shift+H
Meta+Shift+L
    → Move Column
```

当前：

```text
Meta+J
Meta+K
    → Focus Workspace
```

因此新增：

```text
Meta+Shift+J
Meta+Shift+K
```

语义：

```text
Meta+Shift+J
    Move current Column to next Workspace

Meta+Shift+K
    Move current Column to previous Workspace
```

形成统一规则：

```text
Meta + direction
    → Focus

Meta + Shift + direction
    → Move
```

---

# 17. Workspace Move 必须作用于 Column

第一阶段：

```text
一个 Column = 一个窗口
```

因此实际移动对象是当前受管窗口。

但 API 和命名必须使用：

```text
Column
```

而不是：

```text
Window
```

以保证未来 Multi-window Column 不需要重新改 API。

---

# 18. 推荐新增 WorkspaceMoveController

禁止简单在 Shortcut handler 中：

```js
window.desktops = [...]
```

建议新增：

```text
src/kwin/workspace/
    WorkspaceMoveController.js
```

职责：

```text
movePrevious()
moveNext()
moveTo(workspaceId)
```

---

# 19. Workspace Move Transaction

建议流程：

```text
focused Column
      │
      ▼
resolve source workspace
      │
      ▼
resolve target workspace
      │
      ▼
capture source snapshot
      │
      ▼
preserve Column preference
      │
      ▼
change KDE membership
      │
      ▼
WorkspaceTransferController
      │
      ▼
target snapshot update
      │
      ▼
workspace switch
      │
      ▼
restore focus
```

---

# 20. 默认行为：Move and Follow

建议：

```text
Meta+Shift+J/K
```

执行后：

```text
Column 移动
+
用户跟随到目标 Workspace
+
该 Column 保持 focus
```

即：

```text
move-and-follow
```

第一阶段不实现：

```text
move-without-follow
```

避免增加多余命令。

---

# 21. 移动后必须保持状态

必须保持：

```text
widthMode
persistentWide
previousNonFullWidthMode
floating policy（如适用）
```

例如：

```text
Firefox
widthMode = full
```

执行：

```text
Meta+Shift+J
```

到下一 Workspace 后仍：

```text
widthMode = full
```

---

# 22. Source Workspace Focus

当前 Column 移走后：

如果 source 仍有 Column：

```text
优先右邻居
否则左邻居
```

如果 source 为空：

```text
允许变为空 Workspace
```

由 Dynamic Workspace / Recycler 决定是否后续回收。

---

# 23. Dynamic Workspace 配合

如果：

```text
Workspace 3
```

是 trailing empty workspace。

当前：

```text
Workspace 2
```

执行：

```text
Meta+Shift+J
```

将 Column 移入 Workspace 3。

则：

```text
Workspace 3 occupied
```

W8 应创建新的：

```text
Workspace 4 empty
```

如果 Workspace 2 因此为空且满足 W9 回收条件：

```text
允许自动回收
```

该过程必须保持：

```text
workspace ID authority
snapshot ownership
```

正确。

---

# 24. Phase C — Direct Workspace Navigation

## 24.1 目标

增加：

```text
直接进入指定 Workspace
```

---

# 25. 快捷键

建议：

```text
Meta+1 → Workspace 1
Meta+2 → Workspace 2
...
Meta+9 → Workspace 9
```

动作：

```text
workspaceFocus(1..9)
```

---

# 26. Workspace 不存在时

第一阶段：

```text
不存在 → no-op
```

不要因为：

```text
Meta+9
```

就自动创建大量 Workspace。

动态创建仍然只通过：

```text
Trailing Empty Workspace
```

管理。

---

# 27. Direct Workspace Move

P6 已实现并部署；`WorkspaceMoveController.moveNumber` 查询当前一基编号后进入 P4 的 `moveTo`。完整门禁与自动实机状态核验通过，用户视觉验收待反馈。当前 / 缺失目标不操作，事务固定目标 ID，窗口资格与并发保护沿用 P4。见 [P6 记录](../../test/CORE_UX_P6_RESULTS.md)。

同时增加：

```text
Meta+Ctrl+1
Meta+Ctrl+2
...
Meta+Ctrl+9
```

语义：

```text
Move current Column to Workspace N
```

默认：

```text
move-and-follow
```

与：

```text
Meta+Shift+J/K
```

保持一致。

---

# 28. Workspace Shortcut Summary

最终：

```text
Meta+J
    Next Workspace

Meta+K
    Previous Workspace

Meta+Shift+J
    Move Column to Next Workspace

Meta+Shift+K
    Move Column to Previous Workspace

Meta+1..9
    Focus Workspace N

Meta+Ctrl+1..9
    Move Column to Workspace N
```

---

# 29. Phase D — Compact Safe Area

## 29.1 目标

Dock 已经不再作为底部核心 UI，因此取消：

```text
bottom = 70
```

的大留白。

---

# 30. 新默认值

推荐：

```text
top    = 50
bottom = 8
left   = 24
right  = 24
inner  = 8
```

即：

```js
primary: {
    top: 50,
    bottom: 8,
    left: 24,
    right: 24,
    inner: 8,
}
```

---

# 31. Bottom 不建议为 0

原因：

- Focus Ring 为窗口外沿描边
- 边缘需要少量视觉呼吸
- 与 inner gap 保持统一
- 避免窗口视觉完全粘住屏幕物理边缘

推荐：

```text
bottom = inner = 8
```

---

# 32. 顶部保持 50

本阶段不调整：

```text
top = 50
```

因为顶部仍需考虑当前 panel。

后续另行实现：

```text
KWin Work Area
+
CC-Niri Outer Gap
```

避免手动编码 panel 高度。

---

# 33. Safe Area 下一阶段方向

本阶段只先：

```text
70 → 8
```

之后独立设计：

```text
Safe Area V4
```

目标：

```text
KWin usable work area
        ↓
CC-Niri outer gap
        ↓
Column layout
```

而不是：

```text
raw screen
    -
hardcoded panel gaps
```

---

# 34. Full Column 与 Safe Area

Full：

```text
100%
```

指：

```text
100% Safe Area Width
```

而不是：

```text
100% physical screen
```

因此：

```text
fullRect.x = safeRect.x
fullRect.width = safeRect.width
```

---

# 35. Phase E — Dock Retirement

## 35.1 目标

Dock 已不再作为主要 UI，因此其逻辑不应继续成为 Layout 核心依赖。

P7 已实现：Dock planner 与四类 UI 命令由 `EnableDockIntegration` 显式开启，默认关闭。通用 Bridge、快照、动画完成、Recovery 与 Ring 保留。默认安装 Core，`--with-dock` 安装并启用可选集成；不删除已有面板或 applet。完整门禁与部署通过，实机范围见 [P7 记录](../../test/CORE_UX_P7_RESULTS.md)。Bridge 原有名称、端点与 generic queue 快捷键保留至 P8。

---

# 36. 不应删除 Bridge

当前 Bridge 已经承担：

```text
D-Bus
Workspace Snapshot persistence
runtime state exchange
```

因此：

```text
Bridge != Dock
```

本阶段禁止直接删除 Bridge。

---

# 37. 目标架构

当前：

```text
ScrollDockBridge
      │
      ├── Dock
      ├── Workspace persistence
      └── Runtime IPC
```

目标：

```text
CCNiriBridge
      │
      ├── Workspace persistence
      ├── Runtime IPC
      └── Optional Dock integration
```

最终：

```text
Dock
```

可以完全移除而不影响：

```text
Layout
Workspace
Recovery
Persistence
```

---

# 38. Dock 专用功能逐步退役

候选：

```text
DockGateway
Dock authoritative ordering
Dock hidden-item step planner
Dock context menu
Plasmoid-specific command
```

第一阶段不必全部删除。

应先完成：

```text
Dock 不存在
```

时：

```text
所有核心功能仍正常
```

---

# 39. Dock 退役基本要求

以下功能不得依赖 Dock：

```text
H/L
J/K
Reorder
Width
Full
Wide
Floating
Workspace Move
Workspace Persistence
Startup Restore
Emergency Restore
Focus Ring
```

---

# 40. Plasmoid

如果确认长期不再使用：

```text
plasmoid/com.cc.scrolltasks/
```

后续可从默认安装流程中移除。

但不作为本阶段 P0。

优先做到：

```text
optional
```

---

# 41. Phase F — Shortcut Catalog 重构

随着快捷键增加，建议整理：

```text
ShortcutCatalog.js
```

按功能分组：

```text
Workspace
Column Focus
Column Move
Column Width
Presentation
Floating
Debug
```

---

# 42. 推荐最终快捷键

## Column Navigation

```text
Meta+H
    Previous Column

Meta+L
    Next Column
```

## Column Reorder

```text
Meta+Shift+H
    Move Column Left

Meta+Shift+L
    Move Column Right
```

## Workspace

```text
Meta+K
    Previous Workspace

Meta+J
    Next Workspace
```

## Move to Workspace

```text
Meta+Shift+K
    Move Column to Previous Workspace

Meta+Shift+J
    Move Column to Next Workspace
```

## Direct Workspace

```text
Meta+1..9
```

## Direct Workspace Move

```text
Meta+Ctrl+1..9
```

## Width

```text
Meta+R
    Cycle Width

Meta+F
    Toggle Full
```

## Presentation

```text
Meta+Z
    Toggle Focus Wide
```

## Floating

```text
Meta+Shift+Enter
    Toggle Floating
```

---

# 43. Width 与 Presentation State Boundary

必须保持：

```text
widthMode
```

属于：

```text
ColumnStore
```

而：

```text
Focus Wide
Maximize
```

属于：

```text
PresentationController
```

禁止把：

```text
full
```

实现成：

```text
presentationMode = full
```

---

# 44. Workspace Move 与 Presentation

移动前如果窗口正处于：

```text
Focus Wide
```

建议：

```text
结束临时 Presentation
保留 persistentWide preference
移动基础 Column
目标 Workspace 重新根据上下文恢复
```

不建议直接把正在进行中的：

```text
Wide animation state
```

跨 Workspace 搬运。

---

# 45. Workspace Move 与 Motion

如果正在 H/L Scroll：

```text
Meta+Shift+J/K
```

应先：

```text
cancel / finalize current scroll transaction
```

再移动 Workspace。

禁止同时存在：

```text
SCROLL motion
+
workspace transfer
```

竞争同一 Window geometry。

---

# 46. Workspace Move 与 Focus Ring

Ring 不需要特殊保存。

流程：

```text
source workspace
   ↓
owner disappears
   ↓
eligibility refresh
   ↓
target workspace
   ↓
native KWin focus
   ↓
new owner
```

必须确保：

```text
旧 Workspace 无残留 Ring
目标窗口正常显示 Ring
```

---

# 47. Workspace Move 与 Floating

第一阶段：

```text
Meta+Shift+J/K
```

只作用于：

```text
当前 managed Column
```

如果当前 active window 是：

```text
Dialog
Floating
Transient
```

则：

```text
no-op
```

不要自动寻找 remembered Column。

---

# 48. Error / Fail-safe

所有新操作必须进入现有：

```text
InvariantChecker
StabilitySupervisor
```

需要新增或复用检查：

```text
duplicate-workspace-owner
wrong-workspace
inactive-mounted
mounted-workspace-owner
duplicate-window
```

如果 Workspace Move 后出现 ownership conflict：

```text
FAIL_SAFE
```

优先于继续操作损坏状态。

---

# 49. Persistence Migration

加入：

```text
widthMode = full
```

后，旧 snapshot：

```text
third
half
twoThirds
```

必须继续正常加载。

不需要 bump persistence protocol，前提是新增值向后兼容。

但 validator 必须同步。

---

# 50. Width Default

新窗口默认仍然：

```text
half
```

本阶段不修改。

未来可增加：

```text
App Rules
```

例如：

```text
Firefox → full
Zed → half
Konsole → half
```

但不属于本阶段。

---

# 51. Phase 顺序

推荐严格按：

```text
P1
Safe Area bottom 70 → 8
        ↓
P2
widthMode full
        ↓
P3
Cycle Width / Toggle Full
        ↓
P4
Workspace Move Previous/Next
        ↓
P5
Direct Workspace
        ↓
P6
Direct Workspace Move
        ↓
P7
Dock dependency removal
        ↓
P8
Bridge rename / cleanup
```

Safe Area 改动最简单，可先快速完成。

---

# 52. Commit 建议

每个功能独立 commit：

```text
feat(layout): add persistent full-width columns

feat(shortcuts): add column width controls

feat(workspace): move focused column between adjacent workspaces

feat(workspace): add direct workspace navigation

feat(workspace): move column directly to numbered workspace

refactor(layout): compact primary safe-area bottom gap

refactor(dock): remove dock dependency from core runtime

refactor(bridge): separate generic runtime IPC from dock integration
```

禁止一个巨型提交完成全部阶段。

---

# 53. 自动测试

## Full Width

必须增加：

```text
computeColumnWidth(full)
deriveColumnLayout full
scroll reveal full
full between half columns
snapshot normalize full
persistence roundtrip full
workspace transfer full
```

---

# 54. Workspace Move Tests

覆盖：

```text
move previous
move next
first workspace boundary
last workspace boundary
target missing
source becomes empty
target previously empty
target already has columns
full column move
wide preference move
closed window during move
workspace recycle interaction
```

---

# 55. Direct Workspace Tests

覆盖：

```text
Meta+1
Meta+9
non-existing workspace
current workspace
rapid switching
switch while scroll active
```

---

# 56. Direct Move Tests

覆盖：

```text
move to same workspace
move to occupied workspace
move to empty workspace
move full column
move first/last column
```

---

# 57. Safe Area Tests

检查：

```text
bottom = 8
```

时：

```text
Pair geometry
Full geometry
Maximize
Focus Ring
Fullscreen restore
```

均正确。

---

# 58. 实机验收矩阵

至少准备：

```text
Konsole
Firefox
Dolphin
Zed / Electron
```

---

# 59. Full Width 实机验收

打开：

```text
A
B
C
```

设置：

```text
A half
B full
C half
```

执行：

```text
H/L
快速 L L H
J/K
cc-niri restart
```

要求：

```text
B 始终 full
动画连续
Focus Ring 正确
无错误 parking
```

---

# 60. Workspace Move 实机验收

执行：

```text
Meta+Shift+J
Meta+Shift+K
```

检查：

```text
目标窗口跟随
Workspace 自动切换
Focus 保持
Width 保持
旧 Workspace 正常
Dynamic workspace 正常
```

---

# 61. Dynamic Workspace 实机验收

准备：

```text
W1 occupied
W2 occupied
W3 trailing empty
```

在 W2 移动当前 Column 到 W3：

```text
Meta+Shift+J
```

确认：

```text
W3 occupied
W4 自动产生
```

如果 W2 空：

```text
W9 根据策略正确回收
```

---

# 62. Direct Workspace 实机验收

执行：

```text
Meta+1
Meta+2
Meta+3
```

要求：

```text
无 wrap
无错 workspace
Snapshot 正确恢复
Wide / Full 正确恢复
```

---

# 63. Direct Move 实机验收

执行：

```text
Meta+Ctrl+1
Meta+Ctrl+2
```

检查：

```text
Column owner 唯一
目标 workspace 正确
move-and-follow 正确
```

---

# 64. Dockless 实机验收

P7 已在 Plasma Shell 进程与 D-Bus owner 完全退出时通过下列受控实机状态核验，另验证通用 Bridge 紧急恢复；原布局、实际焦点、配置和面板恢复核对通过。用户动画观感与长期日常 smoke 待反馈，范围与证据见 [P7 记录](../../test/CORE_UX_P7_RESULTS.md)。

关闭/移除 Dock 后运行：

```text
H/L
J/K
Full
Wide
Floating
Workspace Move
Restart
Persistence
```

全部必须工作。

---

# 65. 不属于本阶段

明确暂缓：

```text
Overview
Multi-window Column
Gesture Navigation
Touchpad Workspace Gesture
Secondary Scroll Columns
Window Rules
App Auto Width
Animated Workspace Move
Workspace OSD
Quickshell Workspace UI
```

这些等 Core UX 稳定后再做。

---

# 66. 后续建议功能

完成本阶段后，再考虑：

## Output Move

例如：

```text
Move Column to Previous Output
Move Column to Next Output
```

---

## Application Rules

例如：

```text
Firefox:
    width = full

Konsole:
    width = half
```

---

## Workspace OSD

提供当前：

```text
Workspace
Column index
Width mode
```

但属于视觉层，不是核心必需。

---

# 67. Definition of Done

本阶段完成必须满足：

- [x] `widthMode=full` 已实现
- [x] full = 100% Safe Area width
- [x] full 不等于 Fullscreen
- [x] full 不等于 Focus Wide
- [x] full 可持久化
- [x] full 可跨 Workspace 保持
- [x] Full toggle 已实现
- [x] Width cycle 已实现
- [x] `Meta+Shift+J/K` 已实现
- [x] Workspace Move 使用正式 transaction/controller
- [x] Workspace Move 默认 move-and-follow
- [x] Workspace Move 保持 widthMode
- [x] Workspace Move 与 W8/W9 正常协作（生成运行时自动测试通过；实机验收见下项）
- [x] `Meta+1..9` 已实现
- [x] `Meta+Ctrl+1..9` 已实现（P6 完整门禁与自动实机状态核验通过，用户视觉验收待反馈）
- [x] bottom gap 默认从 70 改为 8
- [x] Full Column 在新 Safe Area 下正确
- [ ] Focus Ring 在底部正确显示
- [x] Dock 不再是核心功能依赖（P7 默认无 planner / UI handler，生产包回归通过）
- [x] Bridge 保留通用 persistence / IPC（名称、端点与 ABI 保留，P8 后续清理）
- [x] Dockless 模式完整可用（P7 核心、门禁与无 Plasma / Dock 受控实机矩阵通过，人工 / 日常验收见 P7 记录）
- [x] Workspace Snapshot backward compatible
- [ ] 自动测试全部通过
- [ ] `node tools/check.js --native` 通过
- [ ] Rust Native 门禁通过
- [ ] 实机 Full 验收通过
- [x] 实机 Workspace Move 验收通过（P4 用户已确认）
- [ ] Dynamic Workspace 验收通过
- [ ] Dockless 日常 smoke 通过
- [ ] 无新增 `INVARIANT_FAIL`
- [ ] 无新增 `FAIL_SAFE`
- [ ] 无 KWin crash

---

# 68. 最终目标

完成这一阶段后，CC-Niri 的基础交互模型应变成：

```text
Horizontal
──────────────────────────────────────

Meta+H / L
    Focus Column

Meta+Shift+H / L
    Move Column

Meta+R
    Cycle Width

Meta+F
    Toggle Full


Vertical
──────────────────────────────────────

Meta+J / K
    Focus Workspace

Meta+Shift+J / K
    Move Column + Follow


Direct
──────────────────────────────────────

Meta+1..9
    Focus Workspace

Meta+Ctrl+1..9
    Move Column to Workspace


Presentation
──────────────────────────────────────

Meta+Z
    Contextual Focus Wide


Policy
──────────────────────────────────────

Meta+Shift+Enter
    Toggle Floating
```

最终实现：

```text
33 / 50 / 67 / 100
        ×
Horizontal Columns
        ×
Vertical Workspaces
```

形成 CC-Niri 自己完整的二维窗口管理模型。

---

# 69. 推荐开发顺序总结

```text
Rust Native 重构稳定
        ↓
Safe Area bottom 8
        ↓
Persistent Full Column
        ↓
Width Cycle / Toggle Full
        ↓
Move Column Previous/Next Workspace
        ↓
Direct Workspace Navigation
        ↓
Direct Workspace Move
        ↓
Dockless Core
        ↓
Bridge Genericization
        ↓
完整 Daily Acceptance
```

这一阶段完成后，再开始 Overview、Multi-window Column 等更高级功能。
