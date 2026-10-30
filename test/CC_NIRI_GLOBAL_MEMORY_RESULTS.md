# CC-Niri 全项目低内存阶段结果

日期：2026-10-13。HEAD `b77a40eb1e0a0fd66d053c5996a13bc88e75518b`，包含当前工作区修改；不是完整M0–M3验收。规范源：[iA Writer.md](../doc/todo/iA%20Writer.md)。

后续用户要求先暂停会影响桌面操作的测量，因此安全stop/start、KWin内存权限与B0/B1对照均暂停，未执行；当前转入[单列居中离线开发](RUST_NATIVE_R7_SINGLE_COLUMN_CENTER_RESULTS.md)。以下是内存审计阶段当时的范围与结果，不将后续功能门禁或代码变化追溯记为内存预算通过。

后续开发补充：单列居中P4修复了ScrollPlanCommitGate失联取消ACK的请求保留，使用既有150ms协议期限回收请求/timer，5000次丢失及迟到ACK模型通过。这是生命周期修复，PSS节省仍NOT MEASURED；不等于M0–M3验收或全部Bridge admission问题已解决。完整Native验证见上面的单列居中报告。

## 本轮交付

- 根`AGENTS.md`合并全项目16GB预算、低频测量、生命周期、性能与安全操作约束，保留既有工具链、JS/Rust/C++authority和门禁。
- [基线观测与安全A/B方案](CC_NIRI_GLOBAL_MEMORY_BASELINE.md)：5分钟31个样本和权限/负载限制，不冒充受控Dockless B0/B1。
- [资源账本](CC_NIRI_GLOBAL_MEMORY_AUDIT.md)：组件状态规模、生命周期、现有上限的例外、待验证热点与sizeof探针。
- `tools/sample-memory.py`：Python标准库、有限时长、≥10秒间隔、PID/start-time身份与CPU区间、PSS/Private_Dirty/RSS/Swap、缺失原因与JSON落盘；一次性手动运行，无生产daemon、额外动画时钟或后台服务。
- `test/memory-resource-lifecycle.test.js`：5000次模拟窗口关闭检查Ring watcher/tombstone/WindowState释放和销毁wrapper保护；5000次快照删除/工作区回收检查UUID owner/锚点/展示引用收敛。
- 原始数据：[memory-data/20261013](memory-data/20261013)。未改生产`src/`、Rust、FFI、Qt renderer、CMake入口或安装产物，未停用组件、改变Dock或重启桌面。

## 检查与指标

| 项目 | 状态 | 结果与边界 |
| --- | --- | --- |
| 根AGENTS约束固化 | PASS | 目标明确为待测总预算，包含可选Dock，不覆盖原约束 |
| M0既有测试上下文问题 | PASS | 当前工作区已有layoutEligibility fixture修复，保留并验证，不重复改动 |
| JS / bundle / whitespace完整门禁 | PASS | 修改前`node tools/check.js`101项；新增回归后最终102项通过，fail=0，约82秒 |
| 新增模型生命周期压力 | PASS | 两个5000循环场景通过，目标容器/连接回到稳态；不是真实Qt/GPU泄漏验收 |
| Bridge现有构建树CTest | PASS | 18/18通过，含QObject生命周期、持久化、Golden差分、Rust契约、FFI smoke、编译器policy；25.36秒，未重建Native |
| 诊断工具运行/参数验证 | PASS | 单次与300秒低频采样；non-finite duration与interval<10被拒绝；JSON有效；KWin PSS缺失明确记录 |
| sizeof Release临时探针 | PASS | GCC16.2.1，共享CMake compiler检查；Scroll338008 bytes、workspace512 records151552 bytes，合计约0.467MiB；不是PSS测量 |
| Bridge运行时PSS观测 | PASS | median2487KiB；首尾+10KiB；仅该进程短期观测，不判长期泄漏或整体通过 |
| M0全项目B0/B1基线 | INCONCLUSIVE | KWin smaps_rollup权限不足，未采B0；当前存在配置Dock，窗口负载变化，运行产物映射未核验 |
| M1真实Scene Item/纹理/Qt连接/FFI存活量 | NOT MEASURED | 已列源码路径、部分Native状态查询；现有endpoint未导出完整资源数量/字节；不能据累计rasterization数判纹理数 |
| 空闲≤32MiB / 动画≤64MiB净增量 | INCONCLUSIVE | 缺少可靠KWin PSS、固定负载A/B及峰值归因 |
| 30–60分钟idle/交互、同状态增长≤4MiB | NOT MEASURED | 本轮5分钟非受控观测；没有以RSS替代PSS |
| GPU显存增量 | INCONCLUSIVE | 现有整卡值不可归因；源码未新增全屏/窗口图像或render target |
| J/K体感卡顿 | INCONCLUSIVE | 前一轮单次切换约60fps、无长间隔；用户体感原因尚未定位，本轮未改动画 |
| M2生产优化前/后节省 | NOT MEASURED | 未有充分归因证据，不实施lazy数组或改恢复/ACK语义 |
| M3完整G01–G12 | NOT MEASURED | 见下表，安全且获准后继续；不宣称整体PASS |

