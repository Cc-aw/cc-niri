# W5 — Bridge 多 Workspace 持久化

2026-10-01，feature/workspace-stack。主屏布局；W4 内屏动画修复已获用户确认。
本阶段已部署到当前日用会话，完成 eDP-1 单主屏的自动实机验收。

## 保存与恢复

- 独立 WorkspacePersistence：发布 protocol 2 Snapshot，根 workspaceId / columns
  描述当前 Workspace，workspaces[] 使用稳定 Desktop id 保存各 Workspace 的纯数据。
  保存 UUID 顺序、widthMode、persistentWide、focusedUuid、viewportAnchor、viewport、presentation。
  不保存 live Window / Column graph、临时 Column ID、停车坐标或异步事务对象。
- 活动图的普通 Dock 发布先 capture 更新 active Snapshot；切换事务的 prepared mount
  已 capture，屏障期间不覆盖切换前 Snapshot。Dock 顶层 columns 仍只包含 active graph。
- 启动先加载全部有效 Snapshot，再按 KDE 实际 current Desktop mount；不会切到保存数据
  的旧 active ID。其它 Workspace 留在 SnapshotStore，切入时才构建 Columns。
  mount 继续遵守 W3 的 Pair + normal、KDE active focus 优先、UUID + delta anchor 与边界限制。
- protocol 1 数据映射到当前 KDE Desktop，恢复可用的 order/width/anchor；旧 active Wide
  同时推导 persistentWide 偏好。旧格式未记录的其它 Workspace 无法反向补出。
- protocol 2 校验 workspace ID、列 UUID、跨 Workspace 唯一归属、active 列顺序/宽度一致性。
  无效输入整包拒绝，Store 不被部分覆盖；非法引用和偏好字段按既有稳态规范化处理。
  已删除 Desktop 丢弃；关闭、Sticky、多 Desktop、其它输出和 policy-floating 窗口在 mount
  prune/reconcile 中移除，新 eligible 窗口按现有规则追加。
- Snapshot scoped 到保存的 targetOutput；不把其它输出的旧布局挂载到当前主屏。
  StartupLayout 保留，WorkspaceMountController 通过 Persistence 处理新旧 schema。

## Bridge 与 Dock

- Bridge 接受 protocol 1/2 State，保留 session/generation 回退保护；protocol 2 校验
  所有 Workspace ID/UUID 唯一性与根 active columns 一致性，拒绝损坏或冲突状态。
- 每次有效发布通过 QSaveFile 原子保存到
  `${XDG_STATE_HOME:-~/.local/state}/cc-niri/workspaces.json`，上限 1 MiB。
  Bridge 重启读取有效缓存供 GetState 返回，缓存数据不启用旧 live session；新的 KWin
  publish 后才建立 live session。损坏/超大缓存忽略，按当前 KDE 窗口重建。
- 正常运行时写盘失败记录 warning，继续更新 live Dock 状态；部署交接写盘失败会返回失败，
  Installer 在停止旧 runtime 前中止，保留旧会话。Installer 使用新构建 Bridge 的
  --save-current-state 保存旧版本内存中的 protocol 1/2 数据，再 stop/install/start。
- state schema 与 command/motion 协议分离：仅 State 升级至 protocol 2；Dock command、
  deferred command、motion plan/completion、emergency restore 仍使用 protocol 1。
  现有 native motion/clip 消息无需改协议。Plasmoid DockState 接受 1/2，只消费根 columns。
- 未改变 Desktop transfer 或 visual motion 取消算法，完整处理仍留给 W6/W7。

## 自动验证

`node tools/build.js`、`node tools/check.js --native` 通过：65 个 JS 测试文件，
Bridge CTest 及独立 D-Bus integration 通过；Bridge / Viewport clip / Plasmoid native 构建通过。

- Persistence 单元测试：多 Workspace metadata、拷贝隔离、protocol 1 迁移、已删除桌面、
  重复 ID/UUID、空 UUID、active root 不一致、错误输出及无效输入的原子拒绝。
