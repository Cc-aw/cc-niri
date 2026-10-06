# 4K 60Hz 工作区动画优化

日期：2026-10-06。用户明确要求保留 4K 60Hz 主屏并优化动画。独立 420ms 动画已构建、部署并进行呈现帧时间检查；普通 / 反向切换约 60fps，人工流畅度和 Pair→Wide 中途 J 的视觉验收待用户反馈。

## 实现与边界

新增 Rust `WorkspaceMotion`，使用有限时间的 quintic smoothstep `6t⁵−15t⁴+10t³`，起止速度 / 加速度为零、不越过目标、420ms 精确到达目标。连续反向从最后绘制位置接管；不在 retarget 时按墙钟跳到新位置。支持 gesture 保持 / release / cancel、grid 边界与 wrap 最短路径；无 Qt / KWin 类型，沿用 Epoch / NativeError。新独立 C ABI 为 uniquely owned handle 与窄 Point / sample / projection DTO，拒绝无效输入、不跨 FFI unwind；advance / projection / start / gesture / configure 的数值路径零分配。

C++ `WorkspaceSlideAdapter` 仅持有 KWin output / window 生命周期和 Desktop visibility refs、转发每输出 RenderView 的 presentation timestamp、管理 fullscreen owner 与绘制。只向动画中的 output 请求后续 repaint；父 Clip 既有 barrier / cleanup 仍会在切换时提交一次全局 damage。保留 KDE Slide 的 gap、背景选项、pinned / moving window、dock elevation 与 blur / contrast；完成、foreign owner、activity / topology 变化、reconfigure / 卸载时释放引用和临时角色。Rust 只处理数值 camera，不决定切换哪一个工作区，也不新增 focus authority。

Native helper 的 desktopChanged connection 早于已有 Clip barrier 与 JS guard，以便 Pair/Wide 离开画面继续被冻结到 compositor idle。原布局 / 动画 JS bundle byte-for-byte 不变；既有 20/80/180ms Wide 离开 fixture 继续通过。H/L Spring、Scroll retarget、Wide / Ring 参数及两套协议 authority 未改变。

KConfig 选项 `[Effect-cc-niri-viewport-clip] OptimizedWorkspaceAnimation` 默认 **false**；`WorkspaceDuration` 默认 420，范围 240–800ms。CLI start 在启用期间保存 Slide 原偏好（包含显式 false），卸载并禁用原生 Slide，stop 后恢复并退休保存值。不改变 KDE 全局 AnimationDurationFactor、输出分辨率 / 刷新率 / 缩放或 PerOutputVirtualDesktops。

