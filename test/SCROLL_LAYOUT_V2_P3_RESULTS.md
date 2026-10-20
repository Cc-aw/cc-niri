# Scroll Layout V2 P3：Native Partial / Input / ACK

日期：2026-10-15；基线 HEAD `8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e`；
分支 `scroll-layout-v2-p0`。本阶段保留 P0/P1/P2 与用户规范，工作树未提交。

**状态：P3 同尺寸 camera/partial 核心、隔离集成与完整离线门禁 PASS。V2 仍默认关闭，未部署。**
本报告覆盖 [规范 P3](../doc/done/cc-niri_Scroll_Layout_V2_Implementation_Spec.md) 的
same-size camera / partial 核心。生产 main 保留 V1 composition；V2 模块的实际接线须等待
P4 typed geometry、P5 persistence/recovery 和 P6 用户实机验收，手动改配置也不启用完整 V2。

## 契约与边界

新增独立 `PARTIAL_SCROLL`，wire `protocol:3`；“Scroll Layout V2”是功能版本，3 是该新消息的版本。
原 `SCROLL` protocol2、`COLUMN_REINDEX` 和冻结 C++ Golden 的 schema/行为不放宽。
已有 membership PublishState ACK → typed motion ACK → Native Arm ACK → JS geometry/activation 次序保留。
`RuntimeBridge` 为新消息保留 protocol3，快照仍沿用原 protocol2；没有另建 IPC 服务。

- `viewport` 严格表示实际 OutputRect，`layoutRect` 单独承载 WorkArea + gap 后的布局矩形；
  Native 还校对 KWin 实际 output。Rust 校验 session/workspace/output/epoch、scope revision、
  finite / safe range、唯一 ID、列区间、尺寸、placement 和已有共享 sequence。
- 真实 frame 的 x 为 visual x 在 `[output.x, output.right-clientWidth]` 的安全锚定；
  保留 client width/height，不把 partial 缩成可见切片，也不将真实 frame 放到邻屏。
  Rust 精确校对客户端尺寸；未 ACK / 未接管几何不以 `near` 容差假装完成 resize。
- 绘制先与 OutputRect 的 device region 及实际 viewport 相交，再进入现有 decoration/Ring context；
  Ring/shadow outset 无法把 damage 重新扩到输出以外。
- 复用现有 Rust ScrollViewportRuntime、唯一 Spring 和共享 presentation frame；
  partial 支持 smooth60 原参数、速度继承及有界反向 brake，不另设 Ring 或视口时钟。
  `GetPartialPaintedState` 在真实输出 paint pass 标记后才有效，导出共享 painted camera 的数值投影；
  它不是每个被遮挡/尚未 ACK 客户端的 GPU 绘制证明，P4 仍须完善 resize/configure 生命周期。
- 新 partial arm 验证后平台几何失败仍消费 epoch，但不能借较旧 active motion 给重复失败请求返回成功 ACK。
  retarget 遗漏的存活 owner 继续以 outgoing 保留直到 park/close/disarm，避免突然暴露真实锚点。
- P3 producer 只接受初始 stationary hydration 或同 basis / 同尺寸且有观测的 camera 目标。
  宽度、成员、移列重排及需要经过 parked-only 中间客户端的长跳转交给 P4；本类型拒绝这些目标。
  初始 hydration 也需调用方先在隐藏/安全状态准备尺寸并取得客户端 ACK，不能先越界显示。

## 输入与提交

采用用户接受的安全两次点击。Rust 使用固定容量 pointer/touch/tablet 配对状态：第一次完整吞掉 press/release，
Native 只发 scoped focus intent，经 Bridge 原有有界 command pump 转为 `focus-partial-column`，
由可选的 JS V2 controller 处理 camera 和 activation。Native 不激活窗口，不注入客户端点击，不修改布局 authority。

Adapter 观察原生 popup/input-method、modal、拖放、窗口选择、桌面/锁屏、交互移动和真实命中；
原生已转发的 grab 保持其完整配对。实际命中遮罩只作用于平台会命中的窗口，并保留既有 visibility ref / restore。
原生最后一个 release 在交给 Seat 后、input frame 结束前仍受 Rust 保护；geometry/lifecycle refresh
不会把临时隐藏状态留到同一个 JS activation 调用。这两项均有隔离回归证据。

cancel、retarget、窗口关闭和 context clear 不丢弃已吞掉的输入配对；matching release 或 touch cancel 清理。
pointer/touch/tablet 各32个 slot，overflow 有界且 fail closed；tablet overflow 不以单个 proximity leave
冒充全设备 idle。真实 tablet / 设备移除仍待硬件验收，不能据模型通过宣称支持所有设备。
`PartialNativeInteraction` 释放被原生用户拖动/调整窗口的投影并报告事实，JS 仍负责 floating/recovery；
完整交互移动及跨工作区恢复属于后续实机矩阵。

`ScrollPlanCommitGate` 对新类型要求 Native 成功才 commit。拒绝、超时、过期回调、cancel 失联均不执行
static partial geometry 或激活；有界结束 callback 并把结果交回 JS recovery。
V1 原来的150ms fallback 和回归规则保持原样。

## 隔离集成证据

