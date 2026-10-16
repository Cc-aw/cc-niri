# Scroll Layout V2 P5：持久化与完整入口兼容

日期：2026-10-16。基线 `8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e` 加现有未提交的 P0–P5 工作区。

**P5 实现及自动化、隔离 KWin 验证完成。V2 默认关闭，未部署到用户桌面，尚不能标记 V2 READY。** 下一阶段为 P6：真实桌面的视觉、输入、4K60、安全启停和全项目资源验收。

## 实现

- 将主组合入口迁入 `src/kwin/runtime/RuntimeEntry.js`，由 `node tools/build.js` 生成 main。启用 V2 时，实际 R/F、H/L、Shift H/L、Z、激活与工作区入口使用现有 ColumnStore / LayoutTransaction、P2 连续视口策略及 P4 协调器；关闭时保留 V1 Pair/Wide 与旧协议。没有第二套布局或焦点 authority。
- `widthV2: {version:1,widthMode,previousNonFullWidthMode}` 明确区分新的 twoThirds 与历史未版本化 twoThirds。历史 protocol 1/2 仍将 third/twoThirds 降为 half；V1 使用 half/full 投影，同时保留 dormant V2 元数据，切回 V2 后恢复。Full 的前一个非 Full 宽度也保留。
- 独立 `viewportAnchorV2: {version:1,uuid,delta,basis}` 保存带符号的 `camera - logicalX`；basis 仅包含 OutputRect、WorkingArea、gap 和 scale。旧 viewportAnchor 仍非负。恢复重新推导逻辑位置，校验基准后按 center/fit 策略恢复；工作区域或缩放改变时重新计算。没有持久化实际帧、指针、ColumnId、ACK 或动画时间。
- `persistentWide` 和版本化 `dormantViewportV1` 保留 V1 偏好。V2 中 Z/旧 Wide 命令仅居中，不改宽度或启用 72% 隔离。V2 full 仍是普通列宽；原生 Fullscreen 暂停列动画，退出恢复精确宽度；独立 safe-area 最大化保持旧边距。
- 快照同时校验 active/root 顺序、列宽及版本化宽度/锚点一致性、重复 UUID/工作区、字段类型和范围；无效恢复保持原存储。每工作区最多256列，Bridge 继续强制1 MiB上限。256列样本在上限以内。Bridge 保持快照 protocol 2，旧 protocol 1、旧读取方和同步磁盘交接均回归。
- Fullscreen、浮动、成员/输出变化、移动跟随、全局恢复先退休回调，并等待 Native 确认释放 ownership，再写恢复几何。未知取消结果停止布局并阻止写回。睡眠工作区切换沿用原 Native workspace 生命周期；最终相机在 barrier 打开后经 P4 membership ACK 发布，避免保存临时的零相机。
- 隐藏 Wayland 客户端可能不提交 resize 缓冲；配置准备阶段保持透明并允许 ACK，显式聚焦前保留用户原先的最小化偏好。关闭、stop 和输出拓扑变化会释放已有 RuntimeLifecycle 内的窗口/输出连接，避免按历史拓扑事件增长。
- 主屏 V2 使用真实 WorkingArea 与输出 scale；副屏仍使用原 SafeArea。Dialog/Transient 不进入列；离屏列经现有 Native arm、客户端 ACK 和真实 paint 证明后再激活。Focus Ring 沿用原 Native owner/共享帧。

## 验证

最终原始记录、源码/组件 SHA 和已安装组件未变对照见 [verification.json](scroll-layout-v2-p5-evidence/20261016/full-p5/native/verification.json)。命令及耗时见 [final-commands.json](scroll-layout-v2-p5-evidence/20261016/full-p5/native/final-commands.json) 和同目录日志。私有场景加载完整生成 main；仅配置读取、受限操作驱动与诊断记录为 fixture。私有命令 pump 不进入生产。

