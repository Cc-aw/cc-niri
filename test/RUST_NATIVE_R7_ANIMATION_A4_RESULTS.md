# R7 后续动画 A4：60Hz Scroll 参数与物理像素收尾

日期：2026-10-09。分支：feat/animation-60hz。基线：3216cf3（A3）。生产代码提交：8e084f1；部署使用该构建，恢复与验收阶段未再修改生产代码。

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
- 首次部署的新 Clip hash：df424ec77b2a854e83c026450979caaa806d95bb3f009f3818e1b085ca7bf773。新参数 / API 和安装 hash 已核验，但全窗口恢复检查发现既有 stop/start 对 inactive workspace 的 parked 状态采用 lazy 初始化；严格检查触发了安全组件回滚至 A3。恢复程序增加既有工作区激活与保存 anchor / focus 的重应用。恢复期间桌面自动锁屏，KWin 不再推进呈现，暂停等待用户解锁；随后按用户“开始验收”恢复。验收开始的只读快照发现副屏一个既有窗口的位置已改变，恢复保留该新位置，不强制回到锁屏前快照。补齐恢复后，以同一已验证构建重新部署成功，无需重复基线或自动门禁。当前组件为 A4。

新测试覆盖剩余轨迹包络、低速 crossing、亚像素制动、缩放 / 刷新率矩阵、短 / 长距离与正负速度、无效输出 facts、缩放改变、长采样跨度、pending 完成中断、stale paint、精确 snap、Outgoing 生命周期、partial / stable 原参数与零分配。C ABI smoke 检查 80-byte DTO、空闲实际参数、null / 非法 flags。

## 实机短对照与验收

最终持久备份：`/home/cc/.local/state/cc-niri/backups/animation-a4-20261009-171552`（0700）。其中保存原配置键存在性 / 值、代码提交与工作树、用户未跟踪设计文档、artifact canonical/hash、输出与窗口状态、部署命令、实际 capture、分析、恢复校验和回滚脚本。首次安全回滚与锁屏证据保留在 `animation-a4-20261009-162943`。

部署采用 save-state → stop（parked windows 恢复成功）→ 既有 immutable Clip 安装 → start。安装 hash 与 canonical 目录名相等；显式 reload 后新 API 和 Rust 实际参数核验通过。KWin PID 2050 不变。OS 仍拒绝 `/proc/2050/maps`，未独立核验进程实际映射的文件 hash；没有把安装 hash 说成映射 hash。Ring / Bridge / CLI / JS 包 / 原配置未改。

环境：主屏 DP-1，3840×2160、60Hz、150%；副屏 HDMI-A-1，2560×1440、60Hz、100%。profile=smooth60，工作区优化开启 / 420ms，原生 Slide 保持关闭。测量期间没有并行构建。

按用户要求，仅采集一次旧版 800 单步 L 与一次新版 600 单步 L；均使用四个自建静态 Konsole / sleep 临时窗口，相同 Pair 预备和 L 输入。实际位移均为 1260 logical px、scale=1.5、refreshHz=60、v0=0。另做一组 30ms LLHH 和一组 80ms JJKK 功能验收，没有长循环重测。

| 主屏单步 L | 800，原数值收尾 | 600，0.25px 视觉收尾 |
| --- | ---: | ---: |
| 实际绘制样本数 | 42 | 28 |
| 采样 T95 ms | 180.426 | 195.228 |
| 采样完成 ms | 697.205 | 478.589 |
| 最大相邻绘制样本位移 physical px | 323.393 | 508.508 |
| 最大解析速度 logical px/s | 12972.924 | 11289.546 |
| 首个可见 paint 相对处理事件 ms | 6.165 | 2.987 |
| Clip full repaint 请求数 | 89 | 62 |
| 主屏呈现间隔数 | 44 | 30 |
| 主屏 P50 / P95 ms | 16.670 / 16.807 | 16.668 / 16.706 |
| 主屏 P99 / max ms | 16.833 / 16.848 | 28.472 / 33.276 |
| 主屏 >25ms 呈现间隔 | 0 | 1 |