[探针](../tools/scroll-layout-v2-p3-probe.py) 启动独立 D-Bus、临时 XDG、两个虚拟输出和 Mesa OpenGL KWin，
加载工作区 Release Clip / Bridge / Ring。通过 `dladdr` 的事件级组件路径诊断确认实际加载的两个插件，
并记录对应产物 SHA；不以安装文件 SHA 冒充用户桌面当前 ELF。
复用 P0 fixture **仅做原生输入重定向与显式 readback**，P0 projection entries 全程为空；
未使用 P0 的输入/绘制模型替代生产实现。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| 100%，双虚拟输出 | PASS 31/31 | [report](scroll-layout-v2-p3-evidence/20261015/native-100/report.json) |
| 150%，双虚拟输出 | PASS 31/31 | [report](scroll-layout-v2-p3-evidence/20261015/native-150/report.json) |
| 150% + 私有 Fcitx5/Pinyin | PASS 34/34 | [report](scroll-layout-v2-p3-evidence/20261015/native-150-fcitx5/report.json) |

检查包含左右 partial、完整副屏 framebuffer 黑屏、无真实锚点 ghost、同尺寸 client ACK、Native arm 前置、
第一次点击无客户端 button/无 Native 擅自激活、Bridge focus relay、第二次原生点击坐标 `(112,234)`、
wheel/touch、完整多按钮 implicit grab、popup/modal/真实 Wayland DnD、取消+关闭时 held pair 释放、
真实 Ring 共享帧与副屏隔离、实际 painted frame 的反向起点及非零速度继承。
Fcitx5 候选窗覆盖邻列时点击保持原生授权，并实际提交中文。
短 idle 检查仅确认 Scroll continuation repaint 计数不增长，不作为整个项目 idle/PSS 验收。
PNG、Wayland client log、D-Bus signal、motion capture、实际插件路径和 SHA 均在相应证据目录。

最初像素探针错误地把 ShapeCorners 的一像素边框当作纯色客户端采样，已改为内容区及完整副屏检查；
[原始初次结果](scroll-layout-v2-p3-evidence/20261015/initial-pixel-boundary-attempt.json) 保留为被替代证据。
多按钮最后 release 丢失是生产问题，已修复并用最终四个客户端按钮事件、Core release-frame 测试回归。

## 离线验证

| 检查 | 结果 |
| --- | --- |
| 生成包 / 全量 JS | PASS，112个文件 / 171项 Node，含7项新 P3 契约及5000次 callback 收敛 |
| Rust 1.99.0 fmt / locked clippy / locked workspace test | PASS，82项单测；新增7项 partial runtime、3项输入配对和1项 FFI |
| 完整 `node tools/check.js --native` | PASS；Bridge 18、Clip 18、Ring 25项 CTest、独立 bus 新/旧兼容、Plasmoid 构建 |
| Native Core Debug / Release | PASS，各13项 CTest，包含原 Golden differential 和 FFI 契约 |
| Native umbrella Debug | PASS，30项 CTest |
| Release `BUILD_TESTING=OFF` Native + Bridge | PASS，两插件与 Bridge 构建，无 reference target/旧算法符号 |
| 工具链 configure 拒绝 | PASS；GNU16通过；GCC15/17、非GNU、非指定路径由既有 metadata fixture 拒绝；Rust/Cargo1.98负向版本 fixture 在 configure 拒绝 |

CMake 全部显式 `/usr/bin/g++` GNU16.2.1，顺序构建 `--parallel 2`；Cargo 全部 locked，未改 lockfile。
真实 grab 失败后的最终代码重新跑完门禁，未把前一次构建通过当作最终结果。
[完整门禁日志](scroll-layout-v2-p3-evidence/20261015/native-gate.log)、
[构建矩阵命令/结果](scroll-layout-v2-p3-evidence/20261015/build-matrix.json)、
[版本、SHA、安装未变与验证摘要](scroll-layout-v2-p3-evidence/20261015/verification.json)。

## 未验收项、资源与回滚

- 用户桌面的4K60/150%+2K60/100%、真实丢帧、混合 DPI、tablet、热插拔、effect 在 held input 中被强制卸载：**NOT MEASURED / Pending**。
  安全 stop 必须在已吞掉输入排空后再卸载；不能用本次 cancel/close 通过替代 P6 stop/restore。
- 宽度循环/结构变化与 client configure、长跳转中间列、完整 V2 main 接线：**Pending P4**。
  持久化版本、开关迁移、工作区/Fullscreen/Secondary 全兼容：**Pending P5/P6**。
- 全项目 Release B0/B1 PSS、Private_Dirty、对象/纹理计数、GPU 归因、帧时间与30–60分钟斜率：**NOT MEASURED**。
  Core 查询/输入零堆分配测试不代表 C++ paint 或全项目零分配，不代表16/32/64MiB预算达标。
- 无新增服务、线程池、动画时钟、窗口/全屏缓冲或纹理。新增状态按存活窗口 O(N) 与固定 slot 有界；
  新的 window interaction 信号连接也须计入整个项目资源账本，不能忽略 default-off 模块加载成本。
- 当前仅本地构建/隔离加载；安装的 main/Bridge/Clip/Ring SHA 与 P2 基线相同，未执行 install/start/stop。
  保留默认 `ScrollLayoutV2Enabled=false` 和现有 V1 composition 即可继续使用原桌面。
  当前没有部署需要回滚；将来部署必须走配套组件快照的 save-state → stop → immutable install → start，
  不单独替换某个 FFI/Native 二进制，也不把删除混合工作树当作回滚。