本轮没有工具链、生产Native、CMake/FFI或动画改动，因此未执行cargo fmt/clippy/workspace test、`node tools/check.js --native`、Core Debug/Release重建、Native umbrella或BUILD_TESTING=OFF生产重建。既有18项CTest只证明当前测试产物通过，不能代替未来M2完整门禁。Native变更时仍须按根/native AGENTS全部执行。

## G01–G12当前覆盖

| 场景 | 状态 | 已做 / 待做 |
| --- | --- | --- |
| G01 0/1/2/5/10窗口Dockless | NOT MEASURED | 未受控窗口矩阵 / B0/B1 |
| G02 30–60分钟idle | NOT MEASURED | 5分钟现有桌面观测不能代替 |
| G03 H/L反向短连击 | NOT MEASURED | 未关联PSS、ACK与帧时间 |
| G04 J/K和W8/W9回收 | INCONCLUSIVE | 既有单次60fps观测、模型快照回收通过；实机长期内存待做 |
| G05 30–50次真实轻量窗口开关 | NOT MEASURED | 模型5000次通过，未获准启动/关闭真实窗口压力测试 |
| G06 Ring快速焦点/纹理收敛 | INCONCLUSIVE | 模型watcher释放通过；Native visual1→0观测，GPU纹理计数与长期回归待做 |
| G07 Half/Full/Wide/Fullscreen循环 | NOT MEASURED | 需固定负载实机验证 |
| G08 Bridge断连/恢复 | INCONCLUSIVE | 既有隔离对象/持久化CTest通过；timer admission与callback残留压力待重现 |
| G09 主副屏不同工作区 | INCONCLUSIVE | 当前独立模式；已有副屏JS回归通过，output历史key与长期内存待做 |
| G10 安全stop/restart | NOT MEASURED | 未在运行桌面卸载组件 |
| G11 Dock开关 | NOT MEASURED | 配置存在applet；未进行Plasma B1/B2 |
| G12 低可用内存 | NOT MEASURED | 不主动耗尽内存；需要明确允许和中止方案 |

## 下一阶段与回滚

按基线文档的具体方案，先取得只读KWin内存权限及安全stop/start许可，固定窗口、输出、特效与Dock条件，再做三轮B0/B1。用隔离模型/DBus验证Bridge deferred timer、紧急队列与disarm ACK异常；对输出历史barrier用测试fixture，不在用户桌面热插拔。只有实测收益与正确性证据充分后进入M2最小生产变更，并跑全量门禁与M3实机验收。

当前运行时无需回滚：没有配置/部署变更，采样已自行结束。仓库回滚只需移除本轮新增工具/测试/报告/原始数据并撤回AGENTS新增低内存节；保留原有用户工作区修改，**不使用整库reset**。README / doc索引验收状态未更新。未创建提交。

## 2026-10-15 Scroll Layout V2 P1 补充