首次部署核验发现新插件已加载但 enabled=false，自动回滚到 Clip `59630331…`。原因是 [KWin Effect reconfigure](https://github.com/KDE/kwin/blob/Plasma/6.7/src/effect/effecthandler.cpp) 的配置刷新须走 `reconfigureEffect`；全局 queued reconfigure 不刷新已加载 Effect。CLI 已在加载后、布局启动前同步调用该 API，并检查真实 Native enabled 字段。不兼容旧插件 / 启用失败时卸载相关 effect 并恢复 Slide 偏好，避免静默禁用工作区动画。首次尝试日志保留，最终部署验证成功。

## 4K 60Hz 实机帧时间

DP-1：3840×2160@60Hz、scale 1.5、逻辑尺寸 2560×1440；HDMI-A-1：2560×1440@60Hz、scale 1；eDP-1 禁用。KWin 6.7.5 / Qt 6.11.2、RTX 2060 / driver 615.71.09、OpenGL EGL，BlurStrength=14。原生独立工作区仍为 true。

使用既有 `KWin::RenderLoop::framePresented` 采集实际呈现时间，过滤 desktopChanged 至 fullscreen idle 后一个刷新周期。长间隔定义为超过 1.5 个刷新周期（60Hz 为 25ms）。下表 idle 时间在 postPaint 释放 owner 时记录；Rust 按预测 presentation time 精确完成，idle 计时可比实际最后呈现早一个刷新周期。微小 fps 超过 60 属于有限样本 / 时间戳精度，不代表突破硬件上限。

| 路径 | 主屏呈现帧数 | 每次平均呈现 fps | 首事件至 idle | 最大 P95 | 最大间隔 | 长间隔 |
| --- | --- | --- | --- | --- | --- | --- |
| 原生 Slide，6 次 | 327 | 59.998–60.000 | 884.8–894.6ms | 16.732ms | 16.806ms | 0 |
| 首次优化采样，6 次 | 153 | 57.500–60.000 | 414.8–420.6ms | 16.788ms | 33.326ms | 1 |
| 独立优化采样，6 次 | 156 | 59.968–60.004 | 406.1–426.3ms | 16.765ms | 16.841ms | 0 |
| 130ms 后反向，3 次 | 105 | 60.000–60.003 | 556.9–568.9ms | 16.803ms | 16.895ms | 0 |

首次优化测量与短暂的 Core CPU microbenchmark 重叠，第一条样本出现一个 33.326ms 间隔；原始数据未删除，不能据此确定具体原因。编译与基准均结束后追加独立六次采样和三次中途反向：全部约 60fps，没有超过 25ms 的间隔。没有承诺重负载或首次绘制一定不掉帧。

所有记录中的 desktopChanged 均仅包含 DP-1；反向组每条恰有两次 DP-1 事件。新动画普通 / 独立 / 反向组完成后回到原 workspaceId，列、focus 与 presentation 前后相同。旧 Slide 基线期间窗口列数 4→3、焦点变化，原始 state 已保留；这不是严格的相同画面 A/B，因此只比较曲线收尾和各组呈现稳定性，不声称 FPS 提升或输入延迟降低。部署前后立即 snapshot 的 workspace / focus / columns / presentation 一致，最终只读采集尊重用户之后的工作区操作。

独立曲线令收尾从约 0.89s 缩短至约 0.42s。纯数值 60Hz 对照中，1460px 单格移动的峰值 step 从 300 / 1.1 Spring 解析模型 **144.741px** 降为 **108.503px**（逻辑像素，约降低 25%）。这不是逐像素实机轨迹测量，也不将新曲线称为旧 Spring 的等价迁移。

Release / GCC -O2 临时 microbenchmark：7 轮中位数，每轮 20,000 次 start × 27 帧，advance + 两次 projection（包含摊销 start）约 **33.21ns / frame**。仅计算 Core + FFI，不包含 Qt、GPU、合成或显示；Rust 单测验证此数值路径零分配。程序和输出位于 `/tmp/cc-niri-workspace-animation-benchmark.cpp` / `.log`。

## 必须验证

工具链实测 Rust / Cargo 1.99.0、`/usr/bin/g++` GNU 16.2.1；Cargo.lock 与迁移开关默认值保持原样。

| 检查 | 结果 |
| --- | --- |
| cargo fmt --all --check | 通过 |
| cargo clippy --locked --workspace --all-targets -- -D warnings | 通过 |
| cargo test --locked --workspace | 30 项通过 |
| node tools/check.js --native | 89 个 JS 回归；Bridge 5 CTest / 3 隔离 D-Bus；Clip 17 CTest；Ring 24 CTest；Plasmoid 构建通过 |
| Debug / Release Core configure / build / CTest | 各 13 项通过，保留全部原 C++–Rust 差分、FFI smoke、编译器拒绝 policy |
| workspace-motion-rust-contract | 46,656 个 4K / 缩放投影与独立 long-double polynomial 对照；精确终点、60/120/144Hz、反向连续、时钟倒退、错误无 mutation、1000 次 ownership、C ABI/null 检查通过 |
| CLI lifecycle | 替换平台 I/O、执行实际 start / stop 代码；默认 / true / false Slide 偏好恢复、重复 start / stop、同步配置应用，以及不兼容插件恢复测试通过 |
| R1–R6 后端组合 | 下列 10 个 Native 构建各 28 项 CTest 通过 |

Native 组合：`native-r1-on`、`native-r6-motion-only`、`native-r2-on`、`native-r3-tests`、`native-r4-independent`、`native-r4-on`、`native-r5-independent`、`native-r5-on`、`native-r6-independent`、`native-r6-on`。每个 configure 均显式 `/usr/bin/g++`，沿用已有 cache 的阶段开关，无降低门禁。

首次无权限门禁在隔离 D-Bus 创建 session socket 时受沙箱限制，之后在获准环境重跑完整门禁通过。CLI 修复后最终日志为 `/tmp/cc-niri-workspace-animation-complete.log`；Core / matrix 日志 `/tmp/cc-niri-workspace-animation-{rust-Debug,rust-Release,native-*}.log`。没有修改生产 JS 源码，bundle check 通过。

## 部署与回滚

最终只读检查 UTC `2026-10-06T09:11:35.579683+00:00`。KWin PID 前后均 **2044**，未重启 compositor；主屏显示模式 / scale、Ring canonical、布局 / 动画 JS bundle 均保持一致。Native 状态确认 `workspaceAnimationBackend=RustFiniteCurve`、enabled=true、duration=420、Slide loaded=false；Scroll Runtime / Native Protocol / decoration geometry / Ring Core 仍为 Rust。Ring 部署后 drawCount=4356，这仅证明真实绘制经过该后端，不代替视觉验收。

- Clip SHA-256：`dac998ceab87811567649d8e276a38519641e8a2634958ca4e48cb79403fbbc9`；canonical `/home/cc/.local/lib/cc-niri/viewport-clip/dac998ceab87811567649d8e276a38519641e8a2634958ca4e48cb79403fbbc9/cc-niri-viewport-clip.so`。
- CLI SHA-256：`1fa002e1b938484ab10d44b07294bfcfa5cfbd33a93dad32b6e3f6188f54d3f7`，与当前仓库源码相同；最后补充启用检查只原子更新 CLI，没有再次中断正在进行的人工测试。
- KWin 部署后 TypeError / ReferenceError / SyntaxError / INVARIANT_FAIL / FAIL_SAFE / completion timeout / Rust panic / native fallback / MAP 日志计数均为 0。
- 备份与 raw capture：`/tmp/cc-niri-workspace-animation-20261006-durfrfqx`。包含 21 份切换数据、before / deploy-before / deployed / final、四组报告、comparison.json、命令审计、kwinrc / workspaces / JS / CLI 备份、首次回滚证据和 rollback.py。

恢复原 KDE 动画（保留当前 Native Clip / R6）：

```sh
kwriteconfig6 --file kwinrc --group Effect-cc-niri-viewport-clip --key OptimizedWorkspaceAnimation --type bool false
cc-niri restart
```

恢复之前的 Clip / CLI 与优化配置：

```sh
python3 /tmp/cc-niri-workspace-animation-20261006-durfrfqx/rollback.py
```

回滚通过 stop 恢复 parked windows、原子恢复旧 Clip `59630331…` 链接与 CLI、还原两个优化设置的旧值，再 start；保留 4K 60Hz 与主屏独立模式。`/tmp` 备份可随重启清理，旧 immutable library 仍保留在 `.local/lib/cc-niri`。

人工待验收：普通 J/K 体感、持续 / 反向 J/K、Pair→Wide 中途按 J / 返回、Ring / blur / dock 视觉保持。没有实机测量 touchpad gesture / wrap、热插拔、activity、动画中卸载、重负载或长期稳定性；gesture / wrap 已有 Core 契约覆盖，其余平台生命周期接入已编译通过，但需专门实机验收。优化不是 R7，源码默认 Rust 与 Legacy 删除条件不改变。
