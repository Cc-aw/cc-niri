# CC-Niri 全项目资源账本（M1）

日期：2026-10-13。基线 HEAD：`b77a40eb1e0a0fd66d053c5996a13bc88e75518b`；使用当前工作区，既有未提交的测试与副屏结果修改保留。依据 [16GB 全项目规范](../doc/todo/iA%20Writer.md) 和根 / Native AGENTS。

本轮建立源码账本、模型生命周期回归与诊断成本探针，没有修改生产算法、协议、渲染、FFI 或桌面配置。账本中的释放路径属于源码证据；不等同于真实 Qt 对象 / GPU 纹理或整套项目已经通过内存验收。

## 资源与生命周期

| 组件 / 状态 | 规模与容量 | 释放 / 收敛路径 | 证据与限制 |
| --- | --- | --- | --- |
| JS WindowStateStore / ColumnStore | O(当前窗口 / 列数)；持有真实 wrapper | WindowStateStore.delete；ColumnStore.removeWindow / clear；RuntimeLifecycle.stop 断开全局信号 | 必须由实际关闭路径调用，单测不证明 KWin wrapper 回收 |
| FocusRingController.watched / closed | O(当前被观察窗口 / 暂待模型删除的窗口)；每窗9类信号 | closed 回调断开该窗信号并移除 watched；membershipChanged 移除已不在 columns 的 closed wrapper；stop 清空并断开 | 新增5000次 close / model-remove / stop 模型回归；销毁后属性访问设为抛错，检查残留 watcher / tombstone / 状态数量 |
| WorkspaceSnapshotStore.snapshots / uuidOwner | O(真实桌面 + 保存列)；纯 UUID / 宽度 / 锚点，无 Window 引用 | removeWindow 重建并归一化 dangling 引用；remove 同时清 owner；clear；WorkspaceMountController.pruneSnapshots 校验真实桌面 / 窗口 | 新增5000次窗口删除、快照回收模型回归；Bridge 保存文件规模另见基线 |
| WorkspaceTransferController.closedUuids | 最多4096个 UUID 字符串，O(1)上限 | 超限删除最旧项；实例卸载后回收 | 历史 tombstone 是有界安全防护，不为微小节省取消；stop 仅禁用控制器 |
| ScrollPlanCommitGate | pending / activeEpoch 单份；retainedEpochs、disarming、idleCallbacks 跟随未完成操作 | schedule 清旧timer；cancel / releaseForWorkspace 清 pending；ACK或150ms期限 finish 删除 disarming、清timer、排空 idleCallbacks | M1曾发现失联callback保留请求；后续单列居中开发已补期限回收，5000次丢失/迟到ACK模型通过。仍先发送cancel并等待ACK或既有有限fallback期限；PSS收益未测 |
| DeferredScrollParking | 一个 pending batch，O(相关列)；最多 poll / watchdog / rescue timer | pause / release / cancel 清 timer；回调验证 pending身份、session / workspace / output / epoch；3500ms watchdog + 150ms rescue | 保留完成后 partial clip，无timer / repaint；压力与真实D-Bus延迟验证待做 |
| Rust Core / FFI | Spring / frame clock / workspace 曲线O(1)；Scroll几何、WindowRegistry O(已注册存活窗口) | Rust remove 删除几何与注册名；C++ windowClosed / windowDeleted 调用 remove；RAII 析构destroy handle；workspace binding finish释放 | clear 清几何但保留registry / 容量，不能把 clear当作注册表完全释放；observer token仅单条消息使用 |
| Rust Ring eligibility | windows最多256；retired_sessions最多256；协议≤256KiB；context字符串各≤128 UTF-16单位 | 新快照替换 membership；clear / handle destroy释放；达到 retired session 上限 fail closed | 有界authority；不得删除 tombstone来降低开销 |
| Native Clip runtime / handoff / departures | runtime + handoff必要ownership；departures按未完成工作区保存 | close / delete 移除窗口；fullscreen owner idle 清 departures；clearScrollState释放当前ownership；析构恢复marker | 连按期间 departures 峰值与长期收敛未实测 |
| Native Clip paint routing | 固定32个paint pass；debug deviceClip key最多256 | clear / 最后窗口退出时清日志key；debug MAP默认关闭 | 保持坐标、clip、Ring共用既有时钟；CLEAR为事件日志，不能仅凭数量断言每帧日志或掉帧 |
| Scroll capture | 内嵌frames2048、presentation2048、lifecycle128；10秒或容量截止 | 新capture重置计数；expire / truncated停止记录；effect析构释放 | 即便关闭也保留内嵌数组；实际sizeof与收益判断见补充探针数据 |
| Workspace frame / motion capture | 每输出512 timestamp，16 desktop事件；adapter512 state records；3秒截止 | begin重置；deadline停止记录；frameConnections在screenRemoved断开、samples移除 | 固定诊断成本可测；未以一次buffer大小冒充PSS或纹理开销 |
| Native Focus Ring visuals | O(当前owner + 必要fade-out窗口)；paint pass固定32 | removeWindow / fade retired / clearRing释放Item；window close/delete、桌面/输出变化触发清理；QObject自动断开destroyed连接 | GetFocusRingStatus只暴露当前visual / 累计光栅化次数，未导出真实纹理bytes与Qt连接数量 |
| Ring small patches | steady glow + 可选gain glow，每份8个ImageItem；可选compensated stroke 8个；角patch + 一像素边缘gradient | metrics/color不变复用image；gain完成隐藏并按owner复用；FocusRingItem.clear删除stroke/gain/glow/border/root/damage | 无新增窗口大小QImage / render target；`glowRasterizations`累计次数不是当前纹理数；实际GPU bytes不可准确归因 |
| Bridge state / IDs / commands | state UTF-8 ≤1MiB，普通pending最多64，recent ID/order最多128；UTF-16与解析临时对象另算 | session变更清queue / recent IDs / motion token；dequeue消费；QObject析构释放 | 64仅约束普通命令：紧急恢复允许prepend超过上限，保留恢复优先级；不得宣称所有队列严格64 |
| Bridge deferred timers | delay限定16–1000ms，回调捕获json / session | QObject上下文销毁撤销；到期检查session / generation，stale不提交 | RequestDeferredCommand无显式pending数量或payload长度上限，timer admission需要隔离压力测量；目前不是实机泄漏判定 |
| Optional Dock | tasks model / managed UUID / 单份状态；QML对象生命周期 | DBus reply显式destroy；service / signal watcher随QML销毁；状态按当前快照更新 | 当前桌面配置存在com.cc.scrolltasks；关闭JS集成不等于卸载Plasma UI。Dock增量需要B1/B2隔离；200ms taskInit timer触发后destroy，不是永久轮询 |

