# R7 后续动画 A5：目标输出重绘与 HiDPI 一致性

日期：2026-10-09。分支：feat/animation-60hz。基线：c8e158a（A4，用户已反馈无问题）。生产代码提交：9e4aa65；部署和剩余验收未再修改生产代码。

本阶段仅收窄 smooth60 H/L 活跃未完成时的持续 damage。Rust motion / 浮点 offset / stiffness=600 / 0.25 physical px 收尾、JS authority、J/K=420ms、Pair/Wide、Ring 宽度 / 颜色 / owner / fullscreen 策略均未修改。C++ 仅调整平台 paint pass 与输出 damage 路由；未修改 Core / FFI / CMake / JS 包。

## 实现

- 只由实际采样的真实目标输出 pass 请求下一帧，使用 lifetime-guarded 已绑定 LogicalOutput 的完整 logical geometry。窗口、背景、阴影与光圈统一覆盖；不追求逐窗口极小区域。
- 副屏、offscreen、嵌套 / 同预计呈现时间重复、旧 revision pass 不额外请求；完成 / stop / output removal 后停止。目标缺失、无效 output geometry 或深度溢出无法证明范围时显式保守全局回退。既有 sampling / Rust motion 不重复推进。
- stable 保留原 per-pass 全局持续请求。arm / cancel / barrier / marker / 清理等一次性全局请求保留。WorkspaceSlideAdapter 的独立 damage 不在本轮修改或 Scroll 计数范围。
- 状态查询追加实际 profile 的 scrollRepaintScope 和累计 target / continuous full / conservative fallback 请求数。默认关闭的 capture v1 追加对应本次采样计数及每输出 targetRepaintRequests；旧字段保留。离线分析兼容旧 capture，缺失字段显示未知，不作 0 解读。无新 timer、每帧 JSON、异步线程或 Core authority。
- 复用现有 KWin WindowPaintData / Scene Item 变换、native device vertex 构造和 viewport mapping；不新增窗口 / Ring 各自取整，不把 device pixel 写回 Core。HiDPI 契约扩大到 100 / 125 / 150 / 175 / 200%，输出原点 -1920 / 0 / 2560、负 Y 与 target offset，检查静态内边、动画边宽 / seams、圆角、clip outsets、遮挡与缓存。

## 验证与部署

Rust 1.99.0，GNU /usr/bin/g++ 16.2.1；Cargo.lock 不变。两路并发、构建与实机采样分开。Rust fmt / clippy --locked -D warnings / workspace tests（52 tests）通过；node tools/check.js --native（100 JS、Bridge 17、Clip 16、Ring 23 CTest、plasmoid 与生产符号门禁）通过；Core Debug / Release 各 12 CTest、umbrella Debug 27 CTest 通过，包含冻结 Golden differential。日志在 build/animation-a5/results.json。HiDPI 检查共 900 个 SDK 变换样本；实机短验收已完成，详情如下。本轮没有 CMake / FFI / Core 边界改动，不重复 A4 已通过的编译器拒绝和 BUILD_TESTING=OFF 构建矩阵。

## 部署与一次短实机验收

私有持久备份：`/home/cc/.local/state/cc-niri/backups/animation-a5-20261009-174908`，权限 0700，包含原配置键存在性 / 值、代码 / 用户设计文档、组件路径与 hash、输出 / 窗口状态、部署命令、原始 capture、截图与分析、执行的恢复程序和 `rollback-component.sh`。

save-state → stop（parked windows 已恢复）→ 既有 immutable Clip installer → start，通过。安装 hash：`a873c8719ccee73cb3258b91ff93b4d05c7c04b5b9788b7276d1381008c86cba`；与 canonical 目录一致。显式重载后新 repaint 查询 / capture 字段可用，Rust backend 与参数核验通过。KWin PID 2050 未变；Ring / Bridge / CLI / JS 包未替换。OS 拒绝读取 KWin `/proc/2050/maps`，实际进程映射 hash 未独立验证，不能把安装 hash 等同于映射 hash。

主屏 DP-1：3840×2160 / 60Hz / 150%；副屏 HDMI-A-1：2560×1440 / 60Hz / 100%。profile=smooth60，workspace optimization=true / 420ms，原生 Slide=false。构建已结束后才测实机。

按用户减少重复测试的要求，保留一次 JJKK（80ms）与一次当前工作区 L；之后只补未完成的普通 Scroll LLHH（30ms）及相关功能，没有重复 JJKK、L 基线或自动门禁。

首次 L 位于含 full-width 列的既有工作区，JS 按已有规则发布 `clipPartial=true`，Rust 保留 800 / 原数值完成条件。capture 显示精确到位 / v=0 / ownership=true，目标输出重绘检查通过；验收程序错误地要求 A4 普通 Scroll 的 visualCompletedCount>0，因此提前停止并恢复原桌面，临时回退 stable。根据日志定位为验收前提错误，未改生产代码或用户列偏好。随后切回 smooth60，将剩余检查放在现有空白尾工作区；普通 Scroll carry / brake 和视觉 snap 通过。两个实际路径都验证了 A5 damage。

