# Scroll Layout V2 P2：统一视口与工作区事件模型

日期：2026-10-15；基线 HEAD：`8056cfe6b4a023ac8dcbfb01e4495a5acf4c2c4e`；
开发分支：`scroll-layout-v2-p0`。P0/P1 和用户规范保留，工作树未提交。

**状态：P2 离线事件模型与完整门禁 PASS；V2 运行时 NOT READY / 未部署。**
本阶段按 [实现规范](../doc/done/cc-niri_Scroll_Layout_V2_Implementation_Spec.md) 的 P2 交付模拟矩阵。
生产 main 仍执行 P1 的 V1 保护入口，未构造/启用 V2 控制器，没有向当前桌面加载或安装组件。

## 代码与权威

- [ViewportPolicy](../src/kwin/layout/ViewportPolicy.js) 是唯一 V2 target camera 策略入口，复用 P1 center/fit。
  目标 camera 与观察到的 painted camera 分开；membership 变化优先从幸存者的已观察 visualRect 建立数值基准。
- [ContinuousViewportController](../src/kwin/layout/ContinuousViewportController.js) 使用调用方提供的同一个
  ColumnStore、主输出/实际工作区查询、WindowPolicy/WorkspaceMembership eligibility 和既有 LayoutTransaction。
  不创建第二份持久窗口集合、焦点 owner、Spring 或工作区快照存储。
- H/L、程序激活、Alt-Tab、历史焦点、可选 Dock 都调用同一 focus 方法；连续 H/L 以最新**意图焦点**推进，
  不被仍停留在旧窗口的未完成激活退回。只有 Dock 开启时接受 Dock 来源。
- 插入、关闭、移动、重排、宽度改变、mount/restoration 和 WorkArea/scale 变化以同一 JS batch 推导目标。
  一次有效 batch 只发一份 target intent/epoch；同步重复 adoption/activation/geometry 事件幂等。
  同步新增的独立窗口可并入同一 batch；scope mount 过程中不接受旧 activation。
- `ColumnWidthController` 新增 V2 delegate；经此 delegate 的宽度操作也走同一事件模型，
  不触发旧 Pair/Wide 动画。V1 和 P1 未提供 delegate 的默认行为不变。
- 工作区切换先查询实际工作区 ID，拒绝迟到的信号 scope。restore 接受**内存态** signed anchor，
  twoThirds 保持 center、half/full 保持 fit；重复相同 restore 不再次发 epoch。
  未改生产 protocol1/2 的快照读取/写入，P5 仍须版本化迁移。
- session 由调用方传入既有 runtime session ID；实例不生成新会话 authority。
  session/workspace/output identity/scope revision/epoch 校验拒绝旧 callback；同名输出对象替换也不能复用旧 source。
- WorkArea fallback/clip、gap clamp、scale fallback 诊断会保留到 intent。
  诊断标志变化也需要新目标，不能把 fallback 悄悄归一化成已确认的 clientArea。

## 绘制事实与阶段边界

`getPainted()` 是注入的只读事实接口：session、workspace/output、scope revision、epoch、sample serial、
camera 和按稳定 UUID 标识的 visualRect。P2 验证字段、范围、membership、重复 UUID 与单调性。
同一已验证 sample 在多个尚未绘制的成员变化之间，只复用其幸存窗口的原位置；不拿新 target 伪造 source。
目标 intent 深冻结，观察者不能修改已校验事实。

测试 helper 的 `paint()` **生成模拟观测**，不是真实 KWin paint、framePresented 或新时钟。
生产 Adapter 查询及真实 paint sample 与 Native epoch 的连接尚未实现，属于 P3/P4。
没有有效事实时标记 `continuity:unavailable`，不能将这种目标当作已证明连续的 Native 事务提交。
切换到另一工作区/输出，或空→首列时使用 `initial`，不复用历史 workspace camera 滑入。

输出仅为内部 `kind:scroll-layout-v2-intent`，携带 `v2-scroll` 或 `v2-column-geometry` 能力需求。
**不是 SCROLL/COLUMN_REINDEX wire 消息**，不调用 GeometryCommitter、Native arm、frameGeometry、真实 activation 或 D-Bus。
尤其 mixed-width 删除/重排保留逐列 source pose，不能以旧同宽 COLUMN_REINDEX 冒充。
P3/P4 必须通过原 membership → motion → arm ACK → geometry/activation 和 Rust Core 契约再消费这些意图。

## 验证与原始证据

[runtime 模拟](scroll-layout-v2-runtime.test.js) 新增17项，联合 P1 两文件为33项：

