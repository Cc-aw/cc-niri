# 4K60 Animation A0 / A1 实施与验收记录

日期：2026-10-09。分支：`feat/animation-60hz`。开发基线：`1c27fbd0e8ba09609c248e2364772e1ec9b56e54`；实现范围为 A0 的测量设施与环境核查、A1 的目标输出呈现时钟。新版 Native Clip 已部署，当前启用 `smooth60`；自动门禁与下述有限实机检查已完成。**人工手感反馈尚待确认，不将这些结果写成所有阶段验收通过。**

## 本地基线与范围

方案使用的固定提交是 `f3650b286198c0a189f0e32f59f249b2c9b43e88`。本地基线相对该提交已有 12 个 Native 文件变化，包含 Full/half partial clipping、输入过滤、Script paint composition、ScrollClipHandoff、workspace departure freeze 和 DTO 修改。本轮保留这些路径，没有将源码回退到方案基线。

开工时位于 `main`，两个 `doc/todo/` 方案为用户未跟踪文件；没有其他已跟踪文件修改。本轮创建功能分支并保留两个文件，没有 stash / reset / 合并 / 推送。没有修改 Rust/Cargo 版本、Cargo.lock、生产 JS 源码或生成包。

仍由 JS 发布 Scroll v2 / Ring v1、管理布局与工作区；Rust 管理 motion / projection / sequence，C++ 只处理平台时钟、输出和对象生命周期、绘制与诊断。没有新增 Ring owner、eligibility、动画 timer 或线程。

## 实现行为

- 新 KConfig 键 `AnimationProfile`：默认 `stable`；`smooth60` 启用本轮时钟修正；无效字符串回退 `stable` 并在状态中标记。配置在构造 / reconfigure 时解析，切换 profile 走已有 clear / ownership 释放路径。
- `stable` 保持按执行时刻推进的旧入口；冻结 C++ reference 未修改。H/L Spring 仍为 mass=1、damping_ratio=1、stiffness=800、epsilon=0.0001，接管仍为零初速度。J/K 时长、有限曲线、优化开关和原生 Slide 协议保持原值。
- `smooth60` 缓存事件边界解析的真实 target output；只在匹配输出、有 OutputFrame 的真实绘制 pass 中准备样本。离屏捕获和副屏不推进；同预测时间 / revision 复用；新 epoch 使缓存失效；嵌套同输出绘制复用外层样本。paintWindow 不读取新的 motion 时间。
- Rust 分开保存 arm origin、pending sample 和 painted anchor。只有投影真正用于目标输出绘制后，`mark_painted(epoch,time)` 才发布完成状态及接管锚点；过期或不匹配的确认无效。接受新目标时丢弃未绘制 pending 状态，从 painted anchor 接管；起始时间取事件时刻与 painted sample 时间的较大值，不伪造 `+1ns`。
- 数值完成后仍持有 Outgoing / ownership，等待原 JS park / disarm。session / workspace / output 屏障、已接受 epoch 的消费规则保持原约定。
- Adapter 拥有的 clone / copy 保留 motion 与 authority，但冻结到最后绘制锚点，供 workspace departure / clip handoff 使用。未使用的 pending 状态不会污染冻结位置；stable 的 anchor 与旧 advance 偏移一致。
- 正常使用 `RenderView::nextPresentationTimestamp()`。缺失、非正、倒退分别计数，退回同域 steady-clock 并保持不小于最近有效时间；大跳变按真实 elapsed 采样。没有逐帧 warning。
- 保留全局 repaint 范围。ViewportClipEffect 的 full repaint 调用统一经过透明计数入口，仍直接请求 `effects->addRepaintFull()`；A5 的 damage 缩减未实施。

