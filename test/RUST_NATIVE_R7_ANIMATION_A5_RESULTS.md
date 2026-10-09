# R7 后续动画 A5：目标输出重绘与 HiDPI 一致性

日期：2026-10-09。分支：feat/animation-60hz。基线：c8e158a（A4，用户已反馈无问题）。

本阶段仅收窄 smooth60 H/L 活跃未完成时的持续 damage。Rust motion / 浮点 offset / stiffness=600 / 0.25 physical px 收尾、JS authority、J/K=420ms、Pair/Wide、Ring 宽度 / 颜色 / owner / fullscreen 策略均未修改。C++ 仅调整平台 paint pass 与输出 damage 路由；未修改 Core / FFI / CMake / JS 包。

## 实现

- 只由实际采样的真实目标输出 pass 请求下一帧，使用 lifetime-guarded 已绑定 LogicalOutput 的完整 logical geometry。窗口、背景、阴影与光圈统一覆盖；不追求逐窗口极小区域。
- 副屏、offscreen、嵌套 / 同预计呈现时间重复、旧 revision pass 不额外请求；完成 / stop / output removal 后停止。目标缺失、无效 output geometry 或深度溢出无法证明范围时显式保守全局回退。既有 sampling / Rust motion 不重复推进。
- stable 保留原 per-pass 全局持续请求。arm / cancel / barrier / marker / 清理等一次性全局请求保留。WorkspaceSlideAdapter 的独立 damage 不在本轮修改或 Scroll 计数范围。
- 状态查询追加实际 profile 的 scrollRepaintScope 和累计 target / continuous full / conservative fallback 请求数。默认关闭的 capture v1 追加对应本次采样计数及每输出 targetRepaintRequests；旧字段保留。离线分析兼容旧 capture，缺失字段显示未知，不作 0 解读。无新 timer、每帧 JSON、异步线程或 Core authority。
- 复用现有 KWin WindowPaintData / Scene Item 变换、native device vertex 构造和 viewport mapping；不新增窗口 / Ring 各自取整，不把 device pixel 写回 Core。HiDPI 契约扩大到 100 / 125 / 150 / 175 / 200%，输出原点 -1920 / 0 / 2560、负 Y 与 target offset，检查静态内边、动画边宽 / seams、圆角、clip outsets、遮挡与缓存。

## 验证与部署

Rust 1.99.0，GNU /usr/bin/g++ 16.2.1；Cargo.lock 不变。两路并发、构建与实机采样分开。Rust fmt / clippy --locked -D warnings / workspace tests（52 tests）通过；node tools/check.js --native（100 JS、Bridge 17、Clip 16、Ring 23 CTest、plasmoid 与生产符号门禁）通过；Core Debug / Release 各 12 CTest、umbrella Debug 27 CTest 通过，包含冻结 Golden differential。日志在 build/animation-a5/results.json。HiDPI 检查共 900 个 SDK 变换样本；实机结果将在部署后补齐。本轮没有 CMake / FFI / Core 边界改动，不重复 A4 已通过的编译器拒绝和 BUILD_TESTING=OFF 构建矩阵。

## 限制与回滚

目标输出请求数只证明本插件申请的 damage 范围；副屏可能因一次性全局请求、光标、视频或其他效果呈现，不要求副屏帧数为 0。paint / presentation 尚无逐帧 join，不把样本当作 GPU 时间或输入到面板延迟。CPU / SDK 变换测试不能替代 GL 实际像素验收；其他缩放率由自动测试覆盖，不改变实际显示设置。

部署使用 save-state → stop（恢复失败即停止）→ 既有 immutable Clip 安装 → start。私有快照与组件回滚入口在完成部署后记录；回滚只恢复旧 Clip discovery 绑定与原 AnimationProfile，不覆盖用户之后的整个配置 / 工作区状态。
