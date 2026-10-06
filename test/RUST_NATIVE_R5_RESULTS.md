# Rust Native R5 Focus Ring Core 实现与验收记录

日期：2026-10-05。状态：Core、C ABI、生产接入、差分及自动门禁完成；独立 R5 构建部署后，用户反馈“功能正常”，内屏功能 / 视觉验收通过。HiDPI / fractional scale / mixed DPI 实机、实际帧时间与长期稳定性待验证。源码生产开关仍默认 OFF，保留 C++ 数值 baseline 与 R4 回滚插件。

## 范围与边界

Rust `focus_ring.rs` 负责固定大小的数值状态与计算：

- 圆角配置归一化、override / round-corners / native source、frame 尺寸限幅与四个角的半径。
- Attach geometry 检查、数值 paint snapshot、两个 opacity 因子的有效性。快照冻结当前 inner bounds / thickness / radii / opacity，不持有 Window 或 Item。
- 从平台已组合的 matrix 解析 axis scale，保持 shear / rotation / reflection 的原 Native 路径；计算 Presentation 下的固定 device stroke、椭圆圆角、body 和 damage bounds。
- 八个描边 patch 的 layout、像素取整、平移 / counter-scale、可见性与角纹理尺寸，保留 1024 device-pixel 限制。
- Decoration padding 的有限值 / 0–128 限幅和 device ceil，供 Clip / Ring 共同使用。

C++ 保留唯一 owner 的 KWin 观察、eligibility 接收路径、QPointer / scene attachment 生命周期、WindowPaintData / QTransform 的平台组合、Scene Item、QPainterPath / rasterization、renderer、paint hooks、damage 提交和 Region 的平台映射 / 相交。`FocusRingContext` 与 JS schema 本阶段未改，Native Protocol 统一留给 R6。

Retarget 仍由 Scroll 提供窗口当帧变换。Rust 消费冻结的数值 snapshot；C++ 保存同一 paint 调用的 position / matrix / data 以及弱 attachment，不引入 Ring clock、previous visual frame 或第二套 focus authority。嵌套 paint、owner 切换、off/on、destroyed attachment 的既有生命周期规则保留。3px / #7FC8FF、独立 sRGB material、一次 item opacity / effect opacity、shadow exclusion 和原 viewport occlusion 规则不变。

`FocusRingCore.cpp` 提取迁移前的纯数值实现作为 C++ golden baseline；`FocusRingCoreBackend.h` 仅选择 reference / Rust C ABI 并转换数值。Rust min/max 显式保留 C++ 的 NaN / signed-zero 顺序语义，使用 round ties away from zero；KWin 的 float matrix 由 Adapter 原样转为 double DTO，Core 不依赖 Qt。

## FFI 与构建

新增 `CC_NIRI_USE_RUST_FOCUS_RING_CORE`，默认 **OFF**。统一与两个 standalone 入口复用原 Cargo/CMake 路径。两个生产插件以及原 Ring Phase 1–6 中的 corner / item / paint / clip / visual-transform / retarget / presentation / HiDPI 测试使用同一开关。R5 构建关闭 R3 测试覆盖，生产选择直接进入组合测试。

C ABI 全部为栈上固定 DTO 和借用指针，无 handle、heap、线程或锁；无返回 buffer 需释放。null 输入返回 status=1，语义拒绝为 valid=0 / status=0；padding 与 geometry bool 等直接数值入口遵守头文件契约。纹理布局在整数转换前拒绝非有限 / 负 extents，保留取整为零的 body / stroke；合法生产行为与 baseline 相同。平台 matrix 组合仍先要求有限正 device scale。

Core Rect 增加 `repr(C)` 以供 Ring DTO 使用；Scroll FFI 的既有 DTO schema 不变。ABI size：Frame=88、Input=224、Metrics=128、MetricsResult=136、Patch=112、Layout=904 bytes。Core 和 C ABI 各 1,000 次 capture / metrics / layout / damage 热路径测试的分配计数为 **0**。dev / release 保持 panic=abort，Cargo.lock 无依赖变更。

生产状态诊断：Ring `coreBackend`；Clip `decorationGeometryBackend`，以及保留的 `scrollRuntimeBackend`。新增字段只读，不影响 JS 完成协议。CI 增加 Ring 独立 ON 与全 Rust ON 两行；远端 Actions 未运行。根 / native AGENTS 已补充组合验证要求。

## 自动门禁

工具链：Rust / Cargo **1.99.0**、`/usr/bin/g++` GNU **16.2.1**。

| 验证 | 结果 |
| --- | --- |
| Rust fmt / clippy `-D warnings` / test --locked | 通过，21 项单元测试 |
| Debug / Release Core CMake + CTest | 各 10 项通过；新增 Ring differential，原 Spring / Motion / Scroll 与 GCC 拒绝路径保留 |
| 全部开关 OFF，node tools/check.js --native | 85 项 JS、Bridge 5 项 CTest / 3 项隔离 D-Bus、Clip 14 项 CTest、Ring 21 项 CTest、Plasmoid 构建全部通过 |
| Spring / Motion / Scroll / Ring ON，测试覆盖 OFF | `build/native-r5-on` 25 项 CTest 通过 |
| 仅 Ring ON，其余 OFF | `build/native-r5-independent` 25 项 CTest 通过 |
| Spring / Motion / Scroll ON，Ring / 测试覆盖 OFF | `build/native-r4-on` 25 项 CTest 通过，迁移后的 C++ baseline 路径回归 |
| git diff --check / --cached --check | 通过 |

