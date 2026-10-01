# W6/W7 部署后 KWin 崩溃分析

2026-10-01，feature/workspace-stack。实机验收失败；当前保持全部 cc-niri 组件停用。

## 现场与证据

- 部署日志 `/tmp/cc-niri-w67-deploy.log`：约 15:53:29 完成安装。
- `coredumpctl list kwin_wayland`：15:54:35 至 15:58:49 共 9 次 SIGSEGV。
- 第一份 core（PID 2069）：`KWin::XdgSurfaceWindow::destroyWindow` 经 JavaScript 信号
  进入 `QV4::WeakSetPrototype::method_add` → `QV4::ESTable::set` → `QV4::Value::sameValueZero`。
- 最后一份 core（PID 224578）：`KWin::WorkspaceWrapper::windowAdded` 经 JavaScript 信号
  进入 `QV4::WeakSetPrototype::method_has` → `QV4::ESTable::has` → `QV4::Value::sameValueZero`。
- 栈导出保存在 `/tmp/cc-niri-crash-2069.txt` 和 `/tmp/cc-niri-crash-224578.txt`；
  KWin 日志在 `/tmp/cc-niri-w67-crash-kwin.log`。这些是现场临时文件，不属于仓库交付物。
- 环境 Qt Qml 6.11.2、KWin 6.7.5。生产源与 bundle 中唯一 WeakSet 位于 W6
  `WorkspaceTransferController.closed`，在窗口关闭时 add、窗口新增及归属变化时 has。

## 原因与恢复

W6 使用 WeakSet 保存关闭窗口的 Qt QObject 包装对象。实际 KWin 生命周期中，关闭对象
留在集合后，后续 add/has 在 Qt 引擎的对象比较路径触发原生 SIGSEGV。两份现场栈与唯一
WeakSet 调用路径一致，因此将该记录方式作为本次直接修复点。原生崩溃无法由 JS try/catch 恢复。

安装后的插件启用配置会在 KWin 重启时再次加载该脚本，新窗口或关闭窗口再次触发同一路径，
形成崩溃循环。用户关闭 Script、scroll-transition、viewport-clip 的 Enabled 配置并停止
Bridge 后恢复桌面。读取状态确认三项插件停用、Script 未加载、Bridge inactive；
查询 15:59:00 之后未发现新增 KWin core dump。

这次部署后尚未开始临时窗口和手动迁移验收，不将任何 W6/W7 实机用例记为通过。
现场栈没有指向 W7 或 native clip，但这不等于它们的所有实机行为已经验证。

## 仓库修复与验证

- 关闭记录改为仅保存 UUID 字符串的 Set，历史上限 4096；迁移重入集合也只保存 UUID。
  同次迁移缓存 UUID，关闭过程中后续判断不再把 QObject 交给集合比较。
- 重新生成生产 Script bundle。
- 新增 `workspace-qobject-lifetime` CTest：真实 QJSEngine 执行生产 TransferController，
  创建并销毁 5000 个 QObject 窗口替身，间隔 GC，检查关闭后拒绝采用、集合仅保存字符串、
  历史大小受限。
- `node tools/check.js --native` 全部通过：67 个 JS 测试文件、Bridge 3 项 CTest、
  隔离 D-Bus integration、native clip 2 项 CTest，以及三项 native 构建。
  门禁日志 `/tmp/cc-niri-w67-crash-fix-check.log`。

之前的 Node 行为模拟与 QJSEngine 语法检查未覆盖 QObject 销毁后的集合操作，导致漏检。
单独 QJSEngine + 普通 QObject 的旧 WeakSet 最小实验未复现原始崩溃；新增测试验证修复的
对象生命周期处理，不能替代 KWin compositor 实机验收，也不宣称已经独立复现 Qt 内部缺陷。

此次仅修改仓库，未重新安装或启用组件。已安装的旧版本仍应保持停用，修复后的部署及
主屏视觉/窗口迁移验收待后续执行。
