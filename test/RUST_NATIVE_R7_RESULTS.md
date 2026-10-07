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
