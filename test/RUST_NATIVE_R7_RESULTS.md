# Rust Native R7 实现与验收记录

日期：2026-10-06；2026-10-07 更新。R0–R7 已完成 Rust 生产默认、Legacy 清理、完整本地门禁与部署。2026-10-07 重新部署后用户确认“全部正常”，随后明确“rust完成”，Rust 重构验收完成。首轮部署因锁屏未完成的动画 / 帧率复验保留为历史记录；本次用户确认不等同于新增 FPS 测量或 V3 全套 release gate。

## 范围与边界

先独立提交 Rust 默认切换，再删除生产目录的 Spring、ViewportMotion、ScrollViewportRuntime、Ring geometry / eligibility 和 Scroll sequence C++ policy。R1–R6 六个迁移 / 测试开关及五个 backend CMake 选择器退休；旧 cache 的值会被清理，并明确提示 Native Core 固定 Rust。`./install.sh`、两个 standalone 插件入口和 Native umbrella 都沿用现有构建 / 安装路径。

`common/NativeCore.cmake` 仅编译 Qt DTO 转换和 FFI handle ownership。Spring / Motion / Scroll、Ring 数值与 eligibility、共享 validation / sequence 固定 Rust；C++ 保留 KWin hook、QObject / QPointer、实际 focus / visibility、Scene Item、渲染、damage 和 D-Bus。表示类型拆到 MotionTypes / ScrollTypes / FocusRingCandidate，不再通过旧算法 header 取得 DTO。

Bridge 原有 C++ Scroll 校验 / sequence 也改为复用现有 Rust adapter；它继续持有自己的原有 sequence，不改变与 Native observer / runtime 的独立生命周期。Scroll v2、Ring v1、JS 发布 authority 和 schema 保持不变。Cancel epoch 的最后一处 JSON integer policy 经新增窄 C ABI 转发 Rust，保留 0–2^53−1、类型、fraction / NaN / Inf 拒绝规则；12 个旧 C++ scalar 对照和原协议 corpus 均通过。

旧算法只冻结在 `native/rust/tests/reference/`。数学 / 状态语义保留，机械调整共享 DTO、include、旧 alias 和 reference 名称；不继续开发。仅 BUILD_TESTING 下的 `cc-niri-golden-reference` 可编译，header 编译 guard 禁止生产包含；`tools/check-native-boundary.py` 用 ELF defined symbols 检查生产 Bridge / 两个插件，已纳入完整 Native 门禁。旧 R6 Clip 产物含有未使用的 C++ Scroll 算法符号，负向审计正确拒绝；R7 产物不含这些符号。

既有 H/L、Spring 参数、retarget、Incoming / Continuing / Outgoing、Pair/Wide、Ring、工作区和快捷键行为保持。独立 420ms WorkspaceMotion 已在此前授权的优化中实现，R7 不改其曲线或开关默认 false；当前实机保持已启用的 420ms 配置。Rust / Cargo 1.99.0、GNU 16.x `/usr/bin/g++`、Cargo.lock、panic=abort、无 async / 线程 / 全局锁保持。

## 本地验证

实际工具链：Rust / Cargo 1.99.0、GNU GCC 16.2.1。

| 检查 | 结果 |
| --- | --- |
| cargo fmt --all --check | 通过 |
| cargo clippy --locked --workspace --all-targets -- -D warnings | 通过 |
| cargo test --locked --workspace | 30 项通过 |
| node tools/check.js --native | 89 个 JS 回归、Bridge 16 CTest / 3 隔离 D-Bus、Clip 15 CTest、Ring 22 CTest、Plasmoid 构建、生产符号边界全部通过 |
| Core Debug / Release configure / build / CTest | 各 11 项通过，保留六类 Golden differential、四个 Rust / FFI 契约和 compiler policy |
| Native umbrella 默认 RelWithDebInfo | `build/native-r6-on`，26 项 CTest 通过；旧 ON cache 已退休 |
| Native umbrella 默认 Debug | `build/native-r7-debug`，26 项 CTest 通过 |
| BUILD_TESTING=OFF 发布构建 | `build/native-r7-production` 两插件、`build/bridge-r7-production` Bridge 均通过；无 reference target / 旧 policy 符号 |
| 旧 OFF cache / 命令参数 | 发布构建显式给旧 Scroll OFF；重新 configure 后 cache 无此选项，产物固定 Rust |
| compiler reject policy | 两配置均拒绝非 GNU、GCC 15 / 17、非 `/usr/bin/g++`；真实 GNU 16.x 通过 |
| Rust / Cargo 精确版本拒绝 | 独立 configure fixture 分别拒绝 rustc / cargo 1.98.0 |
| 生成包 / patch whitespace | 通过；生产 JS 源码与已安装 bundle 没有 R7 行为改动 |

