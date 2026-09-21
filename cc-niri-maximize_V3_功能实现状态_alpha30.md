# CC Niri Maximize V3 功能实现状态说明

适用版本：`3.0.0-alpha.30`  
文档日期：2026 年 9 月 21 日  
测试环境：Fedora 44、Plasma 和 KWin 6.7.5、Wayland

## 当前结论

当前版本已经完成主屏滚动列、Dock 双向同步、72% Focus Wide、Floating、安全区域布局和主要稳定性机制。

副屏继续使用独立的安全区域布局，但不参与滚动列、Focus Wide 和 Dock 列排序。

Dock 远距离点击采用紧凑的逐列滚动。目标窗口只在最后一步获得焦点，当前每步间隔为 `140 ms`。`alpha.29` 和 `alpha.30` 的修改已经安装，但尚未提交 Git。

## 版本状态

| 项目 | 当前状态 |
| --- | --- |
| 已安装版本 | `3.0.0-alpha.30` |
| 主屏 | `DP-1`，2560 × 1440，缩放 1.5 |
| 副屏 | `HDMI-A-1`，2560 × 1440，缩放 1.0 |
| 最近 Git 提交 | `ddaf1c0 fix: make persistent wide a discrete navigation step` |
| 工作区状态 | Dock 分步滚动和 140 ms 节奏已安装但尚未提交 |

## 功能范围概览

| 功能区域 | 主屏 | 副屏 | 说明 |
| --- | --- | --- | --- |
| 滚动列 | 已实现 | 不参与 | 主屏普通窗口进入 Column 模型 |
| 安全区域最大化 | 已实现 | 已实现 | 两块屏幕使用独立边距 |
| 安全区域 Quick Tile | 已实现 | 已实现 | 支持八个方向和角落 |
| Focus Wide | 已实现 | 不参与 | 固定 72% 并居中 |
| Floating | 已实现 | 保持原生 | 主屏窗口可退出和重新加入队列 |
| Dock 顺序同步 | 已实现 | 不参与 | KWin 是列顺序的最终权威 |
| F11 Fullscreen | 保持原生 | 保持原生 | 不受安全区域限制 |

## 主屏滚动列

- 每个普通窗口占一个 Column。
- 默认每列宽度为安全区域的 50%，正常情况下同时显示两个窗口。
- 所有实际窗口 geometry 由统一的 `relayout()` 写入。
- `Meta+H` 和 `Meta+L` 分别聚焦前一个和后一个 Column。
- 到达首尾后停止，不循环。
- 已经可见的窗口不会产生无意义滚动。
- 隐藏窗口只滚动到刚好完全可见的位置。
- `Meta+L` 的新窗口从右侧进入。
- `Meta+H` 的新窗口从左侧进入。
- 只有完全位于主屏安全区域内的 Column 会显示。
- 部分可见或离屏 Column 会被停放在完整虚拟桌面的左侧。
- 停放窗口不会转移到右侧副屏，也不会在副屏闪烁。
- 主屏已有的 Quick Tile 窗口在启动接管时解除原生 tile 关联，避免固定窗口残留在滚动视口下方。

## 窗口加入和退出队列

脚本启动时会同步接管主屏上符合条件的普通窗口。之后出现的窗口通过明确的 adoption 状态机加入队列，避免 Electron 和 Code 等映射较慢的客户端在 geometry 尚未确认时落入错误位置。

- 新窗口首次满足条件并激活后，插入当前焦点 Column 的右侧。
- 尚未激活的窗口会等待首次激活。
- 副屏窗口会等待进入主屏。
- Fullscreen、Quick Tile 或最大化窗口会等待恢复 Normal。
- Plasma Shell 编辑模式窗口不会进入滚动队列。
- popup、menu、tooltip 和 transient popup 不会成为 Column。
- Dialog 默认排除。
- 新窗口 adoption 会等待 KWin 确认目标 geometry。
- 慢映射窗口会通过 activation、ready for painting 和 geometry change 信号重试。
- 关闭焦点窗口时优先选择右邻居。
- 关闭最后一列时退回左邻居。
- 关闭可见左侧窗口时保持右侧窗口的位置稳定，并显示左侧前驱。
- 主屏 Column 移到副屏后立即离开主屏模型。
- 窗口返回主屏并激活后可以重新加入。

## Dock 交互和顺序同步

`CC Scroll Tasks` 使用窗口 UUID 与 KWin Column 模型同步。KWin 保持 geometry 和逻辑顺序的最终控制权，Bridge 只传递事件，不执行轮询。

