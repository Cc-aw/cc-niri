# Rust Native R6 统一 Native Protocol 实现与验收记录

日期：2026-10-05；2026-10-06 更新。状态：共享类型、协议 policy、C ABI 与生产选择已实现；自动门禁与独立构建全部通过，独立 R6 构建已部署。用户反馈一般功能正常，但发现 Pair→Wide 动画中按 J 的旧工作区邻窗重叠；第一版提前 parking 消除了重叠，但仍跳到展开终点。[第二版交接修复](WORKSPACE_WIDE_DEPARTURE_RESULTS.md)保留中途画面，JS / Effect / Clip 已配套部署，用户确认“成功修复”。随后报告双屏联动及感觉帧率不足；已启用 KWin 原生主屏独立工作区并测量普通 J/K，见 [输出与帧率记录](WORKSPACE_OUTPUT_FRAME_RESULTS.md)。源码生产开关默认 OFF，保留 C++ reference 与 R5 immutable 插件。

## 范围与边界

`native_protocol.rs` 集中定义 `Epoch`、`Generation`、`SessionId`、`WorkspaceId`、`OutputId`、`WindowName`、`WindowId`、`Context`、`Rect`、Scroll wire DTO、typed status 与 `NativeError`。UTF-16 保留 Qt 字符串单位；wire window name 与 per-handle numeric token 分开，不把 Scroll 可接受的普通 canonical name 收窄为 UUID。Ring 仍要求非 null UUID，Adapter 只用 QUuid 完成格式转换，Core 检查 canonical identity / 去重 / membership。

Untrusted Scroll 数字在 wire DTO 中保留原始类型失败值，只有完整检查后的 `ValidatedScrollPlan` 可以进入 sequence。JSON epoch / generation / issuedAt 仍限制为 0–9007199254740991 的精确整数；Native Motion 使用共享 Epoch，同时保留完整非负 i64 范围及 -1 未开始 sentinel。Spring 参数、Motion 时钟 / retarget、Scroll continuing / incoming / outgoing、projection 和 completion 行为不变。

`ScrollSequence` 由 Rust runtime 与新 Scroll observer 共用：Dock State 建立 authority，同 session 不允许 generation 后退；workspace / output 切换保留 epoch barrier，新 session 重置；同 epoch 只接受相同完整 envelope fingerprint。Runtime 在 geometry / clock 校验之前消费接受的 epoch，失败 arm 不释放该序号；重复消息仍要求 runtime active。Observer 的 protocol 1 reset 与 Runtime 的 fail-closed reset 保留各自既有返回约定。

`focus_ring_context.rs` 迁移原 Ring eligibility context：128 UTF-16 单位 metadata 上限、256 个 window、disabled-empty、generation、idempotent publication、retired session 与 256 tombstone cap。无效 schema / UUID / generation 清空 enabled / windows，同时保留 authority metadata 与 tombstone；stale、same-generation conflict、retired-session 消息拒绝但保留当前 eligibility。Rust 根据 Native 传入的候选 flags、opacity、workspace / output / membership 决定是否 permitted，KWin 继续观察真实焦点并决定唯一 owner。

Scroll v2 与独立 Ring v1 的 **JS schema、版本、D-Bus 方法与 authority 都未合并**。R6 协议迁移没有修改 Bridge / JS；后续实机反馈中的 JS 工作区取消缺陷单独修复。Native 仅新增只读 `nativeProtocolBackend` 状态字段。类型共享不建立第二个 focus authority、Ring 时钟、layout 状态或 global session。C++ 保留 JSON / QUuid 解码、KWin platform preflight / workspace barrier、实际 focus / visibility 观察、QObject / QPointer、Scene Item、renderer 与 hooks。

## FFI 与构建

`ffi_protocol_views.rs` 共用 UTF-16 / byte view、Rect 与 fixed result，已有 Spring / Motion / Scroll / Ring C ABI 保持兼容。新增 sequence / eligibility 的 unique owned handle：eligibility clone 独立，borrowed 输入仅调用内有效，返回 text view 在 mutation / destroy 前有效；null handle / invalid buffer 返回 ABI status。新的 `CcNiriProtocolResult` 区分 transport status 与 semantic NativeError，拒绝仍保留原布尔返回行为。dev / release panic=abort，未新增 dependency、线程、锁或 async。