时间契约核查使用本地 KWin 6.7.5 的 `effect/effect.h`、`scene/scene.h`、`core/renderloop.h`：ScreenPrePaintData 提供 screen / view / frame，RenderLoop 的时间戳注释为 monotonic。上游 [RenderLoop 实现](https://raw.githubusercontent.com/KDE/kwin/master/src/core/renderloop.cpp) 使用 steady-clock，且 [WorkspaceScene 实现](https://raw.githubusercontent.com/KDE/kwin/master/src/scene/workspacescene.cpp) 将真实 frame 传入 prePaintData。本轮保留协议 issuedAt / workspace barrier 的 Unix 毫秒时间域，只对 motion 时间使用单调纳秒。

## 采样与离线分析

新 D-Bus 方法 `StartScrollFrameCapture()` / `GetScrollFrameCapture()` 使用 v1 格式，原 Workspace capture 接口和字段不变。默认关闭；最长 10 秒；painted frame 和实际 presentation 各固定 2048 条，lifecycle 固定 128 条。任一缓冲满后统一标记 truncated 并停止写入；超时后退出诊断热路径。帧路径无 JSON、文件 I/O、D-Bus 调用、动态扩容或新增 repaint。

记录 capture / output / frame / revision / epoch、事件 / 预测 / sample / paint 时间、x / v / target / origin、scale / refresh、fallback、数值完成与 ownership。输出 token 在启动采样时分配；采样期间新增输出使用 0，离线报告标为 unregistered；被移除输出保留名称与历史数据。full repaint 计数包括 ViewportClipEffect 的直接调用，并记录当时已注册且存活的各输出覆盖计数；不包括 WorkspaceSlideAdapter 的独立区域请求，也不代表 GPU 工作量。

`tools/analyze-animation-capture.py` 接受 JSON 或 gdbus 的单字符串 tuple 输出，分开报告：

- 实际呈现间隔 P50 / P95 / P99、最大值、样本数、无效间隔及 >1.5 刷新周期的长间隔。发现采样期间刷新率变化时不套用固定长间隔阈值。
- 绘制轨迹的相邻物理位移、逻辑速度、组件事件到首个超过 0.25 physical px 的绘制响应、采样 T95、采样双视觉阈值、数值完成与 cancel 请求。scale 改变的跨帧位移不混算。
- 已在 capture 开始前启动的轨迹显式标记 startedBeforeCapture；其首个响应 / T95 / 视觉阈值时间输出 null，避免把第一次观测误当成首次达到阈值。

**没有可靠的 paint→actual present 一对一关联。** `painted` 表示数值状态用于绘制，不能当成面板呈现确认；cancel 请求也不等同于已证明 JS 完成了 park。缺失指标输出 null。诊断关闭 / 开启的轨迹一致性与固定容量边界已有自动测试。

使用方式见 README。应固定窗口、内容、输出、输入间隔和 profile，每个关键场景至少 20 次，分开轻载和受控编译负载；保留冷启动样本及完整 capture 文件。

## 部署前实机环境核查

以下来自本轮真实查询，不是历史报告引用：

| 项目 | 当前状态 |
| --- | --- |
| KWin / Qt | 6.7.5 / 6.11.2 |
| 合成渲染器 | NVIDIA GeForce RTX 2060，NVIDIA 615.71.09，OpenGL 3.1 |
| 主屏 DP-1 | 3840×2160，60Hz，scale=1.5，逻辑 2560×1440，原点 (0,0) |
| 副屏 HDMI-A-1 | 2560×1440，60Hz，scale=1，逻辑原点 (2560,0) |
| 内屏 eDP-1 | 已连接、禁用 |
| 工作区优化 | 运行状态 true，420ms |
| 原生 Slide 配置 | slideEnabled=false |
| AnimationProfile 配置 | 原本不存在；读取默认值 stable；旧加载插件尚无新 profile 状态字段 |
| Native runtime / protocol / Ring backend | 实际查询均为 Rust；查询时 Scroll inactive、epoch=200 |

发现路径及文件 hash 已核对：

```text
Clip: /home/cc/.local/lib/cc-niri/viewport-clip/88655ce741236ac23fc3ab892e85b4253d3d1b1b5451f576092262c81fa564f5/cc-niri-viewport-clip.so
Ring: /home/cc/.local/lib/cc-niri/focus-ring/e58a356f587dce070c18677bb51792777712d7825bb1d904effd58e4a7622077/cc-niri-focus-ring.so
```

以上是部署前发现 symlink 指向的 immutable 文件。取得用户部署授权后仅更新 Clip；CLI、Bridge、JS、Ring 的路径 / hash 均纳入部署前后核对。新版发现绑定和新接口已验证，详情见下节；系统禁止读取 `/proc/2050/maps`，因此实际映射 hash 无法独立核实。

## 自动验证

实际工具链：Rust / Cargo 1.99.0，`/usr/bin/g++` GNU GCC 16.2.1。构建 / 测试 / lint 采用 --locked；编译与 CTest 并发最多 2。CMake configure 使用共享 CCNiriToolchain.cmake，并显式传入固定编译器及正确 Rust executable 缓存。

最终代码验证结果如下，冻结副本修正后的完整门禁与 Core / umbrella CTest 已复验：

| 检查 | 结果 |
| --- | --- |
| cargo fmt --manifest-path native/rust/Cargo.toml --all --check | 通过 |
| cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings | 通过 |
| cargo test --manifest-path native/rust/Cargo.toml --locked --workspace | 33 项通过 |
| node tools/check.js --native | 100 个 JS 回归、Bridge 17 / Clip 16 / Ring 23 CTest、5 组隔离 D-Bus、Plasmoid 构建和生产符号边界均通过 |
| Core Debug configure / build / CTest | `build/rust-Debug`，12 项通过 |
| Core Release configure / build / CTest | `build/rust-Release`，12 项通过 |
| Native umbrella Debug configure / build / CTest | `build/native-r7-debug`，27 项通过 |
| BUILD_TESTING=OFF 生产构建 | `build/native-r7-production` 两插件、`build/bridge-r7-production` Bridge 通过；target help 中无 reference / differential target |
| 生产边界审计 | 默认门禁与 OFF 发布产物均通过；无冻结 C++ 算法符号 |
| 编译器拒绝路径 | GNU16 实际 configure 通过；fixture 验证非 GNU、GCC15 / 17、非指定路径均拒绝 |
| Rust / Cargo 精确版本拒绝 | 独立 configure 元数据 fixture 分别拒绝 rustc / cargo 1.98.0；没有使用其他 Rust 版本构建 |
| 生成包与 patch whitespace | 通过；未修改 src / bundle |

完整日志保存在 `build/animation-a0-a1/`，执行命令 / exit code / 用时见 `results.json`；最终快照检查日志使用 `final-` 前缀。初轮源码静态检查因 repaint 经过计数入口而失败，已更新检查，继续验证入口仍转发原 full repaint，没有修改 Golden reference。随后沙箱内隔离 D-Bus 测试因 Unix socket 权限被拒绝；取得自动审批后在沙箱外复验通过，未操作真实桌面组件。

## 部署与实机验收（2026-10-09 补充）

持久备份：`/home/cc/.local/state/cc-niri/backups/animation-a0-a1-20261009-101030`。备份包含基线 HEAD、dirty binary diff、未跟踪源码副本、配置键原值及缺失状态、安装组件路径 / hash、CLI、完整配置调查副本、save-current-state 工作区文件、恢复脚本和每组原始 capture。用户的两个 todo 文档保留，不作为生产改动部署。

采用既有 `--save-current-state → ./cc-niri stop → tools/install-native-clip.py → ./cc-niri start`。只更新 Clip，保留 Ring / Bridge / JS / CLI。安装后 Clip immutable 路径：

```text
/home/cc/.local/lib/cc-niri/viewport-clip/2d11b47e9da1297ab4eea5a4b2523273c6b55edd904f07f5890b944c64da885a/cc-niri-viewport-clip.so
```

安装文件 SHA256 与目录名一致；安全卸载 / 重载后实际 D-Bus 提供新版 capture / profile 字段，Core backend 为 Rust。KWin PID 始终为 2050，输出、工作区优化参数、其他组件路径 / hash 及原配置均经比较。最终仅新增 `AnimationProfile=smooth60`，原键不存在的状态已保存。

首次安装校验错误地将经过 CMake RPATH 改写后的安装文件与未安装构建文件直接比 hash，断言失败。预备的安全组件回滚脚本已实际执行并恢复旧版本；随后改用安装器的 immutable SHA256 校验，重试成功。这是部署校验问题，不能将首次失败记为通过。`/proc/2050/maps` 因系统权限拒绝读取，新 API / reload 与安装 hash 是可得证据，未声称验证了映射 hash。

### 有限 A/B 数据

主屏固定 DP-1 4K60 / scale 1.5、副屏 HDMI-A-1 60Hz / scale 1。使用同一组四个临时 Konsole 窗口（静态 sleep 客户端、half 宽度），通过现有 kglobalaccel 快捷键调用生产 JS，未直接发布伪造 Scroll / Ring authority。H/L 跨过 Pair 边界实际触发 Native motion；连按间隔 65ms，J/K 反向间隔 90ms，Wide 离开间隔 75ms。每组 raw capture、输入时间、离线报告均保存在 `acceptance-2/`。

下表是主屏实际 `RenderLoop::framePresented` 的呈现间隔。H/L 仅统计 painted motion 时间跨度内两端都位于该跨度的间隔，J/K 使用 desktop event 到 transitionEnd 区间；完整 capture 的所有间隔、副屏和 idle 间隔另外保留在 `live-summary.json`，没有删除原始长间隔。

| 模式 | 场景 | 已完成次数 | 区间数 | P99 ms | 最大 ms | >25ms 数 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| stable | 普通 H/L | 20 | 793 | 16.852 | 16.918 | 0 |
| stable | 同向连按 | 20 | 899 | 16.865 | 33.331 | 3 |
| stable | H/L 反向 | 20 | 797 | 16.827 | 33.333 | 3 |
| stable | 普通 J/K | 20 | 443 | 16.772 | 16.877 | 0 |
| stable | J/K 中途反向 | 20 | 569 | 16.838 | 33.365 | 4 |
| stable | Pair→Wide 中途离开 | 20 | 460 | 16.802 | 33.277 | 1 |
| smooth60 | 普通 H/L | 20 | 768 | 16.844 | 16.946 | 0 |
| smooth60 | 同向连按 | 20 | 869 | 16.871 | 33.360 | 5 |
| smooth60 | H/L 反向 | 20 | 772 | 16.824 | 33.325 | 1 |
| smooth60 | 普通 J/K | 20 | 450 | 16.792 | 16.844 | 0 |
| smooth60 | J/K 中途反向 | 12 | 347 | 16.801 | 16.938 | 0 |


普通 H/L 事件到首个超过 0.25 physical px 的**绘制响应**：stable P50=8.440ms / P95=23.986ms，smooth60 P50=3.186ms / P95=9.573ms，各 20 条轨迹。采样 T95 P50 分别为 175.493 / 177.313ms。首轮 profile transition 样本完整保留并标记（stable 首个响应 2.943ms，smooth60 1.104ms），不是冷应用启动或首次 compositor 加载的测量。

smooth60 的 2583 条 H/L painted sample 均匹配目标输出、`sampleMs == predictedMs`，fallback=0；短序列复验也为 0。普通 H/L / 普通 J/K 本组主屏未新增 >1.5 周期长间隔。快速同向输入仍有约 33ms 间隔，stable 3 个、smooth60 5 个；不能据此断言所有场景更流畅，也不能把两组差异直接归因于时钟实现。副屏原始数据包含长间隔；A1 保留 full repaint 范围，未宣称降低副屏 repaint 或 GPU 时长。

J/K 目标是用户已有工作区，目标内容可能动态，因此它是固定拓扑 / 输入的功能与呈现回归检查，不能算完全静态内容的严格 A/B。没有 paint→present 一对一关联，上述绘制响应不是输入到面板延迟。

### 缩减测试与失败记录

首轮 H/L 夹具在同一 Pair 内切换焦点，没有产生 Native motion；捕获为 0 帧，夹具断言失败并恢复桌面。修正为跨 Pair 边界后开始上表采样，原失败 capture 保留在 `acceptance/`，不混入有效 A/B。

重复循环完成 212 次有效采样后，smooth60 J/K 反向组下一次**焦点准备**断言失败，原因未确认；该失败不在已完成的 12 次 capture 中。脚本 finally 验证原窗口、工作区、焦点、副屏、配置、组件均已恢复，并回到 stable。按用户要求减少测试次数，未重跑长循环，取消其余重复采样与编译压力长测。不能将这次失败写成用户操作造成或已证明修复。

随后只执行一段短序列：smooth60 H/L 连按 / 反向、Pair→Wide 中途 J/K / 返回、Full 宽度、fullscreen Ring 抑制 / 恢复、Ring off/on、运动中关闭临时窗口、运动中切 profile 清理 / 恢复、安全 restart。均通过，短序列未复现焦点准备失败；这不能证明长循环问题已解决。

`short-acceptance/restoration-success.json` 记录全部检查。临时窗口均关闭；原窗口 membership、所有工作区 column 偏好、当前 workspace / focus、副屏 geometry / minimized 状态、拓扑、输出、KWin PID、组件及配置（除新增 profile）均比较一致。restart 更换 runtime session，Scroll / Workspace ownership 均 inactive。静止 1s capture 的本插件 full repaint 请求为 0，painted motion sample 为 0。该区间 KWin 日志扫描未发现 TypeError / ReferenceError / SyntaxError、FAIL_SAFE、completion timeout、Rust panic。

真实主屏截图 `short-acceptance/focus-ring-primary.png` 已打开检查：只有实际聚焦临时窗口呈现蓝色 Ring，静态圆角连续；这是 150% 缩放的一张静态证据，不能代替运动视觉判断或全缩放矩阵。Ring F1–F5 未实施。

## 性能、限制与下一阶段

Rust prepare / mark / 查询零分配检查以及注入时钟契约测试保持通过，覆盖 59.94 / 60 / 120 / 144Hz、执行扰动、副屏交错、异常时间、新 epoch、嵌套绘制和诊断开关一致性。实机证据范围以本报告的已完成项目为准。

当前启用 smooth60，但人工手感仍待用户实际反馈；不能据自动检查和单张截图标记全部体验验收完成。长循环焦点准备失败原因尚不明确。按用户缩减测试要求，不再开展更多重复测试；受控编译压力、工作区优化 false 组合、热插拔、100 / 125 / 175 / 200% 实机视觉矩阵均未执行。本轮 150% 主屏 / 100% 副屏并非整个 scaling 验收矩阵。

A2–A6 与 Focus Ring F1–F5 未实施。A1 没有改变 retarget 的零初速度、刚度、收尾、J/K 曲线或 damage 范围；不以本组数据宣称这些问题已经优化。

## 回滚

本轮已部署。回滚证据及可执行入口保存在上述持久备份的 `RESTORE.md` / `rollback-component.sh`；首次 hash 校验失败时组件回滚已实际执行。原 AnimationProfile 键不存在，其他组件没有替换；映射 hash 无法读取的限制明确保留。

行为回滚只将本任务的 AnimationProfile 恢复 stable 或恢复为原本不存在，再通过既有安全生命周期应用。它仍是 Rust；不恢复退休迁移开关，不修改 WorkspaceDuration、工作区优化或 Slide 偏好。组件回滚恢复备份的 immutable Clip 绑定，CLI 保持未修改；不强制卸载仍持有窗口的对象。代码回滚使用独立阶段提交的可审计 revert（提交记录存于持久备份），不 reset 用户文件或覆盖完整 kwinrc / workspaces.json。正常外部恢复使用既有 `./cc-niri stop`，它先恢复停放窗口，恢复失败会中止卸载；KWin 已崩溃 / D-Bus 不可达时该入口不能保证完成恢复，必须保留部署前持久备份和人工恢复记录。本轮不新增 KWin 重启命令。