- 拖动 Dock 中的受管任务可以重排 Column。
- KWin 会校验完整 UUID 集合后再提交顺序。
- `Meta+Shift+H` 和 `Meta+Shift+L` 会同步更新 Dock 顺序。
- 新窗口插入和窗口关闭也会发布最新顺序。
- 固定启动器与运行窗口分开显示。
- 受管任务关闭分组并使用手动排序。
- 活动任务使用绿色半透明背景和居中的 3 px 绿色指示线。
- 修复了多个 Dock 图标同时出现活动横线的问题。
- 非活动应用窗口本身不会被调暗。
- 重复、过期、会话不匹配或 generation 不一致的命令会被拒绝。
- 拒绝错误命令后，KWin 会重新发布权威状态。

## Dock 点击滚动

点击已经显示的 Dock 任务只切换焦点，不移动视口。

点击隐藏任务时，脚本把远距离跳转拆成相邻视口事务。例如：

```text
1|2 → 2|3 → 3|4 → 4|5
```

- 目标窗口只在最后一步激活。
- 每个步骤间隔为 `140 ms`。
- 连续动作会重叠成较短、较连续的滚动。
- 每个相邻事务始终保留一个共同可见窗口，让 effect 能确定正确方向。
- 不再让远距离目标窗口直接从 Dock 位置冒出来。
- 滚动期间再次点击 Dock 会取消旧计划并从当前位置开始新计划。
- 按 `Meta+H` 或 `Meta+L` 会取消 Dock 滚动计划。
- 重排、关闭或新增窗口也会取消旧计划。
- Bridge 使用 FIFO 命令队列，连续步骤不会互相覆盖。

## Focus Wide

Focus Wide 是主屏 Column 的会话级持久属性。

- `Meta+Z` 在 50% Normal 和 72% Focus Wide 之间切换。
- Wide 使用安全区域宽度的 72%。
- Wide 窗口在安全区域中央显示。
- Wide 状态下，其他受管窗口暂时停放。
- 逻辑顺序和 Dock 顺序保持不变。
- 再按一次 `Meta+Z` 后恢复 50% 双窗口布局。
- 副屏不参与 Focus Wide。

### Wide 离散导航

通过 `Meta+H` 或 `Meta+L` 返回一个已标记为 Wide 的 Column 时，导航分成两个明确步骤。

假设第三列为 Wide：

```text
1|2 → 2|3 → 3@72%
```

- 第一次 `Meta+L` 停在 `2|3`，不会自动继续。
- 第二次 `Meta+L` 才把第三列扩展为 72%。
- 使用 `Meta+H` 返回 Wide 时行为对称。
- 邻居窗口会保留到目标真正接受 72% geometry 并完成绘制动画。

## Presentation 模式

Dock 右键菜单提供以下模式：

- Normal
- Focus Wide
- Maximize in Safe Area

其他行为：

- KDE 标题栏最大化按钮与安全区域最大化使用同一个 Presentation 状态。
- 从最大化恢复后返回原来的双列布局。
- Presentation 不会永久修改正常 scroll offset。
- 从 50% 进入 72% 使用纯视觉缩放和位移动画。
- 实际 geometry 仍由脚本控制。

## Floating 模式

- `Meta+Shift+Enter` 在受管 Column 和 Floating 之间切换。
- 窗口离开队列时保留可访问的实际 geometry。
- Floating 窗口不会继续使用离屏停放位置。
- 再按快捷键可以重新加入队列。
- 重新加入时插入当前焦点 Column 的右侧。
- 开始交互式移动或调整大小时，受管窗口会自动进入 Floating。
- 短时间内焦点发生变化时，脚本仍会记住刚刚分离的 Floating 窗口，方便再次按快捷键重新加入。
- 已修复 Zen、ChatGPT 等窗口离开队列后无法返回的问题。

## Column 顺序调整

- `Meta+Shift+H` 将当前 Column 向左移动一位。
- `Meta+Shift+L` 将当前 Column 向右移动一位。
- 移动后保持当前窗口焦点。
- 新顺序会同步到 Dock。
- 原 `Meta+R` 功能和快捷键已经删除。

## 快捷键

| 快捷键 | 功能 | 范围 |
| --- | --- | --- |
| `Meta+H` | 聚焦前一个 Column | 主屏滚动列 |
| `Meta+L` | 聚焦后一个 Column | 主屏滚动列 |
| `Meta+Z` | 切换 50% 和 72% Focus Wide | 主屏滚动列 |
| `Meta+Shift+H` | 将当前 Column 向左移动一位 | 主屏滚动列 |
| `Meta+Shift+L` | 将当前 Column 向右移动一位 | 主屏滚动列 |
| `Meta+Shift+Enter` | 在 Column 和 Floating 之间切换 | 主屏窗口 |
| `Meta+Ctrl+Alt+Shift+F12` | 紧急恢复脚本停放的窗口 | 维护用途 |