C ABI size：ProtocolResult=16、EligibilitySnapshot=112、Candidate=64、EligibilityStatus=32 bytes；Rust 与 C++ 静态检查一致。Core 和 FFI 各 1,000 次 Ring permission / query 分配计数为 **0**；原 Scroll 与 Ring geometry 热路径零分配测试保留。Observer registry 在每次 plan 校验 / observe 后释放临时 window names，1,000 条不同名称的拒绝消息测试不累积 token；Runtime 的稳定 token / remove 生命周期不变。JSON、UUID、QString snapshot 重建只发生在 publication 入口。

`NativeProtocolDto.h` 是 observer 与 runtime 的同一 Qt→C ABI 转换路径。`RustFocusRingContext` 的 public Qt fields 是 Rust status 的只读镜像，用于 Effect / 测试读取；不在 Adapter 再实现 sequence、membership 或 fail-closed policy。

`CC_NIRI_USE_RUST_NATIVE_PROTOCOL` 默认 **OFF**，通过共享 `NativeProtocol.cmake` 选择生产 Scroll observer / validator 与 Ring eligibility。Ring Context / QObject Controller 测试跟随同一 backend；可以独立 ON，也可与 Spring / Motion / Scroll / Ring 全 ON，R3 test override 保留。CI 新增 Protocol-only 与全 Rust ON 两行，远端 Actions 未运行。根 / native AGENTS 已补充边界与必跑组合。

## 自动门禁

工具链：Rust / Cargo **1.99.0**、`/usr/bin/g++` GNU **16.2.1**。

| 验证 | 结果 |
| --- | --- |
| Rust fmt / clippy `-D warnings` / test --locked | 通过，26 项单元测试 |
| Debug / Release Core CMake + CTest | 各 12 项通过；原 math / Scroll / Ring 差分与 compiler policy 保留 |
| 全部生产开关 / R3 override OFF，node tools/check.js --native | 85 项 JS、Bridge 5 项 CTest / 3 项隔离 D-Bus、Clip 16 项 CTest、Ring 23 项 CTest、Plasmoid 构建全部通过 |
| 仅 Native Protocol ON | `build/native-r6-independent` 27 项 CTest 通过 |
| 所有 Rust 生产开关 ON，R3 override OFF | `build/native-r6-on` 27 项 CTest 通过 |
| R1–R5 原有组合，Native Protocol OFF | 8 个独立构建各 27 项 CTest 通过，见下表 |

| 构建 | Spring / Motion / Scroll / Ring / R3 override |
| --- | --- |
| native-r1-on | ON / OFF / OFF / OFF / OFF |
| native-r6-motion-only | OFF / ON / OFF / OFF / OFF |
| native-r2-on | ON / ON / OFF / OFF / OFF |
| native-r3-tests | OFF / OFF / OFF / OFF / ON |
| native-r4-independent | OFF / OFF / ON / OFF / OFF |
| native-r4-on | ON / ON / ON / OFF / OFF |
| native-r5-independent | OFF / OFF / OFF / ON / OFF |
| native-r5-on | ON / ON / ON / ON / OFF |

日志位于 `/tmp/cc-niri-r6-full-gate.log`、`/tmp/cc-niri-r6-{debug,release,on,independent}-ctest.log`、`/tmp/cc-niri-r6-native-*.log`。纯 Core 差分始终比较保留的 C++ reference，不依赖生产开关；原 Scroll **347 histories / 75,041 actions / 21,289,290 projections，maxDelta=0**，Ring **31,402 cases / 2,628,077 numeric values，maxDelta=0**，Spring / Motion 差分也通过。原 Ring Phase 1–6 的 Scene / paint / clip / retarget / Presentation / HiDPI tests 全部保留。

新增 Native Protocol differential 使用 seed **4846803700800901686**，比较接收布尔值、完整 context / membership / tombstone 状态、Native permission 与 Scroll validation / sequence disposition：**60,276 actions、673,596 permission queries、30,000 Scroll validations**，无差异。包含 invalid / duplicate / stale / conflict / reload / stop、UTF-16 / UUID、128/129 单位 metadata、256/257 membership、tombstone cap 和最大安全整数。原 Ring context contract 与实际 JS→QV4→QObject 2,000 个窗口关闭 / 销毁测试接入 Rust backend。

