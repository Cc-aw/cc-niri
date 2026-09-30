# W1 — WorkspaceSnapshotStore

2026-09-30：完成纯 JS 数据模块，未接入 KWin、Window 或 DBus。
构建仅新增模块定义，未实例化 Store；现有 StartupLayout / Bridge protocol 1 行为保持不变。

## 接口约定

- `set(id, snapshot)`：规范化后存储并返回独立副本；空 ID 抛 TypeError。
- `get(id)`：返回独立副本；不存在返回 null。
- `has(id)`、`remove(id)`、`removeWindow(uuid)`：返回布尔值。
- `workspaceForWindow(uuid)`：返回 owner ID 或 null。
- `all()`：按 Map 插入顺序返回 Snapshot 副本数组；`clear()` 清理两张 Map。
- 同一 UUID 已属于其它 Workspace 时，set 抛 `duplicate-workspace-owner:<uuid>`，
  两张 Map 均不变。未来 TransferController 必须先 removeWindow，再写入目标 Snapshot。
- Snapshot 内重复 UUID 保留第一项；非法 UUID 丢弃。UUID 去外层花括号并转小写；
  Workspace 稳定 ID 仅 trim，不改变大小写。
- 只保留 columns、focusedUuid、viewportAnchor、viewport、presentation。
  widthMode 支持现有 half / third / twoThirds，默认 half；persistentWide 默认 false。
  失效的 UUID 引用清空，失效 Wide/Presentation 回退 pair/normal。
  Anchor delta 必须是有限非负 number，与 StartupLayout 的有效范围一致。
- Snapshot viewport 将 wide-focus 规范为 wide；未来 mount 再解析运行时 Column ID。
  此阶段保存稳态数据，未实现 Wide 恢复或 Workspace mount。

`migrateLegacyWorkspaceSnapshot(legacy, workspaceId, expectedTargetOutput)` 返回
规范化 Snapshot，非法协议、JSON、列 UUID、重复 UUID 或输出不匹配时返回 null。
legacy 可为对象或 JSON 字符串；workspaceId 由调用方提供当前 KDE Desktop 稳定 ID。
expectedTargetOutput 可选；传入时必须匹配旧 targetOutput。
旧协议的 contextual Wide 从 presentation.mode/windowUuid 转为 UUID viewport；
不推断旧协议没有保存的 persistentWide 偏好。

## 验证

先写 test/workspace-snapshot-store.test.js，再实现模块与最薄构建接入。
覆盖规范化、去重、数据副本、归属冲突原子性、替换、关闭窗口引用清理、
移除/清空、protocol 1 迁移与损坏数据拒绝。

`node tools/build.js` 与 `node tools/check.js --native` 通过：
52 个测试文件、Bridge / Viewport clip / Plasmoid 本机 native 构建。
远程 CI 未触发；此阶段不部署日用脚本。