已核验生成的编译配置：Clip / Ring / Ring tests 的 Core 宏一致；Ring 独立 ON 时 Scroll 宏为 0；全 Rust ON 的 Scroll / Ring 组合测试不使用测试覆盖宏选择 Rust。

Ring differential 固定 seed `0x43434e4952495235`（4846803700800901685）：**31,402 组输入、17,601 组接受的 layout、2,628,077 次数值比较**，Debug / Release 最大差均为 **0**。有效性、native / compensated、corner source、texture dimensions / visibility 精确比较；数值容差 `1e-10 + 1e-12 * scale`，非有限 fixture 单独比较同类结果。失败输出 seed / case / device scale / size / matrix。

覆盖 1 / 1.25 / 1.5 / 1.75 / 2 / 3 / 4 scales、尺寸与 fractional positions、非对称 radius、native float scale 边界、matrix 各元素 NaN / Inf、shear / projective / reflection、透明及非法 opacity、override / round-corners / native config 和 30,000 组随机 Presentation 输入。原 Scroll differential 仍为 347 组 / 21,289,290 次 projection，最大差为 0。

既有 Ring 验证包括：144 个窗口 / border transform samples；1,468 个 retarget paint samples / 48 个 epoch arms；260 个 Presentation samples（196 个 scaled）；240 个 HiDPI samples。KWin float commit matrix 差保持既有容差内，visual-transform 最大 0.00012207，retarget 最大 0.000244141。检查静态 / animated inner edge、厚度、角 / 边接缝、原 damage / occlusion、texture cache、frozen pose / shape / opacity、关闭 / owner / workspace / stale attachment 等。

日志：`/tmp/cc-niri-r5-rust.log`、`/tmp/cc-niri-r5-debug-final.log`、`/tmp/cc-niri-r5-release-final.log`、`/tmp/cc-niri-r5-off-check.log`、`/tmp/cc-niri-r5-on.log`、`/tmp/cc-niri-r5-independent.log`、`/tmp/cc-niri-r5-r4-regression.log`。既有 Scroll differential 的 misleading-indentation 与 WorkspaceClipBarrierTest 的 missing-field-initializers warning 不导致门禁失败。

## 微基准与限制

`/tmp/cc-niri-r5-benchmark.cpp`：GCC -O2 / Rust release，同一 932×701、scale=1.5 的 Presentation 输入，7 轮中位数，每轮 200,000 次，变化的 float x-scale；不含平台 matrix 组合、QPainter 或 GPU。

| 数值操作 | C++ reference | Rust C ABI |
| --- | ---: | ---: |
| metrics | 54.23ns | 62.30ns |
| metrics + 八 patch layout | 394.47ns | 366.07ns |

单次 metrics 略慢，组合计算略快；不能据此判断 compositor 帧时间或绘制性能。实际帧时间、mixed DPI、fractional scale 实机及长期稳定性未验证。原 raster / color cache 留在 C++，没有每帧 JSON 解析或新增动态 buffer。

## 实机部署与加载

R5 独立 `build/native-r5-on`：RelWithDebInfo，Spring / Motion / Scroll / Ring ON，R3 测试覆盖 OFF；先保存 Bridge 当前工作区，用既有 stop 恢复 parked windows，再分别通过 `tools/install-native-clip.py` 发布 Clip / Ring immutable library，start 恢复运行。

- Clip canonical：`/home/cc/.local/lib/cc-niri/viewport-clip/2c3dcf070fa5ba38b0d119122f39384e6d27c63ed8a727d216ce12c62ee812d3/cc-niri-viewport-clip.so`。
- Ring canonical：`/home/cc/.local/lib/cc-niri/focus-ring/6625ca83a8eda5640f82cac434562cb60093bdf3cd6b189639d7979e3420e539/cc-niri-focus-ring.so`。
- 安装 SHA-256 为各自目录名；验证 cc_niri_ring_device_padding / cc_niri_ring_metrics 符号与运行中 backend 字段。
- UTC 起点：`2026-10-05T12:49:19.451074+00:00`；KWin PID 前后均为 **2083**，未重启 compositor。
- 备份：`/tmp/cc-niri-r5-live-20261005-lkycuxc0`；指针 `/tmp/cc-niri-r5-live-path`。包含 kwinrc、workspaces.json、Bridge / Scroll / Ring before 状态、Bridge after、manifest、部署日志及回滚脚本。
- 已安装 Bridge / JS canonical 与 SHA-256 前后相同；用户样式、JS eligibility 与 Script Effect 未更新。
- 沿用已记录的受保护进程 maps 限制，通过运行中 Core 诊断 / immutable hash / symbols / loaded endpoints 核验，未宣称直接读取映射。

