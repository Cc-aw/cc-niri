# R7 后续动画 A4：60Hz Scroll 参数与物理像素收尾

日期：2026-10-09。分支：feat/animation-60hz。基线：3216cf3（A3 已部署）。

本阶段仅调整普通 smooth60 H/L，Rust Scroll policy 使用 stiffness=600、mass=1、damping_ratio=1，视觉阈值为 0.25 physical px。stable 默认与全局 SpringParams::default() 保持 800 / 原数值 epsilon；JS 绘制的 Pair/Wide clip companion 保持原参数和完成条件；J/K 保持 420ms。没有修改 JS schema、布局 / 工作区 / 焦点 authority、Ring 外观、时钟来源或 repaint 范围。

## 实现与完成边界

- 每个实际目标输出样本传入有效输出标记、当前 scale 和输出 refreshHz。刷新率来自 RenderView，不从偶然长帧反推；缩放变化会重新判断。输出缺失、scale 非正 / 非有限、refreshHz 未知 / 非有限时保留原数值完成条件，并累加各类后备原因。
- 位置误差 × scale、速度 / refreshHz × scale 均须 <= 0.25。进一步计算剩余临界阻尼解析曲线的极值范围，保证整个未来轨迹仍在阈值内。高速 / 慢速穿过终点都不能只靠瞬时误差收尾；制动段明确禁止视觉 snap，包括亚像素制动。
- prepare 只产生 pending 样本。真实目标输出实际 paint 之后，才提交精确 target / v=0 和 completed；未绘制的完成样本不能成为下一次 retarget 的初始位置 / 速度。Outgoing / ownership 保持至原 JS park / disarm，不改变窗口 geometry 或焦点。
- Core 参数查询返回实际 active arm 的参数；partial arm 覆盖 profile，继续 800。空闲返回配置 profile 参数，awaiting-frame 表示尚无本次有效输出样本。GetScrollMotionStatus 增加实际 stiffness / physical threshold、enabled / fallback、output scale / Hz、视觉完成次数和后备原因计数。
- FFI 为追加的窄 DTO / entry；旧 ABI 和 Scroll v2 保留。输出 facts、参数判断、未来包络、完成和计数属于 Rust；C++ 只转换平台输出值 / 绘制 / 查询。没有新增 timer、锁、异步线程、每帧 JSON 或输出 ownership。

## 参数比较：纯模型

可复现命令：

```sh
cargo run --manifest-path native/rust/Cargo.toml --locked --release --example analyze_scroll_tuning > build/animation-a4/tuning.csv
```

同一 Rust 解析求解器，位移 1260 logical px、scale=1.5、60Hz、静止起步、采样相位 t=0。T95 / 完成时间为解析轨迹条件的纳秒二分，最大步长为固定 60Hz 采样；均非实机呈现指标。

| stiffness | T95 ms | 最大相邻位移 physical px | 0.25 双阈值与包络 ms | 原数值完成 ms |
| --- | ---: | ---: | ---: | ---: |
| 800 | 167.721 | 321.018 | 404.909 | 684.583 |
| 600 | 193.667 | 281.889 | 467.548 | 790.488 |
| 500 | 212.152 | 256.764 | 512.174 | 865.936 |

600 比 800 的理想峰值步长降低约 12.2%，T95 延长 25.947ms；500 再减步长但 T95 比 800 延长 44.431ms。600 是峰值位移与响应的折中候选，不把数值预测当成用户体感结论。新收尾允许 600 在约 468ms 进入静态，避免为亚像素尾部继续重绘至原 790ms；此收益与刚度调整分别计算。

同一 L(0ms)、L(60ms)、H(100ms) 序列，反向新 arm 的速度首次为负分别约 5.299 / 5.621 / 5.899ms，三者均使用 bounded brake。CSV 同时覆盖 100 / 125 / 150 / 175 / 200% scale、59.94 / 60 / 120 / 144Hz 和 0 / 0.5 / 0.9 周期相位，数据在 tuning-summary.json。

600 / 150% / 60Hz 的阈值比较：0.125 → 498.239ms，0.25 → 467.548ms，0.5 → 436.695ms。保留初始 0.25；没有为缩短时长扩大阈值。短 / 长位移和正 / 负初速度另外由 Core 测试验证，未来 1 秒密集采样保持在阈值内。

## 验证与部署状态

Rust 1.99.0，GNU /usr/bin/g++ 16.2.1，Cargo.lock 未改。并发 2，构建和实机采样分开执行。

- Rust fmt / clippy --locked -D warnings / workspace tests：通过，52 tests。
- node tools/check.js --native：通过（100 JS、Bridge 17、Clip 16、Ring 23 CTest，隔离 DBus、plasmoid 与生产符号门禁）。首轮在隔离 DBus socket 创建处被沙箱阻止，之后使用允许 socket 的执行环境完成整套门禁。
- Core Debug / Release：各 12 CTest 通过，包含冻结 Golden differential；umbrella Debug：27 CTest 通过。
- BUILD_TESTING=OFF 两个插件与 Bridge 构建 / 符号核验通过，无 reference / differential target。C++ policy 的 GNU 16 接受、GCC 15 / 17、非 GNU / 指定路径拒绝通过；额外实际 configure 拒绝 rustc / cargo 1.98.0，通过。日志与命令在 build/animation-a4/results.json、additional-checks.json。
- 800 单步 L 基线已记录，无丢样 / 时钟后备 / 长间隔。基线恢复首次检查发现 Pair anchor 与焦点为两个独立状态；仅还原焦点会改变可见窗口组合，已恢复原 anchor，原窗口几何 / 停放状态核验通过，没有重复基线。
- 首次部署的新 Clip hash：df424ec77b2a854e83c026450979caaa806d95bb3f009f3818e1b085ca7bf773。新参数 / API 和安装 hash 已核验，但全窗口恢复检查发现既有 stop/start 对 inactive workspace 的 parked 状态采用 lazy 初始化；严格检查触发了安全组件回滚至 A3。恢复程序增加既有工作区激活与保存 anchor / focus 的重应用。恢复期间桌面自动锁屏，KWin 不再推进呈现，后续部署 / 实机验收等待解锁。A4 尚未完成实机验收，当前组件为 A3。

新测试覆盖剩余轨迹包络、低速 crossing、亚像素制动、缩放 / 刷新率矩阵、短 / 长距离与正负速度、无效输出 facts、缩放改变、长采样跨度、pending 完成中断、stale paint、精确 snap、Outgoing 生命周期、partial / stable 原参数与零分配。C ABI smoke 检查 80-byte DTO、空闲实际参数、null / 非法 flags。

## 回滚与限制

行为回滚：恢复 AnimationProfile=stable，经既有安全重配置 / stop-start 应用；仍使用 Rust。组件回滚将使用本阶段持久备份中的安全脚本，先 stop 恢复 parked windows，失败即停止，再恢复旧 A3 immutable Clip 和原 profile，最后 start。不会整体覆盖 kwinrc / workspaces.json，不删除新用户窗口。完整快照仅供故障调查。

实机体感、4K / 60Hz 呈现与桌面恢复记录将在本阶段部署后补充；自动测试不代替实机验收。A5 缩小 repaint 范围和 Focus Ring 分层 / 动画尚未进入本阶段。