新版完成样本精确写 target / v=0，ownership 仍为 true；Core 视觉完成计数增加且各类输出 facts 后备计数为 0。以捕获的 arm / sample 时间回算 snap 前解析状态，位置误差约 0.194906 physical px，速度步长约 0.073316 physical px，均小于 0.25；该静止起步曲线后续单调趋近，包络也满足条件。

收尾减少约 218.6ms（31.4%），采样 T95 增加约 14.8ms，最大解析速度降低约 13.0%；刚度与完成策略共同变化，因此不能把收尾差异单独归因于刚度。相邻绘制样本最大位移反而增大：该样本跨 33.333ms 的预计采样时间；独立呈现记录也出现一次 33.276ms 长间隔。paint 与 presentation 没有逐帧关联，不能断言两者为同一帧，也不能据单次对照证明帧稳定性或整体流畅度改善。首个绘制响应不等于按键到面板延迟；首次预测采样相位分别约 30.465 / 28.571ms，测试顺序 / 负载也未随机化控制。

副屏单步 L：基线 42 个间隔、max 16.847ms、长间隔 0；新版 36 个间隔、max 33.400ms、长间隔 4。LLHH 主屏 39 个间隔、max 16.742ms、长间隔 0；副屏 44 个间隔、长间隔 4。完整原始数据在 `short-a4-acceptance/`，分析在 `verification/`。

| 短功能场景 | 结果 |
| --- | --- |
| 单步 L，实际 paint 后完成，Outgoing 等待 JS | 通过 |
| LLHH 中断，位置 / 速度接管与有界反向 | 通过；carry v0=11217.467，brake v0=9533.696 logical px/s，10.539ms / 50.240 logical px（视口 2%） |
| 同步目标输出预计时间，输出 facts 后备 | 通过；无时钟后备 / facts 后备，capture 未截断 |
| JJKK 420ms 导数接管 | 通过；1 个 carry-c2、2 个 brake-c1，C0 / C1 误差为 0，声明 C2 的加速度误差为 0，无 reset |
| Wide 获焦 80ms 后离开、再 80ms 中途返回 | 通过；owner / 宽度恢复，制动 18.438ms / <=0.02 cell |
| Ring owner、fullscreen 抑制 / 恢复、off / on | 通过 |
| 关闭自建窗口，profile 在运动中切 stable，再切回 | 通过；stable=800 / 无视觉阈值，smooth60=600 / 0.25 |
| 安全 restart 与最终原桌面恢复 | 通过 |
| 空闲 1 秒 | Scroll repaint 请求 / paint 记录与 Workspace motion 记录均为 0 |
| KWin 日志错误扫描 | 无 TypeError / ReferenceError / SyntaxError / invariant / fail-safe / completion timeout / panic |

临时客户端已全部移除。原窗口集合、所有原窗口 geometry / membership / minimized / fullscreen、全局实际焦点与 Bridge 焦点、当前 viewport anchor、工作区列偏好、桌面 / 输出、组件与配置均核验；暂停期间已有副屏位置变化得到保留，没有新增非测试窗口被删除。所有检查结果保存在 `restoration-success.json`。最终 profile=smooth60 / stiffness=600 / threshold=0.25，J/K=420ms。

## 回滚与限制

行为回滚：恢复 AnimationProfile=stable，经既有安全重配置 / stop-start 应用；仍使用 Rust，本轮已验证运动中切换。组件回滚执行最终持久备份的 `rollback-component.sh`，先 stop 恢复 parked windows，失败即停止，再恢复 A3 immutable Clip `c3449f472893bfe0765f745f8df7afe89ea226c7a4fa0659897ed9a7f9903300` 和原 profile，最后 start。不会整体覆盖 kwinrc / workspaces.json，不删除新用户窗口。inactive workspace 的 parking 由原 JS 在 mount 时重应用；本轮恢复额外核对了已保存的 anchor 与焦点。完整快照仅供故障调查。

生产路径与边界检查、一次短实机功能验收通过；60Hz 呈现稳定性 / 整体流畅改善尚未证实，用户体感仍待反馈。500 候选、三种物理阈值和其他 scale / refreshHz 组合只做离线 / Core 验证，没有继续多轮实机切配置。首次回滚在修复验收恢复程序后不再重复验证。A5 缩小 repaint 范围和 Focus Ring 分层 / 动画尚未实现。