## 优先级、预计节省与变更风险

1. **P0，待重现：Bridge admission与失联ACK。** 普通queue上限不覆盖紧急恢复，deferred timer没有数量上限；ScrollPlanCommitGate失联callback可能保留请求/闭包。当前只证明源码存在缺少上限/本地回收的分支；没有量化日常PSS成本。须在隔离DBus或模型中构造故障、统计对象与内存，再决定修复；预计节省 `NOT MEASURED`。更改恢复/ACK语义有窗口不可见风险。
2. **P1，待验证：输出历史barrier。** `m_workspaceBarriers`按LogicalOutput*插入；当前screenRemoved路径未见对应remove。重复输出对象创建可能留下旧key，也有地址复用问题；不得为了重现擅自热插拔用户输出。用隔离QObject / adapter fixture检查后再优化，收益 `NOT MEASURED`。
3. **P1，可量化：诊断常驻数组。** 运行sizeof探针区分ScrollFrameCapture、workspace motion records与per-output timestamp容量；任何lazy方案只在StartCapture分配、保留导出结果语义，不在paint分配。内嵌size是上界/对象布局证据，PSS收益仍未知；几十到几百KiB不足以独立证明值得冒渲染风险。
4. **保留现状：Ring小纹理、UUID快照、有界tombstone和注册表关闭清理。** 已有模型证据与清理路径，暂未看到需要新增全屏缓存或替换authority的理由；长时间实机收敛仍待验收。