Core 的 13→11、Native 的 28→26 仅因删除两个旧 C++ Motion × Spring 可切换 backend 契约组合。其数学比较仍由 Spring / Motion Golden differential 覆盖，生产 Motion / Spring 契约固定 Rust（Spring 的独立 ODE 对照也切到生产 Rust sampler）。没有删除原 Scroll / Ring / Workspace 场景；后端组合矩阵改为默认 Rust Debug / RelWithDebInfo 和测试隔离检查。

Native CI 已改为默认 Rust Debug / RelWithDebInfo，执行完整门禁；Rust fmt / clippy / test / Debug–Release Core jobs 保留。**本轮没有推送，也未触发远端 Actions**，以上 CI 对应检查在本地执行通过。日志：`/tmp/cc-niri-r7-native-gate-final.log`、`/tmp/cc-niri-r7-{debug-ctest,release-tests,combined-tests,native-debug,artifact-boundary}.log`、发布构建及工具链拒绝日志。

## 分阶段提交与回滚点

此前 R0–R6 和工作区修复都在工作树中，未提交。此次按模块整理成独立可回滚提交；各快照的 Rust 测试及两个 KWin 插件 configure / build 已独立复核。这些是当前代码的分阶段整理，不伪造历史时间或历史提交；早期共享类型以最终表示按依赖引入。

| 阶段 | Commit | 内容 |
| --- | --- | --- |
| r0 | `7f698d431fd8` | refactor(rust): add R0 native workspace and pinned toolchains |
| r1 | `2de4415317d5` | refactor(rust): port R1 spring core with differential tests |
| r2 | `e0f3c4382e00` | refactor(rust): port R2 viewport motion and epoch contracts |
| r3 | `388ce0bd3ef2` | refactor(rust): port R3 scroll runtime and test adapters |
| r4 | `d1bd858f2b5d` | refactor(rust): add R4 production scroll runtime selection |
| r5 | `241353be58f0` | refactor(rust): port R5 focus ring geometry core |
| r6 | `25db792f436a` | refactor(rust): share R6 native protocol and eligibility policy |
| workspace | `42fb3883603f` | fix(workspace): preserve departure pose and optimize primary 4K animation |
| rust_default | `7034b9a2bd0e` | refactor(native): make validated Rust backends the production default |
| r7 | `c9a5cee1bb4b` | refactor(native): retire legacy C++ cores after R6 acceptance |

R7 清理提交为 **c9a5cee1bb4b**。源码回退该提交即可回到 **7034b9a2bd0e** 的默认 Rust、保留 C++ 参考 / 迁移选择器状态；不需要把生产默认退回 C++。

## 部署与实机范围

沿用 save-current-state / cc-niri stop / immutable install / start；两个插件用既有 installer 生成新 canonical 并原子切换链接，Bridge 原子替换。未覆写 mapped `.so`、未读取受保护 process maps。部署时间 UTC **2026-10-06T10:04:27.356654+00:00**；最终只读核验 UTC **2026-10-06T10:11:15.944509+00:00**。

| 项目 | R7 部署值 |
| --- | --- |
| Clip SHA-256 | `79121b9d4d632732f728c6061ff7a9f98e0ca71476efe3c3a2b010d7e3e5fb10` |
| Ring SHA-256 | `53d9d9d67c1cab83f3a7d41ef1e0e368d721d8699117dcdc80ad6d53baf41691` |
| Bridge SHA-256 | `778cc9726787c21410b0054a8875f671e00cee7941f52b544c30e363f2a2d25b` |
| CLI SHA-256 | `1fa002e1b938484ab10d44b07294bfcfa5cfbd33a93dad32b6e3f6188f54d3f7`，与原版相同 |
| Scroll / Native Protocol / decoration / Ring Core | 全部 Rust |
| WorkspaceMotion | RustFiniteCurve，enabled=true，420ms；最终 active=false |
| 输出 | DP-1 3840×2160@60Hz / 150%，HDMI-A-1 2560×1440@60Hz / 100%，eDP-1 disabled；输出 JSON 前后相同 |
| KWin | 6.7.5 / Qt 6.11.2 / RTX 2060 / OpenGL EGL，PID 2050 不变 |
| 已安装 JS | 布局 `f14e826b60d3…`、动画 `66bda22ea31b…`，前后字节相同 |