新增默认关闭的 V2 配置和纯几何/三档列宽离线实现，尚未接入生产 V2；现有 V1 运行入口保留。
源码资源账本更新在 [M1 审计](CC_NIRI_GLOBAL_MEMORY_AUDIT.md)，功能/自动检查见 [P1 结果](SCROLL_LAYOUT_V2_P1_RESULTS.md)。
本阶段未做内存优化或桌面 A/B，特性≤2/8MiB和全项目≤32/64MiB目标均 **NOT MEASURED / Pending**；
Private_Dirty、GPU、真实对象/纹理数量、帧时间和30–60分钟增长也 **NOT MEASURED**。
没有把算法/回归测试通过写成资源预算通过；M0–M3 验收状态保持原结论。

## 2026-10-15 Scroll Layout V2 P2 补充

新增统一视口/工作区离线事件模型，主入口仍V1；[P2 模拟与验证](SCROLL_LAYOUT_V2_P2_RESULTS.md) 和
[资源账本](CC_NIRI_GLOBAL_MEMORY_AUDIT.md) 已记录单份 O(N) intent/source 和2000次模型操作收敛。
真实Release A/B PSS、Private_Dirty、对象/纹理、GPU、帧时间和30–60分钟斜率均 **NOT MEASURED**。
无新增 Native handle 或 paint 路径；不能据模型通过宣称全项目/特性预算达标，M0–M3结论不变。

## 2026-10-15 Scroll Layout V2 P3

生产构建的私有虚拟 KWin/Bridge/Ring 集成：100%与150%各31/31，150%+Fcitx5为34/34，均 PASS。
Rust 输入/帧查询零堆分配、JS 5000次失联 callback 收敛属于局部契约；短 idle Scroll repaint 稳定属于局部观测。
全项目同负载 B0/B1、PSS/Private_Dirty、GPU/对象/纹理归因、4K60帧时间和30–60分钟生命周期：
**NOT MEASURED / Pending**。没有用虚拟测试、sizeof、产物大小或 Rust 零分配替代总预算。
源码账本见 [M1 P3 补充](CC_NIRI_GLOBAL_MEMORY_AUDIT.md)，功能与构建门禁见 [P3 结果](SCROLL_LAYOUT_V2_P3_RESULTS.md)。
V2 默认关闭，安装组件未改动，没有进行用户桌面的卸载、重启、热插拔或内存耗尽测试。

## 2026-10-15 Scroll Layout V2 P4 JS 事务

完成新 typed producer 与复用现有 Gate 的 client-ACK/painted-completion 等待，21项定向契约含2000次模型失败清理。
Native protocol4/resize 尚未实现，RuntimeBridge 显式拒绝新类型，main 不启用 V2。
源码账本与限制见 [M1 P4 补充](CC_NIRI_GLOBAL_MEMORY_AUDIT.md) 和 [P4 进度](SCROLL_LAYOUT_V2_P4_RESULTS.md)。
全项目同负载 B0/B1 PSS/Private_Dirty、真实 callback/对象/纹理、GPU、4K60帧时间与30–60分钟增长均
**NOT MEASURED / Pending**；没有把模型状态归零当作资源预算通过。未部署或操作运行桌面的组件。

P4 后续 Rust/Bridge 增量：typed validator/共享 sequence 与列相对 motion 已实现，场景端尚未构造组件；
Core 10000次帧查询零分配不作为项目预算验收。生产启用、真实 resize、GPU/对象生命周期、PSS 与4K60长测
继续 **Pending / NOT MEASURED**，详见 [Native 阶段结果](RUST_NATIVE_R7_SCROLL_LAYOUT_V2_P4_RESULTS.md)。

同批逐窗口真实 paint source 接线：隔离 Release KWin 100% / 150% 各35/35、150%+Fcitx5为38/38通过，
包括 P3 回归和新增 source/cancel 事实。Core 10,000次 paint 账本更新/查询零堆分配；
没有将这些结果作为真实 resize、全项目资源预算或4K60验收。PSS/Private_Dirty、对象/纹理/GPU及长测仍 NOT MEASURED。

### P4 完整实现后的结果边界

