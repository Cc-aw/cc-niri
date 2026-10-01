# W9 — Auto Recycle Empty Workspace

2026-10-01，feature/workspace-stack。用户明确要求新增自动回收并保持模块化。
这扩展了原架构 MVP/W8 的 create-only 范围；原架构文档已增加 W9。
尚未部署或启用 W9，当前日用会话仍为已部署的 W8 纵向网格修复版。

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

## 待执行主屏实机验收

部署并显式开启 W8/W9 后检查：已有空非当前桌面收敛；窗口关闭或移走后的空桌面回收；
当前桌面关掉最后窗口仍留在原桌面，J/K 离开后回收；Floating/Fullscreen/minimized
阻止删除；Wide/滚动中切桌面；始终保留末尾空桌面且不循环创建/删除；restart 快照与
纵向网格一致。关闭 W9 后 W8 恢复只追加。
这轮仅离线实现，不将任何 W9 实机删除用例记为通过。