部署前后 workspace、focus、columns、presentation、viewportAnchor 一致；之后受控 J/K 均只出现 DP-1 desktopChanged，往返后这五个字段仍全部恢复原值。测试时 `org.freedesktop.ScreenSaver.GetActive=true`、logind session 2 的 LockedHint=yes；两输出 framePresented 均为 0，无法测量这次动画、Ring paint 或 FPS。H/L / retarget 尝试没有活跃 Native arm，不列为通过；Wide 中途复验及 Ring off/on 在锁屏检查后未执行。保留失败采样，并同步重新应用相同 Clip 配置释放待呈现测试动画，最终 workspaceAnimationActive=false。未更改锁屏、电源、分辨率、scale、刷新率或主屏独立设置。

R6 已由用户确认验收通过；R7 不借此声称做过新的未锁屏视觉测试。重负载、热插拔、gesture / wrap 和 V3 完整 daily smoke / release gate 未在本轮执行，仍属于专门验收。原设计已归档，并保留 V3 daily smoke 的未完成项；没有将全项目 V3 release gate 标为通过。

部署后 KWin journal 的 TypeError、ReferenceError、SyntaxError、INVARIANT_FAIL、FAIL_SAFE、completion timeout、Rust panic、native fallback 计数全部 **0**；PID 不变。该观察区间和用户 R6 验收记录不能替代后续长期运行。

备份 / 审计 / raw capture：`/tmp/cc-niri-r7-live-20261006-ddolxcrr`，指针 `/tmp/cc-niri-r7-live-path`。旧 Clip `dac998ce…`、Ring `6e5d662d…` immutable 文件保留；旧 CLI、Bridge、kwinrc、工作区、before / deployed / final、J/K 采样、锁屏 / 日志证据和回滚脚本存入备份。

实机回滚到此前已验收 R6：

```sh
python3 /tmp/cc-niri-r7-live-20261006-ddolxcrr/rollback.py
```

脚本按既有 stop / 原子旧链接与 Bridge / CLI 恢复 / start 路径回退；保持 4K 60Hz、主屏独立与 420ms 配置。`/tmp` 可随重启清理，旧 immutable 插件保留在 `.local/lib/cc-niri`；需要长期保存时另存备份。回滚后不重新启用生产 C++ 默认。

## 2026-10-07 重新部署与最终用户验收

从 **c9a5cee1bb4b** 复用四个既有 standalone 构建树，先执行 `node tools/check.js --native`，Rust fmt / clippy / 30 单测、89 JS 回归、Bridge 16 CTest / 3 隔离 D-Bus、Clip 15 CTest、Ring 22 CTest、Plasmoid 构建和生产符号边界全部通过。随后执行既有 `./install.sh`，保存工作区状态、停止旧运行时、安装 immutable Native 插件、更新 Bridge / CLI / 两个 KPackage / Plasmoid，再启动 CC-Niri 与 Plasma 面板。

安装后在独立 DESTDIR 暂存相同构建的安装产物，逐一核对 Clip、Ring、Bridge、Plasmoid、CLI、布局和动画包的 SHA-256；全部一致。已安装 Bridge 与两个插件再次通过生产符号边界检查；Scroll / Native Protocol / decoration / Ring Core 运行状态均为 Rust，布局脚本与三个 CC Effect 已加载，Bridge 与 Plasma 面板 active。KWin PID **2050**、输出配置、主屏独立工作区和 **420ms** WorkspaceMotion 设置前后相同；DP-1 保持 **3840×2160@60Hz / 150%**。最终运行核验 UTC **2026-10-07T01:39:24.185321+00:00**，会话已解锁；部署后的日志无核心不变量错误、fail-safe、Rust panic 或崩溃记录。

本次 standalone 安装的 Clip SHA-256 为 `e4e5fce6f2b18a3705a91079ab35b8c0d489277a54e1b3d9200c16142eca1e05`，Ring 为 `aa7154bd4e1ff9f211034aa95693f2e5885486dfa19ddcb00a54c6961ec3b461`。两次部署分别采用 standalone 和 umbrella 构建，均通过 Rust 生产边界检查；Bridge、CLI 和两个 JS bundle 与首轮部署一致。备份与安装审计位于 `/tmp/cc-niri-redeploy-20261007-hfpv2f18`；完整门禁和安装日志分别为 `/tmp/cc-niri-redeploy-native-gate.log`、`/tmp/cc-niri-redeploy-install.log`。

