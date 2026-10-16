# Scroll Layout V2 P4：完整列几何事务

日期：2026-10-15；基线 HEAD `8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e`，包含未提交工作区修改。

P4 的生产模块及完整隔离运行链已经实现：JS target → Bridge typed ACK → Rust/Scene ownership → 真实 configure ACK / paint → activation 与 deferred parking。最终门禁和产物摘要见 [Native 结果](RUST_NATIVE_R7_SCROLL_LAYOUT_V2_P4_RESULTS.md) 和 [完整证据](scroll-layout-v2-p4-evidence/20261015/full-p4/)。本文替代此前两个增量的“接管待实现”状态；旧增量证据保留。

**V2 默认关闭，未安装或重载用户桌面。** 常用桌面的 main 仍保留 V1 组合入口；P4 新协调器已进入生成包，并在私有 KWin 中与真实 P2 控制器、Bridge、客户端和 Native 插件组合运行。持久化迁移、主入口及全部旧功能的统一兼容接线属于 P5；P6 用户桌面视觉、安全 stop/restore、4K60 和长期资源验收仍 Pending。P4 阶段完成不代表 V2 READY 或可以部署。

## 完成的实现

- [ColumnGeometryCoordinator](../src/kwin/layout/ColumnGeometryCoordinator.js) 只序列化当前 intent，不复制布局或 epoch authority。P2 Controller、ColumnStore、ColumnWidthController 和 LayoutTransaction 决定顺序、三档宽度、焦点和 camera target。
- [ColumnGeometryPlan](../src/kwin/layout/ColumnGeometryPlan.js) 发布独立 protocol4 `COLUMN_GEOMETRY`，严格要求 capability、真实源、scope、client frame、列身份及目标安全锚点。RuntimeBridge 保留 protocol4，不降级成旧 SCROLL。
- 顺序为 `membership → typed publish → Native arm → 监听/guarded configure → 精确 client ACK + Native 完成证明 → 激活 → 隐藏移出视口的列`。新列、过境列和反向重入列在接管后才显示，旧 ACK 或单纯数值结束不能授权完成。
- 新列源来自 KWin 当前隐藏状态；完全裁掉的已有列使用真实输出 pass 的零覆盖姿态，标记 `sourceKind:culled`，不冒充 draw。与 camera 共用 presentation timestamp 的相对数值过渡保持位置，实际旧/新 surface 不缩放。
- 快速 R/H/L 只保留最新事务；未绘制的新 epoch 不覆盖实际源。查询与 arm 之间发生真实绘制时，Rust 验证唯一有界 observation lease，再从最新真实 paint 原子重定基；不冻结画面、不接受任意 caller pose。
- 关闭中的 KWin surface 冻结最后实际位置直到 windowDeleted；幸存列不受旧窗口 ACK 干扰。未知 ACK fail closed，不能交给旧 JS width/scale 动画。Ring 使用同一原生绘制 context。重排中视觉区域重叠时不选择任意客户端，消费歧义输入的完整按下/释放；实际 unknown-frame 命中被遮蔽时也不把点击漏给桌面。
- source 暂不可用时仅等待显式 Native frame-ready 事件；该 Bridge command 只是唤醒，完成权威始终重新向 Native 查询。无帧轮询或第二个动画时钟。
- 缺 capability、发布/arm 失败、ACK/paint 超时、scope 变化都有有界退出。只有取消后查询确认 Native ownership/handoff 已解除，才允许安全锚点 hydration；最多一次新 epoch 恢复。重复失败交给现有全局 Recovery，取消结果不明则隔离后续写入。不会以 void/false cancel 进行静态重放。
- bootstrap 保留焦点窗口可见，精确确认真实尺寸后用等位移 PARTIAL_SCROLL 建立绘制基线。确认取消后仍保留共享时钟的预测呈现下界，避免即时恢复被旧时间屏障误拒绝。
- retarget、workspace departure、关闭、stop 和失败释放当前监听及期限 timer；stop 清空源/intent 并移除 frame-ready handler。既有全局 Recovery + ParkingManager 的合法恢复也有组合测试。

## 验证范围

定向 JS 覆盖三档循环、连续意图、顺序与旧回调、frame/paint 证明失效、未知 cancel、全局恢复、作用域、关闭和生命周期；Rust 覆盖数值连续、精确 ACK、真实 source/cull、共享 sequence、原子重定基、关闭冻结和零分配查询。最终完整计数、命令、退出码和矩阵以 Native 报告及 JSON 为准。

