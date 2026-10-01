# W9 — Auto Recycle Empty Workspace

2026-10-01，feature/workspace-stack。用户明确要求新增自动回收并保持模块化。
这扩展了原架构 MVP/W8 的 create-only 范围；原架构文档已增加 W9。
已通过 `./install.sh` 部署并显式开启 W8/W9。主屏 eDP-1 功能复测通过；
首轮 Firefox 离列异常未复现，原因仍未确定，不能标记为已解决。
2026-10-01 用户确认当前使用没有问题，接受本轮验收并要求合入 main、推送远程。

## 模块与行为

- WorkspaceRecycleController 独立负责回收；AutoRecycleWorkspaces 默认 false，且只有
  DynamicTrailingWorkspace=true 才工作。W8 保持原有 create-only 行为。
- WorkspaceOccupancy 共享归属读取与 shell 过滤。W8 创建依据主屏应用占用；W9 删除
  依据全输出、全活动的实际存活窗口，不能用 active Columns 或保存的 Snapshot 判空。
- 保留末尾桌面和每个输出当前桌面。空的当前桌面离开后回收，不强制切换桌面，不写
  焦点或窗口几何。显式启用后会清理此前已有的空非当前桌面。
- 所有原生窗口归属都保护桌面，包括 Floating/Fullscreen/minimized/Dialog/multi-desktop
  及 native-only/unmanaged 窗口。Sticky 与 Plasma/Dock/Desktop 不占用单一工作区。
  归属序列/UUID 缺失时不删除。
- 事件合并为 200 ms 的实时检查，一次只请求删除一个空 UUID。启动、switch、transfer、
  W8 创建和 W9 删除分别有屏障；W8 完成后通知 W9，W9 完成后通知 W8。
- 删除前通过当前 topology 解析原生 VirtualDesktop 对象，按原生 API 同步删除；延迟任务
  仅保留字符串 UUID，避免保存已销毁的窗口或桌面 QObject。
- 1 秒后以实际 topology 确认成功，再清理 snapshot 并提交 Bridge。同步 signal 重入与
  延迟确认均处理；原生删除后异常仍以实际 topology 决定是否清理。API 缺失/错误/no-op
  在同一 topology 上不循环重试。清理异常进入 Emergency Recovery，停止继续删除。
- Recovery / unload 取消任务；晚到确认不能发布或再次删除。原有 rows=count 同步继续
  保持单列，已有桌面 UUID、顺序与活动列不重建。