重新部署后用户反馈“全部正常”，后续明确“已经成功切换了 rust完成”，并要求归档与提交。以此记录 R7 部署后的用户验收通过；Native Core 总设计与 R1 准备文档均已位于 `doc/done/`，文档索引已更新。此结论不扩大为逐项自动执行过 H/L / Wide / Ring 交互矩阵，也不新增帧率采样、热插拔、gesture / wrap 或长期压力验证；V3 daily smoke 的独立 Pending 项保持原状态。


## 2026-10-07 Core UX P3 宽度动画 Native 扩展

按用户确认的 niri resize / view motion 思路，扩展现有 Rust Scroll Runtime 与窄 FFI：可选 layoutTransition / oldRect、统一矩形插值、最后绘制姿态 retarget、configure 延迟下的 scale / translation、J/K 离开桌面的冻结 Rust 快照。C++ 只保留 paint DTO、KWin 生命周期与冻结 handle 的作用域；JS 布局 / 视口 / 焦点发布 authority 和 Ring 单 owner 保持。旧 Scroll Golden reference 不修改；不恢复 Legacy runtime、迁移开关或新动画时钟，不强制宽度循环恢复原 A｜B。完成后停车规则保持，避免仅绘制裁剪下跨输出实际输入区域不匹配。

最终 Rust fmt / clippy / **35 单测**、`node tools/check.js --native`（**93 JS**、Bridge 16 / 3 D-Bus、Clip 15、Ring 22、Plasmoid、生产符号边界）、Core Debug / Release 各 11 CTest、umbrella Debug 26 CTest、无测试两插件 / Bridge 与编译器拒绝路径全部通过。resize frame query 新路径验证零分配；没有新增每帧 JSON，未实测 FPS。

已使用完整 immutable 安装流程部署，产物 / 后端 / 原设置及布局核验通过；KWin PID 2050 和输出配置保持。会话锁屏，因此 R/F、H/L、J/K、Wide、Ring / Fullscreen 的本轮人工视觉与中间 paint 采集均待验收。详细行为、证据、限制和统一 ABI 回滚命令见 [Core UX P3 宽度动画记录](CORE_UX_P3_RESULTS.md)；当前备份 `/tmp/cc-niri-redeploy-20261007-fugy1fhg`，完整门禁 `/tmp/cc-niri-column-resize-native-gate-final.log`。这次动画修复的待验收状态不改写此前 R7 用户验收通过的历史结论。

## 2026-10-07 Core UX 部分可见扩展

在既有 resize graph 上启用 Scroll v2 可选 `clipPartial`：JS 以正面积交集决定 placement；Rust 校验、完成后的静态 owner、输入边界和已接受目标匹配；C++ 使用 KWin 公开输入 / 可见性 / geometry hooks，保留原生 surface、装饰、grab 与 focus action authority。原有 envelope / frozen C++ oracle 不变，FFI Plan 仍为 184 bytes，不修改 Spring、WorkspaceMotion 参数或宽度循环记忆。

最终 Rust fmt / clippy / **38 单测**、完整 Native 门禁（**94 JS**、Bridge 16 / 3 D-Bus、Clip 15、Ring 22、Plasmoid、生产符号边界）、Core Debug / Release 各 11 CTest、umbrella Debug 26 CTest、无测试生产构建和编译器拒绝路径通过。已部署，未锁屏实机通过左右部分窗口、主屏归属、副屏 7 点原生命中隔离、R/F / H/L / J/K / Wide paint 连续性、Ring owner 与重启；可见相邻最小间距 7.999853px，原有偏好恢复。人工视觉、真实点击 / 拖动 / touch / tablet / fullscreen / Overview 仍待验收，未新增动画输入逆变换，未测 FPS / GPU。

证据、限制与统一回滚见 [Core UX P3 部分可见记录](CORE_UX_P3_RESULTS.md)。当前备份 `/tmp/cc-niri-redeploy-20261007-jo2dv968`；门禁 `/tmp/cc-niri-partial-native-gate-final.log`。此扩展不改写此前 R7 用户验收历史，也不标记 P4–P8 已完成。


## 2026-10-07 延期分数列宽并撤下实验 Native 扩展