隔离探针使用构建树 Release Bridge/Clip/Ring、临时 XDG、私有 D-Bus 和两个 2560×1440 Mesa 虚拟输出；核验实际加载路径。`--scenario p4` 直接加载上述生产 JS 模块及真实 Wayland 客户端：

1. 12 次顺序 R 恢复 half，严格每操作一次模型变更；再进行 12 次快速 R 与重排/焦点组合。
2. 非零 camera 速度下反向，核验新曲线起点来自最后实际 paint；完全裁掉的列从真实零覆盖位置重新进入。
3. 改宽中关闭窗口；插入隐藏 full/half 两列，跨中间列跳转后立即反向，再关闭新增列。
4. 混合宽度中的偏移 visual 点击/滚轮被消费，天然坐标窗口收到真实坐标事件；真实交叉重排的重叠区域不把输入送给客户端或错误焦点；150% 下 Fcitx5 候选窗、候选点击和中文提交。
5. 真实工作区离开/空工作区/返回保留宽度和焦点；这是 KDE fallback 场景，未注入常用桌面的快捷键。
6. 故意丢失一次真实 Native arm 的回复，确认取消后用新 epoch hydration，窗口可见且几何合法；最终取消后 timer/监听归零。
7. 每个主要检查点读取整个副屏 framebuffer，保持全黑；Ring 实际 draw/shared-frame 计数递增。

私有会话禁用全局快捷键；fixture 用有界 command pump 代替该会话的快捷键唤醒，只消费现有 Bridge 控制命令，不采样动画。R/H/L 通过生产控制器方法发起，不能扩大解释成用户快捷键、用户桌面或视觉满意度验收。截图 readback 仅在测试中开启。

最终结果（全部退出码0）：

| 项目 | 状态 |
| --- | --- |
| Rust fmt / locked clippy / workspace dev 与 release | PASS，dev/release各109项 |
| 生成包及完整 Native 门禁 | PASS，114个JS测试文件 / 200项，Bridge/Clip/Ring CTest 18/18/25项 |
| Core Debug/Release、Native umbrella、生产OFF及边界/编译器矩阵 | PASS，Core各13项，umbrella30项 |
| 私有 P4 100% / 150% / 150%+Fcitx5 | PASS，32/32、32/32、35/35 |
| 当前产物 P3 100% / 150%+Fcitx5回归 | PASS，35/35、38/38 |
| 安装版 main / Bridge / Clip / Ring SHA未变 | PASS，四份一致 |

复现 P4 使用 `python3 tools/scroll-layout-v2-p3-probe.py --isolated --scenario p4 --output <仓库内证据目录>`，150%加 `--scale 1.5`，输入法加 `--ime`。所有构建按2个并行任务、跨Debug/Release阶段顺序执行；具体命令和时长在最终 [verification](scroll-layout-v2-p4-evidence/20261015/full-p4/native/verification.json) 与 [command记录](scroll-layout-v2-p4-evidence/20261015/full-p4/native/final-commands.json)。

## 限制、资源和回滚

Wayland 客户端按真实 configure 重排内容，P4 不保存旧 surface 或拉伸文字；具体应用的主观 resize 观感仍需 P6 实机确认。新的 incoming 客户端须由宿主先建立真实 ParkingManager 隐藏所有权，再由协调器接管、配置和显示；私有组合明确覆盖这一步。实际 Meta 快捷键、Wide/Fullscreen 等全功能入口组合、快照升级与回退仍按 P5/P6 完成，不能由本轮 fixture 代替。

新增服务、线程池、动画时钟、生产图像/纹理/全屏缓冲均为 0。事件状态和唯一 observation lease 为 O(当前窗口数)，最多256行；closing 仅对应 KWin 尚存的删除 surface。Core 10,000 帧零堆分配不代表 Qt draw 或全项目零分配。PSS/Private_Dirty、GPU、真实对象/纹理统计、4K60 和30–60分钟斜率均 **NOT MEASURED**，资源预算 Pending。

未改安装产物，SHA 对照见最终 verification。停止实验时取消当前事务并确认 Native 已释放，再使用原 Recovery/ParkingManager；无法确认则停止写几何。仓库保留默认关闭、V1 入口和冻结 Golden，撤回时仅撤回本阶段文件/修改，不能 reset 混合工作树。