| Scroll capture | 目标输出持续请求 | 副屏目标请求 | 持续全局 / 后备全局 | 保留的全局事件请求 |
| --- | ---: | ---: | ---: | ---: |
| 既有 partial 工作区，单步 L | 39 | 0 | 0 / 0 | 8 |
| 空白工作区，普通 LLHH | 29 | 0 | 0 / 0 | 22 |
| 恢复后空闲 1 秒 | 0 | 0 | 0 / 0 | 0 |

普通 LLHH 的 actual-painted velocity 接管：carry v0=9172.482，brake v0=15634.979 logical px/s；接管初始速度与最后绘制保存值完全一致。反向制动 6.427ms / 50.240 logical px（视口 2%），无时钟 / output-facts 后备、无 capture 截断；最终 paint 的 x=target / v=0，ownership 保留，visualCompletedCount 增加。上述窗口运动与 Ring 使用原时钟 / 变换，没有因副屏 postPaint 多推进。

| 短功能与恢复 | 结果 |
| --- | --- |
| JJKK，420ms，C2 / C1 / 有界反向 | 通过；carry-c2、carry-c1、brake-c1，制动 10.262ms / <=0.02 cell，无 reset |
| Wide 80ms 离开、80ms 中途返回，Ring 跟随 | 通过，制动 17.766ms / <=0.02 cell |
| Ring owner、fullscreen 隐藏 / 恢复、off / on | 通过 |
| 运动中关闭自建窗口，切 stable / smooth60 | 通过，模式清理与 repaintScope 查询一致 |
| 安全 restart、原窗口 / 焦点 / 列偏好 / 副屏恢复 | 通过 |
| 空闲 1 秒 Scroll repaint / paint、Workspace motion 记录 | 全部 0 |
| KWin 错误扫描 | 无 JS 错误、invariant / fail-safe / completion timeout / panic |

一张实际 compositor 桌面截图与四角裁剪已经检查，蓝边连续、圆角匹配、未出现方角或边框穿入窗口内容；原宽度 / 颜色保留。截图导出 10240×2880，Spectacle 使用统一 2× 输出栅格；它是 150% 桌面的合成视觉证据，不能据此直接测量原显示物理像素厚度。100 / 125 / 175 / 200% 和负输出原点仅在 SDK 自动契约中验证，没有修改显示设置。

普通 LLHH 主屏 33 个呈现间隔：P50=16.667ms / P95=16.729ms / P99=16.755ms / max=16.756ms，>25ms=0；副屏 29 个间隔，max=33.337ms，长间隔 1。partial L 主屏 max=16.935ms / 长间隔 0，副屏 max=33.375ms / 长间隔 1。JJKK 主屏仍有 4 个 >25ms 间隔，max=33.335ms；本轮未改 J/K 重绘。目标范围收益已由请求计数确认，单次样本、不同工作区与缺失 paint-to-present join 不能证明整体帧稳定性或 GPU 合成负载改善；未重复 A/B。

最终四个有内容工作区 ID、所有原窗口 geometry / membership / minimized / fullscreen、实际与 Bridge 焦点、viewport anchor、列宽偏好、输出、原配置、组件均核对恢复；无新非测试窗口被删除。测试占用原空白尾工作区时，既有 DynamicTrailingWorkspace / AutoRecycleWorkspaces 创建后继空工作区并回收原空工作区：尾部 UUID 从 `ef722287-cf70-471d-bbd6-5525bac82f49` 替换为 `fc9a6861-70f0-47a0-bb37-1d61af6369e8`。桌面数量、顺序和当前输出桌面保持，原空工作区无窗口 / 列偏好，不强制写回已删除 UUID。恢复程序原本要求所有空桌面 ID 不变的断言因此停止；只读最终核验确认属于原自动回收行为，记录为这一处变化。最终 profile=smooth60；原 full-width 列偏好保留。

原始数据在 `short-a5-acceptance/` 和 `remaining-a5-acceptance/`，最终核验在后者 `restoration-success.json`，离线分析在备份 `verification/live-analysis/` 与仓库 `build/animation-a5/live-analysis/`。

## 限制与回滚

目标输出请求数只证明本插件申请的 damage 范围；副屏可能因一次性全局请求、光标、视频或其他效果呈现，不要求副屏帧数为 0。paint / presentation 尚无逐帧 join，不把样本当作 GPU 时间或输入到面板延迟。CPU / SDK 变换测试不能替代 GL 实际像素验收；其他缩放率由自动测试覆盖，不改变实际显示设置。

部署使用 save-state → stop（恢复失败即停止）→ 既有 immutable Clip 安装 → start。运行上述备份的 `rollback-component.sh` 可恢复 A4 Clip `df424ec77b2a854e83c026450979caaa806d95bb3f009f3818e1b085ca7bf773` 和原 AnimationProfile。先 stop 恢复 parked windows，失败即停止；仅回滚 discovery 绑定与该键，不覆盖用户之后的整个配置 / 工作区状态。行为回滚可切 stable，经既有安全入口应用，仍使用 Rust。A5 源码 / 必要门禁 / 短实机功能与恢复核验完成，用户体感待反馈；Focus Ring 分层与动画是后续独立阶段。