用户要求只保留 Meta+R 的 50% ↔ 100%，暂缓 third / twoThirds。与分数宽度一起增加但尚未通过用户验收的 Native resize / partial clip / input hooks 整体恢复到 `312b1f0` 已提交基线；R7 Rust Core、独立工作区有限曲线、Focus Ring 和既有平台适配保留，不恢复 C++ 生产实现。两个 Native 插件、Bridge 与两个 JS 包须一起重新部署，避免已安装实验 ABI 与基线混用。JS 负责迁移旧宽度 / 记忆 / anchor，并仅发布 half / Full。详见 [P3 最新记录](CORE_UX_P3_RESULTS.md)。本轮完整 Native 门禁通过：92 JS、30 Rust、Bridge 16 / Clip 15 / Ring 22 CTest、3 个隔离 D-Bus 和生产符号边界；Core Debug / Release 各 11、umbrella Debug 26 CTest，OFF 生产构建 / reference 隔离通过。fmt / clippy / locked tests 保持固定工具链。

完整安装后 Clip / Ring 恢复为已验收 standalone R7 的 `e4e5fce6…` / `aa7154bd…`，其余安装字节与构建 / 源码匹配；Core / protocol 后端仍全部 Rust。KWin PID 2050、4K60Hz / 150%、主屏独立、420ms 和副屏 / 边距设置保持。UTC 07:10:02–07:10:09 解锁实机状态核验通过 R/F、连续 6 次 R、H/L、J/K 离场双列未最小化、Ring owner 与重启恢复；两个 desktopChanged 只在 DP-1，测试后恢复原布局和焦点。Zed 实际输入与人工视觉仍待反馈，未注入文字或声称测过 FPS。门禁 / 安装 / 实机日志为 `/tmp/cc-niri-half-full-{native-gate-final,install,live}.log`，备份与整套 rollback 在 `/tmp/cc-niri-redeploy-20261007-g1h5a0nx`。

## 2026-10-07 Core UX Full 复用 Pair/Wide 动画

按用户要求将 half ↔ Full 接入既有 protocol-1 视觉事务、KWin Script Effect Scale / Translation / Opacity 与 Native clip；JS 保持 Full 布局 / 持久化 authority，复用旧邻窗完成停放、geometry ACK 和 workspace frozen pose / idle handoff。Adapter 只允许 solo target DTO 并转发 viewport；Rust Core、FFI、依赖与 frozen oracle 不变，不恢复实验 resize / partial clip / input hooks。现有 MotionController 对改 frame 尺寸 / anchor 的 retarget 进行采样矩形换算，沿用现有时钟与曲线。

完整门禁通过：93 JS、30 Rust、Bridge 16 / Clip 15 / Ring 22 CTest、3 隔离 D-Bus、Plasmoid 和生产符号边界；Core Debug / Release 各 11、umbrella Debug 26 CTest 与 Golden differential 通过。完整 immutable 安装与独立暂存哈希核验通过。UTC 07:38:30–07:38:51 解锁实机验证 R、连续反向、H/L、扩展中 J/K、Wide → Full、Fullscreen / Ring off-on、重启与原布局恢复；真实 KWin 日志确认两个 resize 方向的动画启动 / 完成和 retarget。主副屏、KWin PID 2050、原有 300ms PresentationDuration / 420ms WorkspaceMotion 设置保持。人工观感待反馈，未测 FPS；详见 [P3 最新记录](CORE_UX_P3_RESULTS.md)。证据 / half-Full 基线回滚在 `/tmp/cc-niri-redeploy-20261007-_82p7xq2`，门禁 `/tmp/cc-niri-full-animation-native-final.log`。


2026-10-07 用户反馈“已经通过”：记录本次 half / Full 复用旧动画的用户实机验收通过。该反馈不恢复 third / twoThirds 或部分可见实验，也不扩大为 P4–P8、单列实机、FPS / GPU 性能或长期压力验收通过。

## 2026-10-07 Core UX P4 工作区移动

新增 JS `WorkspaceMoveController` 与 Meta+Shift+J/K，通过现有 Switch / Transfer / Mount 和 Native Scroll disarm ACK barrier 实现受管列移动并跟随。列宽 / 恢复记忆 / Wide 偏好保留，目标先布局后聚焦；W8/W9 原生 ID 与保护策略沿用，不增加 Rust / C++ 布局或 focus authority，不修改 Native / FFI / CMake / 动画参数。