## 验证范围

### 固定诊断布局探针

独立临时Release C++20探针通过共享`cmake/CCNiriToolchain.cmake`选择和检查`/usr/bin/g++` GNU 16.2.1，未改仓库CMake / FFI / Native生产代码。直接包含当前`ScrollFrameCapture.h`和`cc_niri_native_core.h`；workspace record用与Adapter同样的`{ CcNiriWorkspaceState state; int64_t at; uint32_t output, kind; }`字段布局计算，不冒充整个WorkspaceSlideAdapter对象大小。

| 项目 | sizeof / payload bytes |
| --- | ---: |
| ScrollCaptureFrame | 144 |
| ScrollCapturePresentation | 16 |
| ScrollCaptureLifecycle | 80 |
| ScrollFrameCapture（含数组、计数、padding） | 338008 |
| CcNiriWorkspaceState | 280 |
| workspace record字段布局 | 296 |
| 512个workspace motion records | 151552 |

原始数据：[capture-sizeof.json](memory-data/20261013/capture-sizeof.json)。Scroll capture约330.086KiB，workspace records148KiB；合计489560 bytes，约0.467MiB，另有每已采样输出4096 bytes timestamp payload和容器开销。内嵌数组默认初始化，源码证明对象空间始终存在；实际resident page与可回收PSS节省 `NOT MEASURED`。不能把对象size、heap allocation、GPU bytes和PSS当作同一指标。

本轮保留现有存储。lazy化最多减少上述候选payload的日常对象空间；需要维持主动开始时一次分配、采样截止后仍可导出的语义，真实节省须通过受控A/B确认。当前收益证据不足，不进行M2重构。

JS / bundle完整门禁、新增5000次模型回归、Release临时sizeof探针结果见 [阶段结果](CC_NIRI_GLOBAL_MEMORY_RESULTS.md)。模型只检查相应公开操作后的状态/连接收敛，不检查真实KWin生命周期或allocator页面归还。没有修改`src/`，不重生成或手改bundle。

M2暂不改生产内存路径：当前缺少可归因B0/B1、KWin PSS访问和优化前后对象/纹理数据。M3的30–60分钟idle/交互、真实窗口开关、断连、热插拔、Dock切换与低内存场景保持Pending。README状态未更新，不声称总预算或人工卡顿已经验收。

后续单列居中开发更新：上表 ScrollPlanCommitGate 的取消期限已修复并通过模型与完整门禁；本篇其他“未改生产路径”描述记录 M1 当时范围。该修复不代替受控 PSS、真实 Qt/D-Bus callback 和 GPU 收敛测量，见[单列居中结果](RUST_NATIVE_R7_SINGLE_COLUMN_CENTER_RESULTS.md)。

## 2026-10-15 Scroll Layout V2 P1 账本补充

本阶段仅增加默认关闭的配置和离线纯几何/模型能力；生产入口保持 V1，未部署。
`RuntimeConfig` 的两个标量、Store/WidthController 模式标量及 WorkArea provider 为 O(1)。
`ContinuousColumnLayout` 推导时创建 O(当前列数) 的数值结果，模块不保留列/window 或历史结果；
focus target 只做数值运算，暂无每帧调用。没有新增 timer、服务、线程池、IPC callback、图像、纹理、FFI handle。
这些是源码账本，模块加载成本、堆驻留量和整套桌面增量未测；不能据零新增纹理/时钟宣称低内存达标。
PSS、Private_Dirty、对象/纹理计数、帧时间、GPU 归因和30–60分钟斜率均 **NOT MEASURED**，
需后续启用 V2 的 Release 同负载 B0/B1/feature A/B。范围、验证和回滚见 [P1 阶段结果](SCROLL_LAYOUT_V2_P1_RESULTS.md)。