1. 六种焦点来源、camera 一致、宽度/prefix 不变、重复 activation 不发 epoch。
2. 五列混合连续 H/L 与反向，自动校验焦点 ID、camera、顺序和 issued epochs。
3. 关闭左/右/焦点、最后一个 mixed-width survivor、插入/重排/移列，保留模拟 painted pose。
4. 同步 adoption→activation 重入、一个 batch 多成员变化、无新 paint 的后续关闭、immutable source。
5. actual-workspace mount、signed anchor restore、重复 restore、旧 session/scope/epoch callback 拒绝。
6. 无效/回退 sample、未知/重复 UUID、面板/缩放变化、同名 output replacement、缺失连续性。
7. destroyed wrapper 不再读属性；离开工作区期间关闭只释放 membership，不发布/激活旧工作区。
8. Dock disabled、Dialog/Transient/Floating/Fullscreen/Secondary/Sticky、disabled/switching no-op。
9. 2000次插入/关闭（4000操作，最终generation4001）收敛到一个存活列、单份 target；stop 清空模型/输出引用。
10. 回调故障/同步 stop：抑制 target；cleanup failure 可观察，模型引用仍释放。

固定五列 `[half,twoThirds,full,half,twoThirds]`，W=2560/g=16，在模拟 paint camera=0 未更新时，
H/L 焦点序列为 `a1,a2,a3,a4,a3,a2,a1,a0`，目标 camera 为
`1484,3604,4876,6996,4876,3604,1484,0`，epochs 为2–9。
所有 source camera 仍为已观察的0，不取前一尚未绘制的目标。

```sh
node tools/build.js
node --test test/scroll-layout-v2-runtime.test.js \
  test/scroll-layout-v2-geometry.test.js test/scroll-layout-v2-width-cycle.test.js
CMAKE_BUILD_PARALLEL_LEVEL=2 node tools/check.js --native
```

- P2/P1：**PASS，33/33，退出0**；[TAP](scroll-layout-v2-p2-evidence/20261015/model-tests.log)。
- 最终完整门禁：**PASS，退出0**；[原始日志](scroll-layout-v2-p2-evidence/20261015/native-gate.log)。
- 前一轮完整门禁通过后补了诊断保留回归，因此重跑最终版本；重型门禁顺序执行，没有并发 Native 构建。

| 检查 | 结果 |
|---|---|
| `node tools/build.js` / `--check` | PASS，退出0 |
| `node tools/check.js --native` | PASS，111个JS测试文件；164个Node测试，fail=0；JS 43.59s |
| Rust 1.99.0 fmt / locked workspace all-targets clippy `-D warnings` / locked workspace test | PASS，71 tests、doc tests 0 |
| Bridge 既有 build / CTest | PASS，18/18，12.78s |
| Bridge private-bus restart/workspace/SCROLL/legacy/compatibility | PASS，不连接桌面 bus |
| Clip 既有 build / CTest | PASS，18/18，7.91s |
| Ring 既有 build / CTest | PASS，25/25，21.14s |
| Native production boundary / Plasmoid build | PASS，三个生产产物无 Legacy C++ policy |
| `git diff --check` | PASS，退出0 |

源码/已安装组件 SHA、工具链和命令记录见 [verification.json](scroll-layout-v2-p2-evidence/20261015/verification.json)。
P2没有CMake/FFI/Core改动，因此未重跑Core Debug/Release、umbrella、OFF构建；不把P0历史结果追记为本次验证。

## 资源、尚未实施和回滚

- 一个现有 ColumnStore + 一个 active scope；单份 latest intent 及其中的幸存者数值 source 为 O(当前列数)。
  临时验证/重排 Map/Set 在事件结束后释放；无按操作历史增长的队列。stop 清空几何、source、target、sample标量和输出引用。
  测试 observer 的 `plans` 历史只在 helper 中，压力测试主动清空，不进入生产。
- 新增 daemon、线程池、timer、Spring、帧时钟、QImage/texture、FFI handle、常驻 IPC callback 均为0。
  只有事件时 JS 布局/快照对象，未增加每帧 JSON、布局或诊断采样。
- **NOT MEASURED**：全项目/特性 PSS、Private_Dirty、真实对象/纹理、GPU归因、帧时间、4K60、30–60分钟增长；
  2000次模型操作不等于真实 Qt/FFI/GPU 生命周期验收，≤32/64MiB总预算和≤2/8MiB特性目标保持 Pending。
- **NOT IMPLEMENTED**：生产 V2 event wiring、实际 Native painted provider、partial input、原生几何/宽度 ACK、
  Rust continuous retarget、V2持久化和完整恢复。P2不修改 Rust/Native/Bridge/schema/Golden；真实 H/L 动画尚未启用。
- **NOT RUN**：实机部署、实际用户 Fcitx5 配置、DRM/同时混合 DPI、视觉确认和安全 stop/restore。
  模型 stop 没有 Native ownership，不能替代未来 park/disarm ACK 和全局 Recovery。
- 桌面无需回滚：未改变运行配置、安装文件、窗口或服务。
  仓库撤回仅移除 P2 新模块/helper/tests/report/evidence、撤销 V2 width delegate 和两项打包注册，再 `node tools/build.js`。
  保留 P0/P1及用户工作树，禁止整体 reset/stash。