完整 Native 门禁通过：94 JS、30 Rust、fmt / clippy、Bridge 16 / Clip 15 / Ring 22 CTest（含 Golden differential）、3 隔离 D-Bus、Plasmoid 与生产符号边界。布局包已通过既有保存 / 停止 / 升级 / 启动路径部署；Native 产物、KWin PID 2050、输出与原有动画 / 边距设置保持。会话锁屏，实际移动 / 焦点 / Ring 和动态工作区视觉验收待进行；未测 FPS。此前 Full 动画用户验收结论保持。详见 [P4 记录](CORE_UX_P4_RESULTS.md)，日志 `/tmp/cc-niri-core-ux-p4-{native-gate,deploy}.log`，布局包回滚 `/tmp/cc-niri-redeploy-20261007-5chqvmpg/rollback-p4.py`。

随后用户反馈“实机验收通过 进入下一阶段”：P4 用户实机验收通过，进入 P5；上述锁屏 / 待反馈说明为首次部署历史，不扩大为 FPS / GPU 或长期压力测量通过。

## 2026-10-07 Core UX P5 数字直达

JS `VirtualDesktopTopology.byNumber` 与 `WorkspaceSwitchController.focusNumber` 将 Meta+1…9 接入既有 Switch / Mount / snapshot / 400ms 超时流程。命令发生时按当前 KDE 顺序解析，事务继续使用稳定 ID；当前 / 缺失目标 no-op，不新增工作区、不改变窗口 membership。Native / Rust / FFI / CMake / 动画参数不变。

完整 Native 门禁通过：95 JS、30 Rust、fmt / clippy、Bridge 16 / Clip 15 / Ring 22 CTest（含 Golden differential）、3 隔离 D-Bus、Plasmoid 与生产符号边界。布局包已部署，本机 Plasma 九个数字默认绑定已备份释放，Meta+1…9 的 CC-Niri owner 与持久配置已核对。

UTC 11:52:06–11:52:27 解锁自动实机核验通过非相邻直达、空目标、无效 / 当前目标不发布、连续数字切换、Scroll 中断、Full / Wide 实际 geometry / Ring owner、重启与原布局 / 焦点恢复；主副屏、窗口 membership、Native 安装字节、KWin PID 2050、边距与原动画设置保持。用户视觉反馈仍待，未测 FPS。用户所报闪退的具体组件待明确；检查未发现 KWin 重启或同期用户日志中的崩溃 / 脚本错误，近 30 分钟无 coredump 记录。详见 [P5 记录](CORE_UX_P5_RESULTS.md)，日志 `/tmp/cc-niri-core-ux-p5-{native-gate,deploy,live}.log`，备份与数字绑定回滚 `/tmp/cc-niri-redeploy-20261007-290skrao/rollback-p5.py`。

## Full / half 部分可见窗口修复（2026-10-07）

修复 Full A + half B 聚焦 B 后，A 被当作 outgoing 并在 Spring 完成后停放的问题。JS 仍拥有布局 / placement；可选严格布尔 Scroll v2 `clipPartial` 由 Rust 校验交集、管理静态 clip owner 和输入越界 predicate。沿用原 Spring、retarget 与半宽 / Full legacy Scale / Translation，不恢复 third / twoThirds 或 resize graph。C++ 只使用平台 hit testing / visibility refs / 生命周期与工作区渲染钩子，冻结的源 Rust handle 在 compositor idle 退休。

本轮 Rust fmt / clippy / 31 单测，完整 Native 门禁（96 JS、Bridge 16 / Clip 15 / Ring 22 CTest、3 隔离 D-Bus、Plasmoid 和生产边界）、Core Debug / Release 各 11、umbrella Debug 26 CTest 与 Golden differential 均通过；无测试生产两插件 / Bridge 构建没有 reference target 或旧 policy 符号。部分 clip 完成后没有 polling / watchdog / motion repaint 循环，输入 predicate 热路径零分配。FFI Plan 为 184 bytes，配套部署所有 ABI 消费者。安装 / 实机状态与限制见 [P3 最新记录](CORE_UX_P3_RESULTS.md)，备份与回滚在 `/tmp/cc-niri-redeploy-20261007-l7rfyqhz`；不更改参数或依赖，不声明 FPS / GPU 性能提升。

最终配套部署与独立安装字节核验通过。解锁实机核验左右 Full / half、4秒静置、快速 H/L、J/K、R、Wide、Fullscreen、Ring off-on、重启与 12 点副屏原生命中隔离通过，验证前状态恢复；KWin PID 2050 与原输出 / 动画设置保持。用户视觉、真实点击 / 拖动 / touch / tablet 和长期压力仍待反馈；未测 FPS。退出完成通知采用独立去重编号，并测试真实 continuing target 的完成回调，避免进入 / 退出计数重叠丢失通知。