API 使用依据：[KDE KWin scripting API](https://develop.kde.org/docs/plasma/kwin/api/)，
removeDesktop 接收原生 VirtualDesktop 对象；不是将 UUID 字符串直接传给 scripting API。

## 自动验证

新增独立模块测试与真实生产 bundle 接线测试：

- 默认关闭、依赖 W8、已有空桌面、只剩一桌面、当前空桌面离开后回收、末尾保留；
- 全输出/活动、原生窗口、Floating/Fullscreen/minimized/Dialog/multi-desktop/Qt sequence；
- 未知归属不删除、shell/sticky 过滤、延迟期间窗口新建后重新判空；
- 原生同步信号、延迟确认、no-op/异常、部分原生成功、清理异常与停止后的晚到任务；
- 真实 window membership/close/currentDesktop 信号、W8/W9 不振荡、snapshot 与 Bridge
  无已删除桌面、rows 随数量减少同步、列与焦点不变、Emergency 停止。

新增 workspace-recycle-qobject-lifetime CTest，在真实 QJSEngine 执行生产占用和回收
模块，通过 native Qt 方法销毁 500 个真实 Desktop QObject，使用真实 QList<QObject *>
窗口归属序列及 GC，验证同步销毁后确认、清理和末尾保留。
该测试不模拟真实 KWin compositor 的完整视觉/窗口生命周期，不能替代实机验收。

`node tools/build.js` 与 `node tools/check.js --native` 全部通过：71 个 JS 测试文件、
Bridge 4 项 CTest、两项隔离 D-Bus 集成、clip 2 项 CTest，以及 Bridge / clip / Plasmoid
三项 native 构建。另补充的延迟成功确认用例通过；配置 XML/UI 解析及 diff whitespace
检查通过。门禁日志 `/tmp/cc-niri-w9-check.log`。

## 主屏实机验收（2026-10-01 20:16–20:30）

当前仅测试笔记本 eDP-1。实际 KWin/Bridge/Qt 测试窗口检查通过：

1. 启用后原 5 个桌面收敛到 3 个，两个有应用的原桌面 UUID 与当前 UUID 保留；
   删除原有空非当前桌面，rows 从 5 同步为 3。
2. 将真实测试窗口移到末尾，W8 只追加一个新的末尾空桌面。
3. 确认浮动快捷键的目标 UUID，并确认测试窗口实际退出 Columns；Floating、
   Fullscreen，以及非当前桌面的 minimized Floating 窗口均阻止回收。
4. 当前桌面关闭最后窗口后仍保留且不跳桌面；J 离开后旧空桌面被回收，末尾保留。
5. 将最后窗口移走也会回收空来源桌面。测试窗口关闭后数量回到 3，rows 同步减少，
   Bridge snapshot 不包含已删除桌面，未发现重复追加/删除振荡。
6. restart 后当前 UUID 与纵向网格一致。
7. 关闭 W9 后，W8 仍追加末尾；空的非当前来源桌面保持存在。再次启用 W9 后自动回收。
8. 所有原应用仍在原桌面，原列顺序、焦点及 viewportAnchor 最终与启用前一致。
   恢复顺序通过正式 Bridge reorder 命令完成，未移动原应用归属。

最终：3 行 1 列，W8/W9 开启；Script、transition、clip 与 Bridge 均在运行，
DebugLogging 恢复 false，测试窗口与临时接收器已退出。
自 20:15 起未发现新增 KWin core dump，未发现脚本 INVARIANT_FAIL/FAIL_SAFE。
拓扑改变期间出现 vertical desktop layout not confirmed 警告（旧数量的异步请求被
拒绝，后续实际 rows 校验通过）。Dock ToolTipDelegate 另有一次 containsMouse/null
TypeError，未影响本轮回收检查；不能将日志表述为完全无警告或错误。

### 验收异常与限制

首轮 Firefox 仍在原桌面但不在 Columns，随后 restart 将其重新纳入并追加到列末尾。
用户明确表示没有拖动、调整大小或切成浮动。首轮未开启事件日志，无法确定离列来源，
也没有证据可以归因于用户操作或验收快捷键误作用。
开启临时事件日志后，在浮动快捷键前验证目标 UUID，逐阶段读取 Dock Columns；
完整复测中原用户列保持顺序，浮动日志只记录测试窗口，Firefox 未再次离列。
原列顺序已恢复。此异常仍待出现时捕获原因，不因复测成功标记为修复。

验收脚本也修正了三个断言问题：不能要求被占用再清空的末尾 UUID 永久不变；
比较用户列时应过滤仍存活的测试窗口；旧探针未包含 normalWindow 字段，最终归属
改为逐一按启用前原列 UUID 核对。修正后的对应检查通过。

逐帧 J/K 动画、Wide/滚动途中快速切桌面仍需要用户视觉验收；本轮自动状态检查
不替代这些观察。双屏不属于当前项目实机验收范围。
日志：`/tmp/cc-niri-w9-deploy.log`、`/tmp/cc-niri-w9-live-guarded.log`、
`/tmp/cc-niri-w9-finish.log`；阶段快照 `/tmp/cc-niri-live-results/`。
最后收尾脚本因旧探针字段缺失退出后，已独立核对最终原列/焦点/锚点/归属与桌面数量，
并关闭其临时接收器。