`Meta+Ctrl+Alt+Shift+F11` 是 Bridge 内部命令泵快捷键，不用于日常操作。

## 安全区域和双屏行为

主屏和副屏使用独立配置。布局依据 `output.geometry` 计算，不使用会随 Dock 显示状态变化的 `MaximizeArea`，因此 Dock 隐藏和显示不会改变窗口 geometry。

### 默认参数

| 参数 | 主屏默认值 | 副屏默认值 |
| --- | --- | --- |
| 输出 | 左侧输出或 `DP-1` | `HDMI-A-1` |
| 上边距 | 50 px | 24 px |
| 下边距 | 70 px | 24 px |
| 左边距 | 24 px | 24 px |
| 右边距 | 24 px | 24 px |
| 窗口内间距 | 8 px | 8 px |
| 最大化区域 | `24,50 2512×1320` | `2584,24 2512×1392` |

### 布局行为

- 两块已配置屏幕都支持安全区域 pseudo maximize。
- 左、右、上、下和四个角的 Quick Tile 都在各自安全区域内重新计算。
- 相邻 tile 只使用一个 inner gap，不在每条内部边缘重复添加。
- F11 保持真正的物理 Fullscreen。
- 退出 Fullscreen 后恢复之前的安全区域布局。
- 窗口跨屏后会把 restore geometry 转换到目标输出坐标。
- 跨屏窗口会应用目标屏的边距和 inner gap。
- 未配置输出保持 KWin 原生行为。
- 进入和退出 Plasma 编辑模式不会永久改变受管窗口 geometry。

## 动画和焦点反馈

- `Meta+H` 和 `Meta+L` 使用方向明确的滚动动画。
- Dock 点击隐藏任务使用连续分步滚动。
- 关闭窗口后的补位使用滚动动画。
- 50% 和 72% 之间使用 paint-only 的 Scale 和 Translation。
- 动画不会修改 safeRect、inner gap、Column 宽度或逻辑位置。
- 自定义 Focus Ring 已移除，避免白色轮廓覆盖 popup 和 context menu。
- KWin 全局 Dim Inactive 已关闭，副屏窗口不会被非活动效果影响。
- 第三方 Geometry Change effect 在安装时暂时关闭，避免停放 geometry 被重复动画。

## 稳定性和恢复机制

- 布局事务使用 epoch、嵌套深度和 invariant 审计。
- 审计会检查重复窗口、重复 UUID、逻辑位置和状态所有权。
- adoption 状态机区分以下状态：
  - untracked
  - waiting activation
  - waiting primary
  - waiting eligible
  - waiting normal
  - adopting
  - settling
  - managed
  - floating
  - ignored
- 停放窗口保存原始透明度和最后可见 geometry。
- 脚本记录窗口是否由自己最小化，只恢复自己拥有的状态。
- 安装、卸载或紧急恢复会先停止 relayout，再恢复脚本停放的窗口。
- Bridge 使用 session ID、generation 和唯一 command ID。
- Bridge 保留有限去重记录，防止旧命令修改新会话。
- Bridge 命令使用 FIFO 队列，避免连续命令被覆盖。
- 屏幕列表、虚拟桌面 geometry 和输出顺序变化会触发安全区域重算。
- 实现由 KWin 信号和 D-Bus 事件驱动，不使用轮询。

## 验证状态

`alpha.30` 已完成以下验证：

- JavaScript 语法检查通过。
- 完整 Node 回归测试通过。
- Bridge C++ 编译通过。
- 安装后的脚本文件与项目输出一致。
- 现场使用七个半宽 Column 测试从第二列跳转到第七列。
- 目标在分步滚动完成后获得焦点。
- 测试后 Column 顺序、generation 和 Presentation 状态保持一致。

## 当前未实现功能

- 一个 Column 内包含多个窗口。
- Tabbed Column。
- Overview 集成。
- 跨重启保存 Column 顺序。
- 跨重启保存 Focus Wide、Floating 和滚动位置。
- 副屏滚动列布局。
- 副屏与 Dock 的双向 Column 排序。
- 不经过每个相邻 Column 的远距离压缩滚动或惯性动画。

## 已知限制

- 安全区域最大化窗口在内部保持 unmaximized，以阻止 KWin 强制使用原生 `MaximizeArea`。部分窗口装饰仍可能显示最大化图标。
- Focus Wide 的持久属性只在当前 KWin 会话中有效，重启后不会恢复。
- Dock 远距离滚动必须保留相邻视口链路才能可靠确定方向。当前通过缩短节奏减少等待时间，而不是直接跳过所有中间列。
- 当前工作区包含未提交的 `alpha.29` 和 `alpha.30` 修改，Git 最新提交仍为 `ddaf1c0`。