## 双 Full 缩宽的异步提交焦点保护（2026-10-07）

针对 A / B Full 后 A 按 R 变 half 却跳到 B，JS ACK commit 继续原 LayoutTransaction epoch，保护恢复邻窗过程的同步 activation，保留提交前实际焦点，并沿用已有显式延迟激活流程。左右组合的回归在修复前失败、修复后通过；过期 / 嵌套 / 异常 ACK、窗口 UUID、下一次 R 与后续主动激活均覆盖。Rust、C++、FFI 与动画参数没有本轮改动，不引入第二套 authority 或时钟。

完整 Native 门禁 96 JS / 31 Rust、fmt / locked clippy、Bridge 16 / Clip 15 / Ring 22、3 个隔离 D-Bus 与生产边界通过；Core Debug / Release 各 11、umbrella Debug 26 与 Golden differential 通过。布局包部署与安装字节 / 原状态核验通过，其余 Native 产物、KWin PID 2050、输出和设置保持。本轮会话息屏后锁屏，实际 R 的动画完成 / 视觉验收仍待用户解锁复验，不沿用上一轮通过结论；未测性能。

详细范围、证据、限制与仅布局包回滚见 [P3 最新记录](CORE_UX_P3_RESULTS.md)。备份 `/tmp/cc-niri-redeploy-20261007-1afevacl`，门禁 `/tmp/cc-niri-full-full-focus-native.log`；本轮未提交 Git。

## Full 邻窗的静态 clip 与旧动画交接（2026-10-08）

上一轮焦点保护已获用户确认。本轮修复邻窗等目标缩宽完成后直接恢复、导致闪现的问题：JS 在原 Pair/Wide epoch 内通过既有 Native ACK gate 先装静态 clip，再让 Full 邻窗复用原 Translation/Opacity / OutCubic 时间线；目标 Wayland 尺寸 ACK、连续反向、焦点 guard 与工作区冻结均沿用既有机制。Wide 返回计划补齐 safe viewport，普通 Scroll 仍由 Rust Spring 驱动。

C++ 仅缓存对应 handle 的绘制来源，宽度交接期间使用 Rust viewport / input predicate、保留 Script paint transform 和尺寸 ACK 前的真实原画面，避免重复 translation；冻结 departure 保留同一来源到 compositor idle。没有 Rust 算法、FFI / ABI、动画参数、额外时钟、每帧 JSON 或第二套布局 / 焦点 authority。本轮 Native 单测增加静态 clip 的两侧负坐标、真实待 ACK frame、零 motion 与取消后的重装，Golden Baseline 未修改。

最终 JS 96 项、完整 Native 门禁（fmt / locked clippy / 31 Rust、Bridge 16 / Clip 15 / Ring 22、3 隔离 D-Bus、Plasmoid / 生产边界）、Core Debug / Release 各 11、umbrella Debug 26 / Golden differential 通过。配套 Native 安装和最终布局包更新的字节 / 后端核验通过。最终真正双窗实机复验通过左右 R、H/L、J/K、Wide、Fullscreen、Ring off/on、重启及副屏输入隔离，日志记录实际共享时间线的 Full incoming 回调；临时窗口成员关系与验证开始时的布局、焦点、拓扑 / 设置恢复，KWin PID 2050 和输出保持。人工视觉仍待用户反馈，未测 FPS / GPU 或长期压力。

范围、失败夹具与最终证据见 [P3 本轮记录](CORE_UX_P3_RESULTS.md)。完整回滚版本 `/tmp/cc-niri-redeploy-20261007-v5l1gbrl/rollback.py`；最终实机证据 `/tmp/cc-niri-redeploy-20261007-pjesw1nn/animation-isolated-live`，门禁 `/tmp/cc-niri-full-neighbor-animation-native-final.log`、最终 JS `/tmp/cc-niri-full-neighbor-animation-js-final.log`；本轮未提交 Git。

## Full 邻窗外推时的裁剪连续性（2026-10-08）

针对 half A / Full B 在 A 按 R 时 B 偶尔闪到右侧副屏，JS 将旧 Native clip 的撤销推迟到 Pair/Wide publish ACK，保留并最终退休所有在途 epoch。C++ 只管理短暂的冻结 Rust handle 与已发布窗口 membership，继续调用 Rust projection / viewport / input predicate，保留原绘制来源；新的 Native / Script clip、取消、context 变化与窗口生命周期负责释放。冻结 handle 不 advance；普通 Scroll Spring、原宽度动画、焦点 authority、FFI / ABI、协议和参数保持，不增加 Core policy、时钟或每帧 JSON。

