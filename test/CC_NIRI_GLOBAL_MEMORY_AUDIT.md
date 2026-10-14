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