## 2026-10-15 Scroll Layout V2 P2 账本补充

P2 控制器使用现有 ColumnStore 和 LayoutTransaction，main 尚未构造它。实例仅保留一个 active scope、
单份 latest intent 和其中 O(当前幸存列) 的已验证数值 pose，无窗口对象副本、历史队列或按工作区增长的存储。
字段为已有列上的稳定 UUID 与少量 scope/sample 标量；事件临时 Map/Set/派生数组退出后释放。
stop 清空模型列、输出引用、intent/source/geometry；2000次插入/关闭只验证模型收敛，
不证明真实 Qt/Scene/FFI/GPU 回收。测试 observer 历史仅在 test helper，不进入生产。
新增服务/线程/timer/动画时钟/图像/纹理/FFI handle均0；内存、Private_Dirty、对象计数、帧时间、GPU和长测均 **NOT MEASURED**。
预算保持Pending，见 [P2 结果](SCROLL_LAYOUT_V2_P2_RESULTS.md)。

## 2026-10-15 Scroll Layout V2 P3 账本补充

P3 复用现有 Clip InputEventFilter、Rust Scroll runtime、Bridge command pump、Spring 和 presentation clock。
新增服务/线程池/动画时钟/生产图像/纹理/全屏缓冲为0；私有探针 PNG readback 只在显式有界测试中使用。
Rust 输入为 pointer/touch/tablet 各32个固定 slot 与少量 frame/overflow 标量，clear 不丢 consumed pair；
normal release/frame、touch cancel 归还有界状态。tablet overflow 保持 fail closed，不伪造设备 idle。
数值 target/source/role/retained outgoing 仍按真实存活窗口 O(N)，observer 临时 token 不跨消息保留。
Native 的 interactiveMoveResizeStarted 新连接按存活窗口 O(N)，QObject 销毁/receiver 卸载释放；
这些连接在默认关闭下的加载成本也须计入，尚未做 A/B，不宣称为0。
Bridge 新增一个 D-Bus signal match 与若干 latest wire 标量，沿用64个 pending /128个 recent ID 的原有上限。
JS envelope 在事件时临时创建；partial Gate 的 callback/timer 使用原150ms边界，5000次失败模型收敛，
不能替代实际 Qt/D-Bus callback/allocator 页面归还证据。无每帧 JSON 新路径。
组件路径诊断使用事件级 dladdr，不扫描 ELF、访问 /proc 或保留文件系统缓存。

Rust 10000次 frame/projection/input 查询通过零堆分配断言；C++ Region/Qt draw 热路径分配 **NOT MEASURED**。
整套 Release B0/B1 PSS、Private_Dirty、对象/纹理计数、帧时间、GPU 归因、长时斜率均 **NOT MEASURED**。
预算继续 Pending；[P3 结果](SCROLL_LAYOUT_V2_P3_RESULTS.md) 的虚拟 KWin 通过不作为全项目低内存验收。

## 2026-10-15 Scroll Layout V2 P4 JS 事务账本

新增 ColumnGeometryPlan 只在布局事件生成最多256行的有界数值 DTO，临时 Map/Set 不跨消息缓存。
ColumnGeometryClientGate 仅在未来 Native Arm ACK 后持有一份当前请求的 O(N) 客户端引用/监听；
当前 main 未构造它。复用 ScrollPlanCommitGate 的 arm/cancel timer，配置与完成等待为一次性有界期限，
不以 timer 采样动画或轮询。成功、异常、关闭、替换、workspace release、cancel 和超时释放监听；
2000次模型失败后 timer/监听归零，不代表 Qt/D-Bus 或 allocator 实测收敛。
GeometryCommitter 的可选批次 guard 为函数参数，旧三参数路径不新增 options 对象。
新增服务/线程池/动画时钟/图像/纹理/FFI handle 为0；模块加载成本和整套项目内存均 **NOT MEASURED**。
PSS、Private_Dirty、GPU、真实对象/纹理、帧时间与长测继续 Pending，见 [P4 进度](SCROLL_LAYOUT_V2_P4_RESULTS.md)。