上述 P4 JS/数值/source 增量中的“未接线”描述为历史。完整 runtime、FFI、Scene 和事件驱动 JS 协调器现已接通，并在私有 Release KWin 中实际运行宽度循环、快速 retarget、隐藏列、长跳转反向、途中关闭、工作区返回、Fcitx5 和取消恢复。最终功能/构建计数见 [P4 报告](SCROLL_LAYOUT_V2_P4_RESULTS.md) 及其 verification；不把这些结果作为总资源预算通过。

M1 已补充 current-row/observation/closing/弱引用/连接/timer 账本。Core 10,000帧零堆分配、模型与私有 stop 清理属于局部验证。全项目 B0/B1、PSS/Private_Dirty、真实 Qt callback/Scene对象/纹理统计、GPU归因、4K60、30–60分钟增长仍 **NOT MEASURED / Pending**，M0–M3没有因此转为 PASS。V2 默认关闭，用户安装版及当前桌面未变，未执行用户桌面卸载、强杀、热插拔或内存耗尽测试。

### 2026-10-16 P5 完整入口后的结果边界

P5 持久化/兼容与生产主入口接线完成，详见 [P5 报告](SCROLL_LAYOUT_V2_P5_RESULTS.md)。完整生成入口在私有 Release KWin 100%/150%分别30/30、150%+Fcitx5为33/33通过，P4回归35/35；Native/JS、Debug/Release/OFF边界、旧Bridge私有读取测试通过。生命周期回归覆盖关闭释放、拓扑连接不随历史增长、透明配置ACK及用户最小化状态恢复。

这些结果不将 M0–M3 转为 PASS。全项目相对原生 KDE 的 PSS/Private_Dirty、峰值、Qt/Scene对象/纹理、GPU、4K60、30–60分钟斜率仍 **NOT MEASURED / Pending**。下一阶段 P6 执行真实同负载基线与用户桌面验收。V2 默认关闭、已安装四组件 SHA 不变；未重载/卸载用户桌面组件，未做热插拔或压力耗尽测试。

### 2026-10-16 P6 准备范围

安全恢复模型、私有Bridge与完整入口CLI stop、候选完整性、回滚dry-run及离线分析通过范围见 [P6报告](SCROLL_LAYOUT_V2_P6_LIVE_RESULTS.md)。用户桌面尚未部署或停止组件；B0/V1/V2 PSS/Private_Dirty、正常动画峰值、对象/纹理/GPU、4K60和30–60分钟增长均 **NOT MEASURED / Pending**。工具输出MEASURED或局部清理不将全项目预算标PASS；M0–M3状态不变。

### 2026-10-16 P6 授权部署后

V2经授权部署并开启，启动/协议/实际Native路径核验PASS，详见[P6部署记录](scroll-layout-v2-p6-evidence/20261016/deployment/deployment.json)。未运行受控B0/V1/V2采样或长测，PSS/Private_Dirty/GPU/对象/纹理、正常动画峰值、4K60与30–60分钟增长均仍 **NOT MEASURED / Pending**；M0–M3未转为PASS。

### 2026-10-23 平铺圆角兼容结果

局部热应用使用第三方特效现有绘制路径；KWin / Bridge PID 未变化。前/后低频观测与账本分别见上述 BASELINE / AUDIT 的同日期条目及 [修复记录](RUST_NATIVE_R7_ROUNDED_CORNERS_RESULTS.md)。KWin PSS / Private_Dirty 权限不足、两侧窗口宽度/用户负载变化，功能内存归因 **INCONCLUSIVE**；实际 GPU 纹理计数、帧时间与 30–60 分钟收敛 **NOT MEASURED**。现有 third-party redirect 成本必须计入项目预算，不能据 CLI 无新纹理宣称低内存通过。M0–M3 和 32/64 MiB 预算验收保持 Pending。

同日后续配置事务、恢复失败重试、Bridge 清理顺序、重复 start 零圆角写入及只读 status 的离线回归 **PASS**；CLI 热更新前后 kwinrc hash 与 KWin/Bridge PID 不变。测试耗时改善有日志支持，未测生产 PSS/GPU/帧时间/长期增长；M0–M3 与总体预算状态不变，见 [后续记录](RUST_NATIVE_R7_ROUNDED_CORNERS_RESULTS.md#2026-10-23-后续配置事务停止清理与测试成本)。