重载前后 workspaceId / index、output 与 viewportAnchor 相同；当前列从 4 变为 3，焦点 / Wide presentation 和当前工作区快照有所变化。只读 KWin getWindowInfo 已确认被移除的 UUID 仍存在且 **fullscreen=true**；重载前 Ring 已 active=false / eligibleCount=3。此时 fullscreen 窗口在启动布局中被排除，Ring 按既有规则隐藏，不能将该差异记录为布局完整保留或 Rust 视觉通过。比较证据保存为 `deployment-state-comparison.json`。

UTC `2026-10-05T12:50:02.058809+00:00` 加载检查：Ring coreBackend=Rust、Clip decorationGeometryBackend=Rust / scrollRuntimeBackend=Rust，两个 Effect 均加载，Bridge 可查询，epoch=-1，Ring drawCount=0（当前 fullscreen）。23 行 stop / start 日志中的 native fallback、INVARIANT_FAIL、FAIL_SAFE、ReferenceError、TypeError、completion timeout、panic 七项计数均为 0。启动日志另含原 JS 声明顺序提示和 Ring endpoint 建立前的四条 PublishEligibility D-Bus 消息；最终 endpoint / eligibility 查询成功，此加载窗口尚未证明 paint 验收通过。

## 人工视觉验收

当前为 eDP-1 内屏；请求用户先退出 fullscreen，然后重新检查：

| 设计要求 | 状态 |
| --- | --- |
| 静态 Ring / width / corner | 用户反馈“功能正常”，内屏通过 |
| H/L 跟随、连续 retarget、反向 retarget | 同轮反馈，内屏通过 |
| Pair/Wide、Presentation/Overview | 同轮反馈，内屏通过 |
| viewport edge / clip / 残留 | 同轮反馈，内屏通过 |
| owner switch、workspace switch、close、fullscreen | 同轮反馈，内屏通过 |
| HiDPI / fractional scale / mixed DPI 实机 | 尚未执行；自动覆盖不等于实机验收 |

状态 / 日志采集：`/tmp/cc-niri-r5-live-capture.py`；R4 的“功能全部正常”反馈不计为 R5 的 Ring 视觉验收。

用户对本轮 R5 检查列表反馈 **“功能正常”**，据此记录内屏功能 / 视觉验收通过；这是人工反馈，不是逐帧测量，也不覆盖尚未执行的 DPI 实机范围。

反馈后于 UTC `2026-10-05T13:00:28.350940+00:00` 核对：KWin PID 仍为 **2083**，Scroll / Ring session 保持部署后的值，epoch 从 -1 推进到 **55**。Ring **active=true、drawCount=4,003、width=3、cornerRadius=12**，coreBackend 仍为 Rust；Clip decorationGeometryBackend / scrollRuntimeBackend 均为 Rust，两个 Effect 加载，Bridge 可查询。当前 workspace 已切换到 `67cb656e-0a97-44e9-8b7d-f743faea501b`。

部署以来 **496 行日志**中 native fallback、INVARIANT_FAIL、FAIL_SAFE、ReferenceError、TypeError、completion timeout、Rust panic 七项计数均为 **0**。证明本轮已实际执行 Ring paint，补足初始 fullscreen 时 drawCount=0 的加载证据；不宣称每一帧均经过性能测量。

本轮证据保存在备份目录的 `manual-round1-state.json`、`manual-round1-bridge.json`、`manual-round1-kwin.log`、`manual-round1-result.json`，manifest 已记录用户原文与范围。

## 回滚与阶段状态

本会话恢复 R4 Clip 与旧 Ring：

```sh
python3 /tmp/cc-niri-r5-live-20261005-lkycuxc0/rollback.py
```

脚本先 stop 恢复 parked windows，原子恢复两个旧发现链接并 start。R4 Clip `17f0cbaf…`、旧 Ring `d12a2506…` immutable 库保留；更早的 R2 / 原 C++ 插件也保留。`/tmp` 备份可能随重启清理，库仍位于 `.local/lib/cc-niri`。源码回退 Ring 路径将 `CC_NIRI_USE_RUST_FOCUS_RING_CORE=OFF` 并同时重新构建两个插件。

本阶段没有创建 commit，沿用 R0–R4 工作区；未修改用户 Core UX 设计。R5 生产接入、自动门禁及内屏功能 / 视觉验收完成；HiDPI / fractional scale / mixed DPI 实机、实际帧时间和长期稳定性仍待验证，不能据此宣称完整实机矩阵通过，不切换源码默认 ON，不删除 Legacy C++ Core。

R6 后续状态：2026-10-05 独立 Native Protocol 构建已部署到当前桌面，R5 两个 immutable 插件继续作为回滚基线保留。R5 已通过的反馈属于本阶段；当前 backend 与 R6 待验收状态见 [R6 记录](RUST_NATIVE_R6_RESULTS.md)。
