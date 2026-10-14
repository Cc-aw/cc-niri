# J/K 4K60 D0 诊断结果（2026-10-13）

**D0 采样与分析工具：完成。归因：INCONCLUSIVE（本轮未复现 33–50ms 长呈现间隔）。** 同窗口负载的 Blur ON/OFF/ON 三组均约60fps，未证明关闭 Blur 有收益。本轮只增加离线转场分析与测试，没有修改或部署渲染路径、Rust 曲线、420ms duration、JS mount authority 或单列居中。

## 本机基线

- 本地 HEAD：`b77a40eb1e0a0fd66d053c5996a13bc88e75518b`，存在先前单列居中与资源规范等未提交修改，全部保留；没有 reset、stash、切分支、提交或重装。
- Fedora44 / Plasma Wayland / KWin6.7.5，当前 KWin PID2035；主屏DP-1 3840×2160@60Hz / 150%，副屏HDMI-A-1 2560×1440@60Hz / 100%。
- Native workspace：RustFiniteCurve / smooth60 / 420ms；Scroll、geometry 与 Native Protocol 固定 Rust。AlwaysCenterSingleColumn=true。
- 布局脚本、Motion / Clip / Ring 三个效果已加载，Bridge active；Blur=true，Contrast=false，原生Slide=false。既有 Workspace Slide 与原生Slide互斥保持。
- 安装布局 main.js 与仓库生成包一致，SHA256为 `2154436e0c97251eecadadd13bb533dfedfd2146cb0dd1fff34693ad6c9814f2`；Clip为 `024557e2565edd03796136671eda16c91bbf64985ebb568a1727f7893d04be3a`，Ring为 `994e939d1c9e314d150728b13dbc250adc462f5deef652bb857f2d76716defa4`，均仍为上次部署产物。
- 工具链：Rust / Cargo精确1.99.0；`/usr/bin/g++` GNU16.2.1。既有三个 Native 构建树为RelWithDebInfo，编译器缓存为指定路径；本轮没有修改CMake / FFI / Core。
- 远程曾缺少的测试VM `layoutEligibility` 已在本地此前独立补齐，本轮不重复修复，也不将其计为性能收益。

## 同负载 ON/OFF/ON

2026-10-13 17:18 CST采样，先按KWin实际desktop顺序选择主屏相邻 **2列↔3列** 工作区。保存实际焦点、两个输出桌面、窗口UUID集合、原配置、输出模式与布局状态；不采集窗口标题、屏幕内容或截图。

每组同一序列：两轮单次J/K往返（4请求），100ms反向（2请求），100ms连续交替（6请求），共12请求、6个完整连续转场。retarget未finish之前计入同一连续转场，不能将6次快速输入误计为6个完整420ms样本。三组共36请求 / 18转场 / 560个主屏呈现间隔。

A1：原Blur ON；B：仅临时unload Blur，查询确认OFF；A2：load Blur并查询确认ON。没有写Blur或项目配置，没有切profile，没有卸载cc-niri组件。每组开始等待1.5秒，试验之间不加载探针、不轮询CPU/GPU、无编译；每组第一样本完整保留，没有删除不利首帧或未热缓存样本。捕获查询在输入结束0.85秒后进行，使用已有3秒/固定容量接口。

| 轮次 | Blur | 请求 / 转场 / 间隔 | >25ms间隔数 | P50 | P95 | P99 | Max | 按间隔加权FPS |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | ON | 12 / 6 / 188 | 0 | 16.665ms | 16.807ms | 16.864ms | 16.972ms | 59.996 |
| B | OFF | 12 / 6 / 187 | 0 | 16.667ms | 16.826ms | 16.870ms | 16.897ms | 60.000 |
| A2 | ON | 12 / 6 / 185 | 0 | 16.668ms | 16.781ms | 16.866ms | 16.933ms | 59.998 |