首次完整门禁暴露了新增 differential 的 implicit QString conversion 在 standalone KDE 严格编译选项下失败；已改为显式 Qt literal 与 QStringBuilder materialization，严格 standalone target 编译和差分通过，完整门禁重跑通过。该问题位于新测试 harness。

## 性能

Release / GCC -O2 的临时 microbenchmark 位于 `/tmp/cc-niri-r6-benchmark.cpp`；7 轮中位数，permission 每轮 200,000 次、单 UUID duplicate publication 每轮 5,000 次。其他 Native matrix 构建结束后测得：

| 路径 | C++ reference | Rust + Qt / FFI |
| --- | --- | --- |
| permits | 28.36ns | 53.50ns |
| duplicate update（单 UUID，含 JSON / QUuid） | 3539.14ns | 3643.78ns |

单个 permission 查询增加约 25ns，重复 publication 增加约 0.10μs；两者均为 local microbenchmark。计时包含 Qt adapter / FFI；message parsing 只在 publication 发生，不能据此判断 compositor 帧时间。实机帧时间与长期稳定性未测量。

## 独立构建与实机

```sh
cmake -S native -B build/native-r6-on -G Ninja \
  -DCMAKE_CXX_COMPILER=/usr/bin/g++ -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_INSTALL_PREFIX="$HOME/.local" -DKDE_INSTALL_PLUGINDIR=lib64/qt6/plugins \
  -DCC_NIRI_USE_RUST_SPRING=ON -DCC_NIRI_USE_RUST_VIEWPORT_MOTION=ON \
  -DCC_NIRI_USE_RUST_SCROLL_RUNTIME=ON -DCC_NIRI_USE_RUST_FOCUS_RING_CORE=ON \
  -DCC_NIRI_USE_RUST_NATIVE_PROTOCOL=ON -DCC_NIRI_TEST_RUST_SCROLL_RUNTIME=OFF
cmake --build build/native-r6-on
ctest --test-dir build/native-r6-on --output-on-failure
```

命令仅构建和测试。独立 R6 构建已通过既有 save-state / stop / immutable install / start 路径部署。

- Clip canonical：`/home/cc/.local/lib/cc-niri/viewport-clip/c29510b2e1e564dd9fe1b1de339e6d0a5bc67ddce7813c49281e9415a3785ecb/cc-niri-viewport-clip.so`。
- Ring canonical：`/home/cc/.local/lib/cc-niri/focus-ring/6e5d662da7ae5e29370cd4a8505fef25b3987ba22062eef0b4fcf634f43a7164/cc-niri-focus-ring.so`。
- SHA-256 为各自目录名；`cc_niri_scroll_sequence_plan` / `cc_niri_eligibility_permits` 符号、两个 Effect loaded endpoint 与运行中 backend 已核验。
- UTC 部署起点：`2026-10-05T13:43:40.398810+00:00`；KWin PID 前后均为 **2083**，未重启 compositor。
- 备份：`/tmp/cc-niri-r6-live-20261005-5afhd68a`；指针 `/tmp/cc-niri-r6-live-path`。包含 kwinrc、workspaces.json、Bridge / Scroll / Ring before 与 after、hash / manifest、日志、state comparison 与回滚脚本。
- 已安装 Bridge / JS canonical 与 SHA-256 前后相同。workspaceId / index、output、列数（2）、focusedUuid 与 viewportAnchor 保持一致；generation / session 随既有 stop/start 重新建立，Scroll 与 Ring 仍为独立 session。
- 沿用受保护进程 maps 的已知限制，通过 backend / immutable hashes / symbols / loaded endpoints 核验；不宣称直接读取 KWin process maps。

UTC `2026-10-05T13:44:24.564587+00:00` 初始采集：两个 **nativeProtocolBackend=Rust**，Scroll Runtime / decoration geometry / Ring Core 也均为 Rust。Ring eligibilityEnabled=true、eligibleCount=2、generation=4，说明真实发布路径已接收；Scroll epoch=-1，Ring active=false / drawCount=0，尚不能据此证明 Scroll arm 或 Ring paint 验收。**18 行日志**中的 native fallback、INVARIANT_FAIL、FAIL_SAFE、ReferenceError、TypeError、completion timeout、Rust panic 七项计数均为 0。采集脚本 `/tmp/cc-niri-r6-live-capture.py`。