完整门禁通过：96 JS、fmt / locked clippy / 31 Rust、Bridge 16 / Clip 15 / Ring 22 CTest、3 隔离 D-Bus、Plasmoid / 生产边界；Core Debug / Release 各 11、umbrella Debug 26 CTest / Golden differential 通过。延迟 ACK 回归在旧撤销顺序下失败；新增 Native 契约验证冻结 sample、实际 Full frame 的 viewport / 输入、过期回调和 handle 释放。首次沙箱 D-Bus socket 失败后的最终完整重跑通过。

已配套部署并核对安装字节。最终解锁实机 UTC 06:23:10–06:24:00 通过左右 Full / half、H/L、J/K、双向与连续 12 次 R、Wide、Fullscreen、Ring off/on、重启和副屏 12 点输入隔离，记录 14 次 clip handoff，最终临时 handle 已退休。测试前窗口 membership、布局、主屏记忆焦点与副屏实际焦点、原生工作区拓扑、输出和设置恢复；KWin PID 2050 保持。人工副屏短闪视觉待用户复验，未测 FPS / GPU 或长期压力。

范围与早期夹具准备失败见 [P3 本轮记录](CORE_UX_P3_RESULTS.md)。门禁 `/tmp/cc-niri-full-outgoing-clip-native-final.log`；最终实机 `/tmp/cc-niri-redeploy-20261007-ov6joucv/outgoing-clip-live-verified`；完整回滚 `/tmp/cc-niri-redeploy-20261007-ov6joucv/rollback.py` 保留当前布局 / KDE 设置。本轮未提交 Git。

2026-10-08 用户反馈“已经完成”：本次 Full 邻窗外推副屏短闪修复的用户实机验收通过；上述视觉待复验说明保留为部署历史，不代表 P6–P8、延期分数列宽或性能测量已完成。

## 2026-10-08 Core UX P6 数字直接移动

JS `WorkspaceMoveController.moveNumber` 将 Meta+Ctrl+1…9 接入 P4 `moveTo`，复用 P5 当前 KDE 编号查询；事务继续使用稳定 ID、实际活动主屏 Column、原 ACK / Transfer / Mount / focus / 400ms 超时与 W8/W9 规则。当前 / 缺失目标 no-op，保留列宽、恢复宽度与 Wide 偏好。Rust / C++ / FFI / CMake / Native 协议与动画参数没有本轮改动，不增加每帧工作。

完整门禁通过：97 JS、fmt / locked clippy / 31 Rust、Bridge 16 / Clip 15 / Ring 22 CTest（含 Golden differential）、3 隔离 D-Bus、Plasmoid 与生产边界。未重跑独立 Core Debug / Release、umbrella 或 configure 编译器拒绝路径。按 save-state / stop / KPackage upgrade / start 部署布局包，九键无冲突，实时 owner 均核对为对应 CC-Niri 动作；Native 安装字节、KWin PID 2050、输出与用户设置保持。

UTC 06:53:19–06:53:45 自动实机状态核验通过 half / Full / Wide 移动与跟随、无效 / 当前目标、滚动中断、Ring、Full 移动后重启 / 返回。副屏属性保持，原窗口归属、顺序、偏好、工作区拓扑及主屏记忆 / 实际全局焦点恢复；无新增 invariant / fail-safe / JS 错误 / completion timeout / Rust panic。用户视觉验收与长期 smoke 待反馈；未测 FPS / GPU。空目标、非相邻目标、动态拓扑及九键上限由生产包回归覆盖，本轮实机不创建 / 删除用户桌面。

范围、限制与回滚见 [P6 记录](CORE_UX_P6_RESULTS.md)。部署 / 实机日志 `/tmp/cc-niri-core-ux-p6-{deploy,live}.log`；备份与仅 P6 回滚 `/tmp/cc-niri-redeploy-20261007-lccfe21b/rollback-p6.py` 保留当前持久布局与其他 KDE 设置。本轮未提交 Git；P7 / P8 和分数列宽延期保持。

提交整理：P3 Full 修复与 P4–P6 的共享布局 / 工作区事务作为一组 Core 基线，P7 / P8 独立提交。不伪造历史提交；分组 Core 生成包与 97 JS 回归再次通过，当前最终版本 Native 门禁与实机结果见后续阶段记录。