这些是有限短样本的观测分位数，按线性插值计算；间隔并非独立样本，未给出统计置信区间。不能据几百分之一毫秒的差异认定优化有效，更不能证明其它会话或负载中Blur完全没有成本。

| 独立响应观测 | A1 | B | A2 |
| --- | ---: | ---: | ---: |
| 输入到Native arm中位数 | 0.948ms | 1.040ms | 1.027ms |
| 输入到Native arm最大值 | 1.175ms | 3.635ms | 5.302ms |
| desktopChanged到首个paint callback最大值 | 14.295ms | 14.746ms | 14.807ms |
| desktopChanged到首个输出呈现最大值 | 14.696ms | 23.251ms | 27.169ms |

**首个输出呈现等待单独保留，不被“>25ms间隔为0”掩盖。** 捕获开始紧邻输入，未必观测到转场前最后一个呈现；首个呈现也没有与某一帧窗口内容关联。因此本轮不能宣称每次输入到屏幕更新都小于25ms，也不能宣称整段完全零漏帧。这里的0仅指明确转场边界内、相邻实际呈现时间戳之间的观测长间隔数。

## 转场分析实现

`tools/analyze-workspace-capture.py` 新增 `--transitions`，默认输出保持原来的全capture初步分析，兼容既有调用。

```sh
python3 tools/analyze-workspace-capture.py CAPTURE.json --transitions
python3 tools/analyze-workspace-capture.py CAPTURE.dbus --transitions
```

- 对每个输出以实际desktopChanged开始，Native kind=2 finish结束，并保留finish后至多一个刷新周期的最终提交帧；下一转场更早开始时不跨其边界。
- 同一转场中的retarget保留；多个已完成转场之间的idle不进入统计。原始时间戳不排序、平滑或改写。
- 分别提供每转场和有效完整转场池的P50/P95/P99/max、样本量、>25ms数量、刷新周期相对长间隔数、FPS。
- 分开报告首个paint callback与首个输出呈现等待；较长间隔列出相对转场开始的位置，不自动等同为JS mount耗时或GPU时间。
- 缺finish、截断、无有效刷新率、重复/倒退等无效呈现、无样本均明确标记，缺finish不伪造deadline。截断转场的可见观测仍列在详情，排除比较时计入excludedTransitionCount。
- 独立副屏没有桌面切换则不把其idle计为主屏掉帧。输出关联标记保持 `output-only-no-paint-to-present-join`。

新增 `test/workspace-capture-analysis.test.js` 的三个语义测试覆盖：空闲边界/长首尾间隔/首个更新等待；连续retarget、多转场、多输出、刷新率与相邻边界；未完成、截断、非法样本、缺样本，以及JSON/gdbus解析和原始输入不变。

## 归因和阶段决定

- **INCONCLUSIVE**：本轮两个有窗口工作区未复现33–50ms呈现长间隔，A2恢复Blur后也没有异常复现，不满足BLUR_RELATED的因果判据。
- 不能将今天稍早复测的50ms或重启前100ms与本轮约17ms差异归功于本轮代码：测量时生产代码并未变化；跨时段会话/应用负载不可控。
- MOUNT_RELATED / RENDER_RELATED未证实。本轮Native arm与首个paint callback较短，但没有J0/J1/W0/F0/F1/F2分段数据或CPU调用栈，不能把曲线、JS mount、Blur、NVIDIA任一项判定为根因。
- 本机无可用perf，未强装profiling工具，未暂停或附加调试器到KWin；未做同步GPU读回或fence等待。
- D0有界阶段测时：**NOT IMPLEMENTED / 当前无残留长帧触发进一步埋点的条件**。若再次出现33–50ms且同负载A/B不能归因，可独立加入默认OFF的固定容量POD计时，并先通过门禁，部署由用户另行决定。
- D1a：可独立评审per-output/per-pass可视Desktop投影预计算，固定容量及完整fallback；先证明投影调用次数/CPU成本下降，再验证真实呈现与生命周期。**本轮未实现，不能宣称掉帧收益。**
- D1b：暂不实施Blur/Contrast策略，当前无有效收益证据。没有永久关闭系统Blur或改变forced roles。
- D2：选做的逻辑时间clamping暂不实施，没有以减慢逻辑时钟、缩短duration或修改制动来改变统计。
- D3：全功能/长时/16GB资源发布门禁仍PENDING。本轮不把一次短测当成长期4K60或单列居中S01–S14的完整验收。