UTC `2026-10-05T13:46:36.382250+00:00` 再次采集：KWin PID 仍为 **2083**，两套 session 与全部 Rust backend 保持一致；Ring generation=13、**drawCount=1,210**，已有真实 paint 经过本阶段 eligibility 路径。Scroll epoch 仍为 -1，不能将此记录为滚动验收。**101 行日志**七项异常计数仍为 0；保存为 `load-check2-state.json`、`load-check2-bridge.json`、`load-check2-kwin.log`。实际绘制计数不等同于人工视觉通过。

UTC `2026-10-05T13:59:08.624734+00:00` 用户反馈后采集：KWin PID 仍为 **2083**，全部 Rust backend 保持一致；Scroll epoch=72，Ring generation=95 / drawCount=6,744，**887 行日志**七项异常仍为 0。记录保存为 `feedback-capture-latest.json`、`feedback-bridge-state-latest.json`、`feedback-kwin-live-latest.log`。用户一般功能反馈正常，但 Pair→Wide 动画中按 J 会露出旧邻窗重叠；不能将日志无异常视为视觉通过。

2026-10-05 当时为 eDP-1 内屏，[工作区离开修复](WORKSPACE_WIDE_DEPARTURE_RESULTS.md)第二版已更新布局 / 动画脚本及 Clip 裁剪生命周期。UTC `2026-10-05T14:33:28.148112+00:00` 部署，Clip canonical 为 `4223816d…`，Ring 仍为本节最初记录的 `6e5d662d…`；旧 Clip `c29510b2…` 保留可回滚。运行中 `workspaceDepartureVisual=freeze-wide-until-compositor-idle` 与全部 Rust backend 已核验，KWin PID 为 2083。完整门禁重跑通过（87 个 JS 回归），用户于 2026-10-06 确认本问题修复成功。

2026-10-06 当前接入 DP-1（4K、150% 缩放）与 HDMI-A-1（1440p、100% 缩放），均为 60Hz。独立工作区设置启用后，六次普通 J/K 只改变 DP-1；实际呈现约 60fps，无超过 1.5 个刷新周期的间隔。已部署诊断 / 热路径清理 Clip `59630331…`，布局 / 动画脚本与 Rust Core 保持原版；KWin PID 前后均为 2044。详情、门禁与回滚见 [输出与帧率记录](WORKSPACE_OUTPUT_FRAME_RESULTS.md)。本次采样不覆盖全部 mixed DPI 动画、重负载与长期稳定性。

随后用户明确要求保留 4K 60Hz 主屏并优化动画，已部署独立 Rust WorkspaceMotion / KWin Adapter 的 420ms 有限曲线，Clip `dac998ce…`；R6 五个 Rust 后端和两套 JS authority 保持不变。收尾约 0.89s → 0.42s，独立六次普通和三次 130ms 反向均约 60fps、无超过 25ms 的间隔。首次与 CPU 基准重叠的采样出现一个 33ms 间隔，原数据与限制保留。Rust 30 单测、89 JS 完整 Native 门禁、Debug / Release 各 13 CTest、10 组阶段 Native 各 28 CTest 通过。实际配置应用与唯一 owner 已验证，人工 Wide / 流畅度复验待用户反馈，见 [4K 工作区动画记录](WORKSPACE_ANIMATION_RESULTS.md)。本优化独立于 R7，不改变源码迁移开关默认值。

恢复 R5 两个 immutable 插件：

```sh
python3 /tmp/cc-niri-r6-live-20261005-5afhd68a/rollback.py
```

脚本先 stop 恢复 parked windows，原子恢复 R5 Clip `2c3dcf07…` 与 Ring `6625ca83…` 发现链接，再 start；更早版本也保留。`/tmp` 备份可能随重启清理，canonical library 保留在 `.local/lib/cc-niri`。源码回退 observer / Ring eligibility 使用 `CC_NIRI_USE_RUST_NATIVE_PROTOCOL=OFF`，并同时重建两个插件。

本阶段收到一般功能正常和第二版工作区离开修复成功的反馈；当前待人工复验主屏独立切换与流畅度。原验收范围为 H/L、连续 / 反向 retarget、J/K workspace switch、Pair/Wide、Ring owner switch / close / fullscreen exit、Ring off/on 与 stop/start；已有帧时间采样不代替完整交互验收。

本阶段没有创建 commit；用户的 Core UX 设计未修改。不切换源码默认 ON，不删除 Legacy C++ Core；R7 的默认 Rust、完整门禁、实机与稳定日常使用条件尚未全部满足。