- 生成的生产 KWin bundle 在全新 VM 重载：A/B 各自 order/width/Wide/focus/anchor 保存，
  保存 active B 而 KDE 实际 A 时挂载 A；后续切 B 恢复旧顺序；关闭/Sticky 清理与新窗口追加。
  使用实机问题对应的 Qt 风格非 Array desktops，回归 W0–W4。
- 直接执行 DockState.qml 的 parse：兼容 State 1/2，只处理 active columns，忽略 sleeping
  Workspace 列，仍拒绝 generation 回退与未知协议；Gateway Snapshot=2 / command=1。
- 原生 Bridge CTest：保存/重启、冲突状态与 generation 回退拒绝、损坏缓存忽略、
  新 live session 重建、缓存未启用 emergency、protocol 1 commands 兼容、写盘失败继续 live。
- 独立 dbus-run-session 启动真实 Bridge binary：DBus Publish/GetState、升级前交接、
  protocol 1/2 持久化、进程停止/重启、故障缓存，以及部署交接写盘失败的非零退出。
  使用临时 XDG_STATE_HOME 和独立总线，不触碰真实桌面或用户保存目录。

## 主屏实机部署与验收

运行完整 ./install.sh 升级 Script、Bridge、Dock reader，并重启 Plasma Shell。
首次启动暴露 QJSEngine 不支持对象剩余解构，改成 Object.assign 拷贝并删除 workspaceId 后
重新部署成功。新增原生 QJSEngine 编译生产 Script/Effect bundle 的 CTest：旧 bundle
可复现语法失败，修复后通过。完整回归门禁仍为 65 个 JS 测试文件，两个 CTest 与隔离
D-Bus integration 全部通过。

- Script loaded、登录启用、scroll transition Effect、native viewport clip 均为 true，Bridge active。
- W4 protocol 1 的桌面 A 五个窗口顺序、half 宽度、焦点、anchor 和当前 Wide 推导出的
  persistentWide 偏好迁移到 protocol 2；磁盘 workspaces.json 与实时 GetState 相同。
- 临时调整 A 列顺序并滚动，切到空桌面 B 执行 cc-niri restart：session 更新，KDE 实际
  Desktop 仍为 B，休眠 A 的 order/width/Wide/focus/anchor Snapshot 完整保留。
  返回 A 挂载保存的非默认列顺序与偏好。
- 单独重启 Bridge：缓存 GetState 与重启前一致；KWin 后续重新发布建立 live session，
  磁盘与实时快照再次一致。
- 在 B 创建两个独立 Konsole 临时窗口，调整列顺序及 Wide 后重启 cc-niri：两个窗口的
  非默认顺序与 persistentWide 恢复。切回 A 关闭 B 的一个窗口，再切入 B 时移除关闭 UUID；
  关闭另一个后 B 回到空列，磁盘同步保存空状态。
- 通过实际 KGlobalAccel H/L 动作触发滚动，Effects.debug 报告 eDP-1 当前窗口的 Translation，
  Duration 220 ms、940 px 位移。此项确认动画运行，视觉流畅度仍需用户观察。
- 已关闭全部临时窗口，恢复原桌面 A、原五列顺序、ChatGPT 焦点与 Wide 展示。

实机验证只使用笔记本内屏。third/twoThirds 宽度、Sticky、多 Desktop 与非法缓存由自动回归
覆盖，本轮未在日用窗口上修改。Dock reader 已随 Plasma 重启加载，并消费 protocol 2；
鼠标拖动、点击与视觉效果仍需人工体验。不包含恢复应用程序启动，W6 transfer/W7 Effect
清理不在 W5 验收范围内。

## Dock 桌面过滤补修

用户实测发现 J/K 后仍显示其它桌面窗口。原因是 Dock TasksModel 的
filterByCurrentVirtualDesktop 硬编码为 false；active columns 正确不能替代任务模型的窗口过滤。
现改为 true，符合架构第 50 节要求。Plasmoid QML 编译与原生构建通过，已安装并重启
Plasma Shell；cc-niri Script、两个 Effect 和 Bridge 仍正常运行。固定 launcher 和 Sticky
窗口遵循 KDE 的跨桌面规则，普通运行窗口按当前桌面过滤；切换后的图标显示待用户确认。
