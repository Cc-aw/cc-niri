# 单列重排连续过渡：协议与回滚设计

2026-10-13；AlwaysCenterSingleColumn 的 P4，先于实现记录。

## Authority 与消息

JS 仍决定列顺序、logicalX、合法非负 camera offset、目标几何和焦点。
新增明确类型 `COLUMN_REINDEX`（protocol 2），通过现有 PublishMotionPlan /
ArmScrollPlan / CancelScrollPlan 端点。与 SCROLL 共用 session、workspace、output、
epoch sequence、membership ACK、arm ACK 和超时；不借用 Pair/Wide 协议。

消息沿用 SCROLL 的 viewport、entries、oldScrollOffsetX、newScrollOffsetX，另有
`sourceWindowId` 和 `sourceLogicalX`，描述唯一存活窗口的旧 logicalX。
entries 的 logicalX 全部属于新的列基准。范围限于同安全区、同宽半列的 1↔2
membership 变化，entries 至多两个；唯一旧 visible 是 sourceWindowId。
源与目标须完整可见；隐藏或部分可见源仍走静态回退。
可见性按旧基准投影与新基准投影分别验证。原 SCROLL 的 schema、负 offset
拒绝、Golden 和普通 retarget 规则保持不变。

Bridge 先接受新 membership，再验证新的计划。Rust typed validator 验证源 ID、
有限非负 wire 数值、placement、scope 和 sequence；Adapter 检查真实窗口存活、
输出、桌面和源 frame，不创建布局 policy。

## Rust 投影与接管

定义 basisShift = source 的新 logicalX − sourceLogicalX。Rust 在专用 typed
路径中使用 internal cameraFrom = oldScrollOffsetX + basisShift；这不是 wire
SCROLL offset，也不放宽 SCROLL validator。关闭左窗例：1890→630，camera
630→0，internal from = −630；首帧 survivor x 为 safe.x+1260，末帧为
safe.x+630。左插入例：630→1890，camera 0→630，internal from=1260。

若 Native 正在绘制，必须验证旧 logical 基准与现有持有目标一致；从最后真正
painted camera 加 basisShift 接管，保留符合既有 bounded Spring 规则的速度。
未绘制的预测 sample 不作为起点。继续使用同一个 ScrollViewportRuntime、Rust
Spring、output presentation clock、clip context 和 Ring transform；无第二时钟、
线程、服务、纹理或每帧 JSON。源/目标 map 按真实窗口 O(N)，旧 epoch 与关闭
窗口依照现有 remove/cancel/workspace 生命周期清理。

现有 ScrollOwnershipDataRole 的 SCROLL marker 表达共享 strip renderer 的
ownership，继续复用它抑制 legacy geometry 动画；实际 wire plan type 始终
是 COLUMN_REINDEX。Ring 通过已有 paint context 获取同一 projection。

## 失败与回滚

任一 membership/publish/arm 拒绝、超时、旧 plugin 不识别、源 basis/frame 不符：
通过现有 gate 先取消该 epoch，待 ACK 或有限超时后提交当前合法静态几何；
迟到 ACK 不得重放 geometry/activation。安全区或宽度变化不进入 typed 重排。
工作区切换、输出移除、停止和卸载沿用现有取消和 restore 顺序。

功能默认 false。回滚首先关闭 AlwaysCenterSingleColumn，使用原布局；整体产物
回滚走既有 save-state / stop / immutable install / start，Bridge 与 Native 成套
回退。本轮只构建和离线测试，不部署、不操作用户桌面。全部开发后统一执行
S01–S14、连续 retarget、Ring/clip、停止恢复和内存实机验收；未测标 Pending。