## 验证与资源限制

| 检查 | 结果 |
| --- | --- |
| 新增分析测试 | PASS；三个边界语义测试纳入正常Node门禁 |
| `cargo fmt --manifest-path native/rust/Cargo.toml --all --check` | PASS（完整门禁实际调用） |
| `cargo clippy --manifest-path native/rust/Cargo.toml --locked --workspace --all-targets -- -D warnings` | PASS |
| `cargo test --manifest-path native/rust/Cargo.toml --locked --workspace` | PASS；65个Rust测试 |
| `node tools/check.js --native` | PASS；106个JS测试文件，116个Node测试 |
| Bridge / Clip / Ring CTest | PASS；18 / 17 / 25 |
| 5个隔离DBus集成、production boundary、Plasmoid | PASS |
| 生成包校验、最终 `git diff --check` | PASS；未修改src，不需重新生成生产包 |
| Core Debug/Release、umbrella、OFF production额外门禁 | NOT RUN；本轮没有Native / CMake / FFI / Core改动，既有完整Native门禁已运行 |
| 额外常驻服务/线程/纹理/生产帧分配 | 无新增生产路径；只有离线工具及短时诊断进程，结束退出 |
| 同负载B0/B1 PSS、Private_Dirty、GPU时间、长期资源 | NOT MEASURED；不能宣称整体资源预算通过 |

使用现有RelWithDebInfo产物采样。采样结束、恢复验证后才执行构建/门禁，CMake与Cargo并行上限2；没有将编译负载混入帧率样本。门禁日志为 `/tmp/cc-niri-jk-d0-native-gate.log`，持久私有目录有副本。

## 恢复、原始数据与回退

PASS：36/36请求对应desktopChanged与Native arm；18/18试验的Bridge窗口归属/列宽集合不变；最终实际窗口UUID集合不变；原主副屏desktop、实际焦点、完整kwinrc、完整输出配置均恢复/一致。Blur恢复ON，Contrast仍OFF，Slide仍OFF，三个项目效果仍加载，Bridge active。短时KWin日志错误筛选为0；临时脚本已卸载、诊断服务已退出，有限capture自然截止。

原始证据的持久私有目录（0700）：

`/home/cc/.local/state/cc-niri/diagnostics/jk-d0-20261013-171812`

包含18份原始 `*.capture.json`、输入时间与状态、实际窗口探针、原kwinrc、输出配置、Native状态、dirty.patch/status、runner.py、分析器快照、已安装字节SHA、对应布局/单列居中源快照、恢复验证、日志与完整门禁副本。仓库脱敏汇总：[`diagnostics/JK_D0_BLUR_AB_20261013.json`](diagnostics/JK_D0_BLUR_AB_20261013.json)。原始捕获保留完整时间戳，未覆写或滤掉坏样本。

无需组件回滚：本轮没有部署。离线工具回退只需移除 `--transitions` 即仍使用原分析结果；新工具及测试可独立撤销，不涉及当前桌面。此私有D0目录是证据与状态记录，**不是完整组件部署回滚备份**。后续任何部署都先建立新的配套持久备份，不能依赖已被重启清理的旧 `/tmp` 部署备份。

## 后续 D1a

用户随后要求保留 Blur、继续其它项。D1a 投影预计算已独立实现并通过离线门禁，默认关闭；尚未部署或完成同负载实机 A/B。详见 [D1a 阶段结果](RUST_NATIVE_R7_JK_D1A_RESULTS.md)。D0 的归因与帧率数据保持上述历史结论，不将后续代码改动计入这轮测量。