| 检查 | 结果 |
| --- | --- |
| 生成包一致、完整 JS 回归、patch whitespace | PASS，116个文件 / 220项；Native 全门禁中的218项通过后补入数字移动与 V2 自动回收两项，并重跑完整 JS |
| P5 persistence / workspace 定向用例 | PASS，7 / 13项；包括历史迁移、V2↔V1、负锚点、Wide、Fullscreen、移动/回收、关闭/连接释放、最小化恢复 |
| Rust 1.99.0 fmt、locked clippy workspace all-targets `-D warnings` | PASS |
| locked Cargo workspace dev / release | PASS，各109项 |
| `node tools/check.js --native` | PASS；Bridge / Clip / Ring / Plasmoid 构建、冻结 Golden、FFI 和私有 DBus |
| Bridge / Clip / Ring CTest | PASS，18 / 18 / 25项 |
| Core Debug / Release CTest；umbrella Debug | PASS，各13项；30项 |
| BUILD_TESTING=OFF 两插件与 Bridge、reference target / 符号边界 | PASS；P4生产 FFI 符号保持 |
| 精确 GCC/Rust/Cargo 工具链与拒绝路径 | PASS，显式 `/usr/bin/g++`；错误 Rust/Cargo 版本拒绝 |
| 新 Bridge 私有 DBus/磁盘、元数据冲突原子拒绝、重启、安装交接 | PASS，15项 |
| 已安装旧 Bridge 在私有总线读取/保存新字段 | PASS，7项；未联系桌面运行的 Bridge |
| 完整 main：100% / 150% / 150%＋Fcitx5 | PASS，30/30、30/30、33/33 |
| P4 150%＋Fcitx5 回归 | PASS，35/35 |
| 已安装 main / Bridge / Clip / Ring SHA | PASS，全部未变；未安装、未重载用户桌面 |
| 用户桌面、4K60、真实 mixed-DPI 双屏、长期资源 | NOT RUN / NOT MEASURED，P6 Pending |

私有完整入口覆盖真实客户端 resize ACK、R/F、H/L 延迟激活、Z、Fullscreen、safe-area maximize、Dialog、J/K、移动跟随、V2→V1→V2 脚本重启、真实 Ring 及整个副屏 framebuffer 为黑。Fcitx5 项实际打开候选窗、点击候选并提交中文，验证没有误发 partial-focus。此处使用虚拟 Mesa KWin，不能代替用户 GPU、键盘快捷键投递、混合缩放双屏或主观视觉验收。数字移动/自动回收使用完整生成入口的模型回归；100%和150%私有场景分别验证缩放，未做用户输出热插拔。

开发期隔离测试发现并修正：最小化客户端不提交新缓冲、最大化在 configure ACK 前被 fixture 过早记录、签名锚点在工作区 barrier 内过早发布、输出信号重复注册。最终结论仅引用 `full-p5` 的通过记录。

## 资源与回滚边界

没有新增常驻服务、线程池、生产动画时钟、FFI handle、图像、纹理或全屏缓冲。版本化快照按真实窗口/工作区数量增长；离开动作队列按窗口/事件合并且有界，完成或 stop 清空；连接按活窗口/输出管理。模型清理和 Core 零分配不等于全项目内存达标。

Release B0/B1 PSS、Private_Dirty、真实对象/纹理统计、GPU 归因、4K60帧时间、30–60分钟空闲增长均 **NOT MEASURED / Pending**；M0–M3 状态不变。见 [内存账本](CC_NIRI_GLOBAL_MEMORY_AUDIT.md) 与 [资源结果](CC_NIRI_GLOBAL_MEMORY_RESULTS.md)。

当前安装版无需回滚，本次没有部署。源码可用 `ScrollLayoutV2Enabled=false` 走 V1，保留新版持久字段；跨旧 JS 版本回滚仍须保留配套完整组件和升级前后快照，因为旧 JS 不负责保留未知字段。P6 部署须按已有 `save-state → stop → immutable install → start` 流程取得明确授权，不强杀 KWin、不重启应用。P5 自动化中的私有安全 stop 不代表用户桌面安全停启已验收。
