# Core UX P8 — CC-Niri Bridge 命名与清理

日期：2026-10-08。依据 [Core UX 设计](../doc/todo/CC-Niri%20Core%20UX%20下一阶段实施设计.md) §§37、41、51–52 实施。用户已确认 P7 无问题；本轮保留 P1–P7 与既有 Full 动画修复，不恢复延期的分数列宽，不改变布局、焦点、工作区、Spring 或动画参数。

## 通用 IPC 与兼容

通用 C++ 实现改为 `CCNiriBridge`，程序 / CMake target 改为 `cc-niri-bridge`，systemd unit 改为 `cc-niri-bridge.service`。JS `DockGateway` 改为 `RuntimeBridge`，通用 snapshot / publish / commit / command pump 与 workspace controller 的提交 hook 改用 runtime / state 名称；`[cc-bridge]` 日志与 Dock UI 日志区分。可选 `DockScrollController`、Dock command type、Plasmoid 包名与用户的 `EnableDockIntegration` 保持。

| 入口 | 生产名称 | 兼容方式 |
| --- | --- | --- |
| D-Bus service / object / interface | `org.cc.CCNiriBridge` / `/CCNiriBridge` / `org.cc.CCNiriBridge1` | 旧 `org.cc.ScrollDockBridge` / `/ScrollDock` / `org.cc.ScrollDockBridge1` 由同一进程持有；`LegacyScrollDockAdaptor` 仅转发 slots / signals |
| systemd | `cc-niri-bridge.service` | 旧 `cc-scroll-dock-bridge.service` 是该 unit 的 Alias，不能启动第二套状态 / 队列 |
| 可执行程序 | `cc-niri-bridge` | 安装旧名 shell 入口，直接 exec 同目录的新程序 |
| KGlobalAccel 通用 IPC | `CCScrollPublishRuntimeState` / `CCScrollApplyRuntimeCommand` | 旧 `CCScrollPublishDockState` / `CCScrollApplyDockCommand` 注册为同一 handler 的别名 |

当前布局、Native Clip 与可选 Plasmoid 客户端使用新端点。旧已安装的 Dock / 客户端仍通过兼容端点连接；兼容 adaptor 不拥有 cache、session、generation、epoch、队列或布局 authority。新旧接口只发布对应的单份信号，客户端不同时订阅两套端点。

快照 1 / 2、Scroll v2、Ring v1、Native FFI / ABI、Rust 实现和 `cc-niri/workspaces.json` 状态路径保持。C++ Bridge / Clip 的生产 policy body 与已验收 P7 在标识符、日志 / shortcut 与端点名称归一后逐字一致。本轮未修改 Rust / FFI、frozen oracle 或 hot-path 算法，没有每帧 JSON / 第二套动画时钟。

## 安装与快捷键

`--save-current-state` 优先读取新端点；仅当新 service 不存在时读取旧 live service。其他读 / 写错误保持失败并中止升级，持久化仍使用原校验与 QSaveFile。安装先保存、停止旧运行时，再安装不可变 Clip、新 Bridge / CLI，退休旧独立 unit 并安装新 unit / Alias，最后升级布局包并启动。默认不安装或重启 Dock / Plasma，`--with-dock` 沿用 P7 的显式开启路径。

CLI 的恢复优先使用现有 EmergencyRestore 快捷键；fallback 支持新 / 旧 D-Bus 端点与 command-pump 快捷键，恢复失败仍不卸载脚本。stop / uninstall 同时处理新 unit 与旧兼容入口，不改写用户面板。

`ShortcutCatalog` 按 Workspace、Column Focus / Move / Width、Presentation、Floating、Debug 和 Compatibility 分组。原 35 个 action ID / description / default sequence 与用户自定义绑定保留；新增两个 canonical IPC action 默认无绑定，旧 F11 queue action 保留原序列，避免争抢绑定。H/L、J/K、数字导航 / 移动、R/F、Z、重排与 Floating 的行为保持。

## 自动验证

- `node tools/build.js`、`bash -n cc-niri install.sh uninstall.sh`、最终 `node tools/check.js --native` 通过：99 个 JS 测试文件、Rust 1.99.0 fmt / locked clippy `-D warnings` / locked workspace 31 单测、Bridge 16 / Clip 15 / Ring 22 CTest、Golden differential、Qt JS 语法、Plasmoid、生成包、whitespace 与生产 Rust 边界。
- 5 个隔离 D-Bus 测试通过：canonical persistence / vertical layout / Scroll；旧端点 Scroll；新增兼容测试覆盖 legacy-only 升级保存、同一 bus owner、两侧读取 / 发布 / signals、共享 stale guard、跨端点 queue / dedup / deferred command、emergency、错误协议与重复进程拒绝。
- 生产包默认 Dockless 回归执行 canonical IPC，并验证旧 publish / recovery shortcut 仍使用同一 generation / handler。安装器临时 HOME 验证旧 unit 退休、只启动 canonical unit、配置保留、默认不重启 Plasma 与 help / 参数拒绝不产生变更。
- GNU 16.x `/usr/bin/g++` 显式 configure：Core Debug / Release 各 11 CTest，umbrella Debug 26 CTest；`BUILD_TESTING=OFF` Bridge / 两插件构建与 production symbol boundary 通过，target list 无 Golden reference / differential。
- configure policy 验证 GNU 16.x 接受，非 GNU、GCC 15 / 17、其他 C++ 路径拒绝。没有工具链策略变更，未额外重跑伪 Rust / Cargo 版本的 configure 拒绝矩阵。