### P4 Rust/Bridge 增量

新增列几何 validator 与数值组件；组件尚未由场景运行时构造。构造后按当前列数 O(N)、最多256行保存
两个相对 offset 的解析 motion、待绘制/已绘制 pose、ACK 与可查询降级 decision，不保存 QObject、纹理或历史操作。
Camera/时间仍由原 owner 传入，无新增动画 timer。Bridge 共用原 observer handle/sequence；
typed DTO 的临时 vector/集合、最多256KiB fingerprint 均有界，token 在拒绝路径也清空。
10000次共享帧数值查询零堆分配为 Core 局部测试，不证明 Qt/Scene/全项目成本；
Release B0/B1 PSS、Private_Dirty、GPU、对象/纹理、帧时间和长时增长仍 **NOT MEASURED**。
参见 [P4 Native 结果](RUST_NATIVE_R7_SCROLL_LAYOUT_V2_P4_RESULTS.md)。

P4 同批补充：P3 active runtime 在 arm 时为当前 owner 分配逐客户端 paint 数值账本，
每行保存列 ID、actual frame/visual、velocity、epoch/time/serial；不保存 Qt 对象或历史记录。
每次真实 draw 更新既有行，remove/clear/cancel/context 退出清理，retarget 重建当前有界行。
Core 10,000次更新/查询/完整性检查为零堆分配。source JSON 只在显式 D-Bus 查询时临时创建，
没有采样 timer 或后台服务；C++ paint 与整套 PSS/Private_Dirty/GPU/长测仍 NOT MEASURED。

### P4 完整 runtime / 场景 / 协调器接线（取代上述增量的未接线状态）

现有 Scroll handle 内增加实际列过渡、paint/cull、ACK 及单份 observation lease，均按当前列数 O(N)、最多256行；lease 在事件查询替换，remove/clear/cancel 失效，不保存逐帧或逐操作历史。两个相对 X/Y 数值曲线使用既有 camera 的 presentation timestamp，没有额外动画时钟。closing 表仅覆盖 KWin 尚存的删除 surface，windowDeleted 回收。workspace 冻结副本沿用原 handoff 生命周期，不引入图像或纹理。

C++ postPaint 新增固定256行标量栈缓冲；tracked ID/QPointer 在 ownership 事件更新，弱引用不延长窗口 lifetime。新增 frameGeometryChanged 连接按存活窗口 O(N)，QObject/receiver 销毁释放；默认关闭时这类模块与连接的加载成本也不能算0。完成/source-ready 只在请求或首次完成时排队导出 JSON，无 idle timer、持续 capture 或每帧日志。

JS ColumnGeometryCoordinator 保留单份 intent/source、当前 ACK 监听与有界 arm/configure/source/cancel 期限；替换、workspace departure、失败和 stop 释放订阅，stop 清空源/intent 与 command handler。Bridge 只新增两个信号订阅及当前 scope 元数据，仍用原64条 pending、128条 recent 的 command pump。私有 fixture 的20ms控制命令 pump、PNG readback 和故障注入不进入生产模块。

没有新增常驻 daemon、线程池、生产动画时钟、FFI handle、图像/纹理或全屏缓冲。Core 10,000帧 shared paint/cull/projection 零堆分配、模型和私有 KWin stop 监听/timer归零为局部证据；Qt draw 分配、真实 Qt连接/Scene对象/纹理稳态、allocator驻留均 **NOT MEASURED**。整套 Release B0/B1 PSS/Private_Dirty、GPU归因、4K60和30–60分钟斜率仍 **NOT MEASURED / Pending**。见 [完整 P4 结果](SCROLL_LAYOUT_V2_P4_RESULTS.md)，不能用功能通过或默认关闭替代总预算验收。

