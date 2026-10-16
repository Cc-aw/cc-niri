# Scroll Layout V2 P4：Rust runtime、FFI 与场景接管

日期：2026-10-15；目标基线 `8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e` 加未提交工作区。

P4 完整链实现与隔离验收记录。JS 组合及阶段边界见 [P4 结果](SCROLL_LAYOUT_V2_P4_RESULTS.md)。V2 默认关闭，未部署，生产 main 仍走 V1；P5 兼容组合/持久化和 P6 用户桌面验收仍 Pending。本报告替代早期数值组件/paint source 增量的未接线结论。

## Core / Adapter 边界

`scroll_geometry_runtime.rs` 在现有 ScrollViewportRuntime 内构造 ColumnGeometryTransition。共享原 ScrollSequence、camera、presentation timestamp、Spring/profile 与取消屏障；JS 仍是布局、工作区、epoch、焦点与全局恢复 authority。

- typed validator 校验最多256个唯一列、源/目标矩形、宽度、placement、camera 边界、scope、源 epoch/serial 和输出；旧三类 wire 不放宽。
- source 结合实际平台 frame/opacity/资格与最后真实 paint/cull pass。隐藏 incoming 不制造 visual 或速度；完全零覆盖的现有列保存真实 pass 姿态并单独标记 culled。
- arm 原子重读平台事实，校验调用者只使用真实已发出的唯一 observation lease。若 RPC 间仅 presentation 数值前进，Core 验证 provenance 后重定基到最新实际 paint；frame、隐藏状态、输出/layout/scope 改变不能借此放行；上一动画刚完成导致的实际旧 camera 边界收缩同样由当前 Core 事实重定基，具有专门回归。没有历史 paint 队列。
- 新旧实际 frame 精确匹配，不缩放 client。camera 和每列相对 X/Y 共享采样时刻；可行时保留速度，沿用既有有界 brake。old ACK/未知 frame 撤销完成证明；新 target ACK 后还需新的真实绘制。未接管应用的几何事件不撤销当前事务。
- 完成要求全部活跃行同 epoch/time/pass 的目标 ACK 和实际 draw 或可证明零覆盖，所有数值曲线结束。offscreen 行不伪造 draw；数值结束而 ACK/paint 不完整时停止动画 continuation，等待真实事件，避免 idle 循环 repaint。
- 新事务遗漏仍可见的活 owner 被拒绝。已关闭 surface 仅冻结最后实际姿态至 windowDeleted，不进入新 camera/完成屏障。remove/clear/cancel 回收相关行/lease；workspace copy 冻结实际 pose。
- 确认取消后立即 hydration 使用共享 motion 的既有单调时间下界，处理下一帧预测呈现稍晚于事件时间的情况；不削弱负时钟或 epoch 拒绝。

C++ 只取 Qt/KWin 事实、管理 lifetime、执行 hooks 和绘制。geometry 路径的 postPaint 用固定256行栈缓冲和 event-time 缓存的 QPointer/ID，无新增每帧 JSON、诊断分配或重复 UUID 字符串构造。完成/source-ready JSON 经 queued event 发送，只有显式请求或首次完成触发；Bridge 沿用原64条队列和现有唤醒机制。

## additive ABI

新增独立 arm/source/projection/completion/observe-frame/finish-frame/readiness 入口；旧 ABI 尺寸保持。

| DTO | bytes |
| --- | ---: |
| ColumnGeometryEntry / Plan | 160 / 304 |
| ClientPaint | 208 |
| GeometrySourceRow / Status | 64 / 128 |
| GeometryProjection / Completion | 56 / 48 |

buffer 均同步借用，指针不跨调用；source query 仅保留一份 owned 数值 observation。歧义视觉命中由独立只读零分配 FFI 查询确认，Adapter 不选择客户端；平台原生 popup/floating 栈权威保留。入口先检查长度、容量、null、reserved、flag、UTF-16 与表示，FFI smoke 包含尺寸及拒绝路径。observer token 仍 message-local，runtime ID 随实际窗口清理。sourceKind3 表示真实零覆盖，不能把有覆盖的 rect 声明 culled。

## 最终验证

最终命令、退出码、耗时、源码和组件 SHA、安装版未变对照见 [verification.json](scroll-layout-v2-p4-evidence/20261015/full-p4/native/verification.json)。完整日志位于同目录；隔离场景 JSON 在父目录。本次最终顺序验证的命令与耗时另见 [final-commands.json](scroll-layout-v2-p4-evidence/20261015/full-p4/native/final-commands.json)。

| 检查 | 状态 |
| --- | --- |
| Rust 1.99.0 fmt / locked clippy all-targets `-D warnings` | PASS |
| locked Cargo workspace dev / release | PASS，各109项 |
| `node tools/check.js --native`；生成包一致、完整 JS、Bridge/Clip/Ring/Plasmoid | PASS，114个JS文件 / 200项；110.30秒 |
| Bridge / Clip / Ring CTest，含冻结旧 Golden 和 FFI smoke | PASS，18 / 18 / 25项 |
| Core Debug / Release configure/build/CTest | PASS，各13项 |
| Native umbrella Debug configure/build/CTest | PASS，30项 |
| BUILD_TESTING=OFF 两插件及 Bridge，无 reference target/符号边界审计 | PASS；默认与OFF Clip的13个P4相关FFI符号均存在 |
| GCC compiler-policy 与非固定 Rust/Cargo configure 拒绝 | PASS，GNU16.2.1正路径；1.98.0 Rust/Cargo明确拒绝 |
| 私有 P4 100% / 150% / 150%+Fcitx5 | PASS，32/32、32/32、35/35 |
| 当前源码 P3 100% / 150%+Fcitx5 回归 | PASS，35/35、38/38 |
| 用户桌面真实 Meta R/H/L、J/K、视觉及安全 stop/restore | NOT RUN / Pending |
| 全项目 B0/B1 PSS / Private_Dirty / GPU / 4K60 /30–60分钟 | NOT MEASURED |

P4 私有场景加载实际生产控制器、协调器、ACK gate、GeometryCommitter、ParkingManager 与构建树 Release 插件，不用 mock 替代 Native arm 或客户端 ACK；只对一次真实 arm 的回复做明确的丢失故障注入。帧证据区分连续 retarget 与已确认 disarm 后的静态 hydration，不能把 hydration 的新静态起点误作 C0 失败。

私有虚拟输出的通过不代表常用桌面已验收。未安装任何产物，冻结 reference 和 Cargo.lock 未改；不以撤回整个工作树作为回滚。P4 Core 热路径10,000帧零分配只是对应算法范围证据，不扩大到 Qt/渲染器或总内存达标。

最终所有命令退出码为0；额外构建矩阵18步共112.96秒。P4三组私有会话各11.13 / 12.29 / 15.48秒，P3两组5.37 / 7.70秒；它们是短期功能证据，不能作为帧率、PSS峰值或长期稳定性结论。完整生产符号名单与SHA见 [p4-symbol-audit.json](scroll-layout-v2-p4-evidence/20261015/full-p4/native/p4-symbol-audit.json)。安装版 main、Bridge、Clip、Ring四份SHA与此前P3记录一致。