最终门禁 `/tmp/cc-niri-core-ux-p8-native.log`；Core 两配置 `/tmp/cc-niri-core-ux-p8-core-configs.log`；umbrella CTest `/tmp/cc-niri-core-ux-p8-umbrella.log`；无测试生产 / boundary `/tmp/cc-niri-core-ux-p8-production.log`；编译器策略 `/tmp/cc-niri-core-ux-p8-toolchain.log`。首轮 JS 两处旧测试名称 / catalog 字面格式断言已更新，针对性复验及最终完整门禁通过；生产 boundary 的首轮命令误用 umbrella 产物目录，改用其实际 `bin/` 目录后三产物检查通过，历史日志保留。

## 部署与实机

备份 `/tmp/cc-niri-redeploy-20261007-8hid5usc`。保存旧 live Bridge 数据后按既有 stop / immutable Clip install / Bridge install / KPackage upgrade / start 路径部署，独立 staged install 核对新 Bridge、旧名 shim 与 Clip 安装字节。布局 / CLI 源码哈希匹配，Ring / Script Effect / 已安装 Plasmoid 字节保持。systemd 新旧名称的 Id / MainPID / Names 完全一致，D-Bus 新旧 service 拥有相同 bus owner / state；用户列顺序、偏好、membership、设置、主屏独立模式、输出、面板清单与 KWin PID 2050 保持。安装不重启 Plasma；受控实机测试单独短暂停止它。

UTC 09:10:56–09:11:29（本地 17:10–17:11）使用两个仅运行 `sleep` 的临时 Konsole 完成无 Plasma / Dock 实机状态核验：H/L、重排、half / Full、Wide / parking、Floating / 返回、J/K、数字非相邻移动与返回、相对移动与返回、CLI restart / persistence、Rust Ring / 副屏隔离与 canonical generic emergency 均通过。canonical unit 及旧 Alias 各重启一次，均正确重发同一 runtime snapshot，无额外 generation、焦点丢失或重复 owner。

临时客户端关闭，finally 恢复并核对原 membership、顺序、偏好、锚点、工作区拓扑、主屏记忆 / 实际全局焦点、输出、动画 / 边距 / Dock / Debug 配置、Native 安装字节和 Plasma 面板 / applet ID。没有创建 / 回收用户工作区。受控窗口期间无新增 `INVARIANT_FAIL`、`FAIL_SAFE`、JS 错误、completion timeout 或 Rust panic，KWin PID 保持。实机证据在备份下 `p8-live/`（success / restoration-success、逐步 Bridge / Ring / KWin 窗口状态），日志 `/tmp/cc-niri-core-ux-p8-live.log`；部署日志 `/tmp/cc-niri-core-ux-p8-deploy.log`。

用户 P8 动画观感与日常 smoke 待反馈；本轮未测 FPS / GPU 或长期压力。空目标 / 动态回收的状态机沿用原实现并由生产回归覆盖，本轮实机不删除用户桌面。不自动移除已有 Dock，不把受控状态核验扩大为人工视觉验收。

## 回滚

仅恢复部署前 P7 的 Bridge / unit / CLI / 布局包与旧不可变 Clip 发现链接，保留当前持久布局、KDE 设置、快捷键、Ring、Script Effect 与面板：

```sh
python3 /tmp/cc-niri-redeploy-20261007-8hid5usc/rollback-p8.py
```

回滚脚本先通过当前运行时恢复窗口 / stop，再恢复 P7 安装文件，移除本轮首次新增的 canonical entry / unit，重新加载 systemd 并启动 P7。已映射的 Native 库不原地覆盖。源码回滚以 `/tmp/cc-niri-p8-source-baseline` 为 P7 基线限定本轮变更，不撤销 P1–P7 / Full 修复和用户独立文档。本轮实现已获用户确认，按 Core 基线、P7、P8 分组提交；分数列宽继续延期，Core UX 专项与日常总验收的未完成项保持原记录。

2026-10-08 用户反馈“我测试没问题 帮我提交了吧”：P8 用户实机 / 日常 smoke 验收通过。此前待反馈为部署历史，未测 FPS / GPU / 长期压力的限制保持。