### 2026-10-16 P5：完整主入口与持久状态账本

P5 已接入完整生成 main，取代 P4 阶段“主入口仍未接线”的状态；V2 默认关闭且未部署。复用现有 ColumnStore、LayoutTransaction、P2 和 P4；没有第二套模型或帧时钟。新增 `widthV2`、signed anchor/basis 和 dormant V1 偏好只包含按真实窗口/工作区数量增长的稳态标量。Bridge 仍限制1 MiB、每工作区最多256列；不会存储帧/指针/ACK历史。

完整宿主的 departure Map 合并同窗口事件、上限512，在取消确认后清空，stop 清空；复用原 ACK/configure/source/cancel 一次性期限。新窗口/输出连接交给既有 RuntimeLifecycle，关闭与输出拓扑重连时先断开，stop 统一释放；模型验证20次拓扑事件不会增加连接，关闭减少连接。透明 configure 准备复用 ParkingManager 状态，同时保留用户原最小化偏好，恢复后释放所有权标志。这些是局部生命周期证据，不是 Qt allocator 或全项目 PSS 实测。

新增常驻 daemon、线程池、生产动画时钟、图像/纹理/全屏缓冲、FFI handle 为0。私有测试的有界命令 pump/readback 不进入生产。完整 Release B0/B1 PSS、Private_Dirty、实际 Qt/Scene对象与纹理、GPU归因、4K60和30–60分钟斜率仍 **NOT MEASURED / Pending**；不以默认关闭、功能测试或私有 stop 代替预算验收。见 [P5 结果](SCROLL_LAYOUT_V2_P5_RESULTS.md)。

### 2026-10-16 P6 恢复证明账本

JS RecoveryCompletionGate 仅在恢复时保存按当前窗口数有界的 Set、信号 disposer 和一个3500ms deadline，完成/关闭/超时清空；无周期采样。Bridge 当前恢复状态≤4096bytes，不写持久快照，session切换清空，无历史 ACK 缓存。CLI轮询只在显式stop运行。prepare/分析/备份均为离线一次性工具，无新daemon/线程/纹理/FFI handle/动画时钟。实际Qt/Scene/纹理、GPU及整体PSS仍 **NOT MEASURED**，M1账本不等于M3通过。

### P6 顶栏避让修复

可见边缘面板的rect数组只在布局事件中构造，不保留额外窗口缓存。隐藏/最小化信号复用RuntimeLifecycle，每个当前dock窗口最多新增两条连接，关闭/stop按owner释放；没有新增轮询、timer、时钟、Native句柄或纹理。纵向客户端网格为有界算术。详见[修复记录](SCROLL_LAYOUT_V2_PANEL_FIX_RESULTS.md)；真实PSS/Private_Dirty、对象/纹理/GPU与长期增长仍NOT MEASURED。

### 2026-10-23 平铺圆角兼容账本

CLI 新增两项有界的原值/缺省标记，start/stop 同步应用和恢复；无新服务、线程、timer、时钟或 Native 对象。第三方 Rounded Corners 对平铺窗口恢复 OffscreenEffect redirect，可能新增其已有路径的窗口尺寸 render target，属于整项目功能依赖成本。以两扇 1256×1364 logical、150%、单份 RGBA8 估算约 29.41 MiB，仅为容量估算，不含 shadow/格式/缓存，不能当作实际显存或 PSS。复用现有特效的架构取舍及限制见 [修复记录](RUST_NATIVE_R7_ROUNDED_CORNERS_RESULTS.md)。真实纹理数量/大小、关闭后 GPU 回收、30–60 分钟收敛均 **NOT MEASURED**；M1/M3 Pending。
