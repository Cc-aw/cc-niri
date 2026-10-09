# Rust Native 后续 Animation A3 验证记录

日期：2026-10-09，分支 feat/animation-60hz。基线为 A2 报告提交 667d5d369c323fb5ab91ebb7737a240f54ff366f；用户确认 A2 可行并要求下一阶段。本轮仅实现 A3 的 J/K 有限轨迹接管；A4/A5 与 Focus Ring F1–F5 未实施。延续此前部署授权与减少重复测试的要求。

## 行为与边界

- 仅 OptimizedWorkspaceAnimation 已启用且 AnimationProfile=smooth60 使用新策略。stable 保留零初速度、原 rest-to-rest quintic 算术与时钟拒绝契约；无效 profile 仍回退 stable，不自动启用工作区优化或更改 Slide。
- Rust WorkspaceMotion 保存解析 cell 位置 / 速度 / 加速度。Adapter 在非空窗口绘制链实际使用 projection 后 mark_painted；未绘制的 advance 不是接管锚点。同帧多次目标使用同一 painted anchor。smooth 控制事件落后于预计采样时间时，起点时间取 event 与 painted 时间的较大值；stable 保留原 Adapter 时间处理。
- 单次静止起步仍为原 quintic smoothstep。普通接管先尝试带 v0/a0、终点 v=a=0 的五次轨迹；所有段保持原 WorkspaceDuration（默认 420ms，配置 240–800ms）。终点显式写入目标与零导数。相同目标保留原曲线 / deadline，仅更新 epoch。
- 起段检查等价 Bézier 凸包，最多 12 层有界细分，不能证明时保守拒绝；导数 Bernstein 符号变化上限 1，禁止二次摆动。限制走廊为起点 / 终点范围加最多 0.02 cell，再与非 wrap 硬 grid 相交。不在每帧求根、采样证明或 clamp。
- C2 不可行时先尝试保留 v0、丢弃 a0 的 C1 五次曲线，原因 acceleration；仍不可行时用常减速度 C1 制动，最多 50ms / 0.02 cell，并从剩余原时长内的零导数 quintic 收尾。制动起点和拼接只声明 C1，不声明 C2；硬边界无空间或非法数值明确 reset，保留位置并记录原因。0.02 是 workspace cell 工程起点，不把窗口 px 速度写进工作区 motion。
- grid / wrap 最短路径、每输出独立 handle、gesture release/cancel 保持；手势没有新增速度估计，释放可为零速度。配置 / 对象变化失效 anchor。JS 布局、工作区选择、focus、barrier、Wide 冻结与 park、Ring authority 没有迁移或复制。

## Adapter / FFI / 测量

新增窄 start_with_policy、mark_painted 和 state C ABI；原 start 是 stable 入口。280 字节值 DTO 提供当前与初始 / saved 导数、每轴策略 / 原因、制动参数与当前 binding 的计数；NULL / 无效 flag 有明确返回，查询不读时钟、不分配。平台只传 flag、时间、geometry，持有可见性引用并绘制，不实现曲线 policy。

GetScrollMotionStatus 增加 workspaceMotion 与有效 workspaceRetargetPolicy。workspaceMotion.liveBinding 区分现存 motion 和退休前最后状态；其计数属于该 binding，不当作全会话累计。既有 GetWorkspaceFrameCapture 字段保持，附加独立 version 1 motionCapture：默认关闭，最多 3 秒 / 512 条 POD，截断显式标记，JSON 只在查询时生成，没有 timer 或额外 repaint。tools/analyze-workspace-capture.py 离线区分控制 arm、实际 paint、策略与呈现观测，旧 A2 capture 读取通过。呈现仅按输出关联，不构成 paint-to-present join。

## 自动验证

Rust/Cargo 1.99.0，/usr/bin/g++ GNU GCC 16.2.1；Cargo 均 --locked，构建 / CTest 并行上限 2，门禁顺序执行。未改 Cargo.lock、CMake、src 或生成包，冻结 reference 未修改。

| 项目 | 结果 |
| --- | --- |
| cargo fmt --all --check | 通过 |
| cargo clippy --locked --workspace --all-targets -- -D warnings | 通过 |
| cargo test --locked --workspace | 47 项通过 |
| node tools/check.js --native | 100 JS；Bridge 17 / Clip 16 / Ring 23 CTest；5 组隔离 D-Bus、Plasmoid 与生产符号审计通过 |
| Core Debug / Release CTest | 各 12 项通过 |
| Native umbrella Debug CTest | 27 项通过 |
| BUILD_TESTING=OFF 两插件 / Bridge | 构建、生产符号审计通过，target help 无 reference / differential |
| 编译器拒绝 | CTest fixture 拒绝非 GNU、GCC15/17、错误路径；独立 configure 元数据 fixture 拒绝 Rust/Cargo 1.98.0，未用其他 Rust 版本构建 |

新增检查覆盖 20/80/180ms 同向 / 反向、多格、paint/pending、同帧目标、同目标 deadline、事件落后于 prediction、wrap / 单格 / 无移动、gesture cancel、不同输出逻辑尺寸的投影与零分配。独立 long-double 边界代数 oracle 对照生产 C ABI 的位置 / 速度 / 加速度、分段制动和 exact finite completion。另以 Bernstein/de Casteljau 表示交叉对照 Horner 采样，不用同一公式照自身。原 JS Wide pose 20/80/180ms 两侧冻结、返回 / stale completion、fullscreen/barrier/可见性清理 fixture 随完整门禁通过。

首轮定向导数测试使用极小有限差分导致浮点消减误差，改为独立 Bernstein 导数对照；首轮插件构建发现 int64/uint32 到 Qt JSON 的重载歧义，增加显式转换。最终完整门禁均通过。命令、退出码、用时及日志在 build/animation-a3/results.json 和 additional-checks.json。

## 部署与实机

自动门禁完成；部署与一次短 J/J→J/K、Wide 中途返回、H/L Ring、fullscreen / off-on、运动中关窗 / profile 清理、安全 restart / idle 的实机结果待记录。未执行项目不标记通过，A3 人工手感待反馈。

## 性能与限制

包络规划只在事件路径，采样与 FFI 状态查询常数复杂度 / 零分配。尚无受控 A/B、编译负载或 GPU 时间测量；不宣称实际屏幕任意时刻严格 C1/C2、输入到面板延迟改善或长期 P99 达标。C2 与 C1 / reset 分轴报告，制动不增加配置时长。没有降低共享 Spring 刚度、工作区时长或缩小 H/L damage。

热插拔、实机 100/125/150/175/200% 完整矩阵、惯性手势和长测不属于已完成项。此前 A1 长循环一次 focus preparation 失败原因仍未查明；本轮不把脚本或数值检查当作该问题已解决。

## 回滚

行为回滚使用 AnimationProfile=stable，经既有安全 reconfigure / 生命周期应用，仍为 Rust。组件回滚保存部署前 A2 immutable Clip 绑定及配置键原值，先安全 stop 恢复 parked windows，失败即停止，再恢复绑定 / start。完整工作区快照仅供故障调查，不覆盖用户之后操作。代码使用独立 A3 提交 revert，不 reset、stash 或修改两个用户未跟踪 todo 文档。外部恢复入口仍为仓库 ./cc-niri stop。
