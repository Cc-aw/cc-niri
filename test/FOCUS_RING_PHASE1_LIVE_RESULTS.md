# Focus Ring Phase 1 静态实机验收

日期：2026-10-04。当前状态：已部署并启用，自动加载 / 卸载检查通过；用户确认单一 owner，圆角 / 线宽样式已由用户验收通过，全屏 / 关闭 / 点击也通过；随后发现跨应用颜色不一致，已部署独立绘制修复，用户已确认颜色与圆角正常，新 renderer 全屏与独立开关也复验通过，静态 Phase 1 实机验收完成。

## 部署与自动检查

- 本机 KWin 6.7.5，主屏 eDP-1；部署前后 KWin PID 均为 2088。
- 本轮只安装 Focus Ring 原生库与终端控制脚本，未重启 KWin / Plasma，未替换已验收的 Spring、布局脚本或 Bridge。
- 插件发现链接：`~/.local/lib64/qt6/plugins/kwin/effects/plugins/cc-niri-focus-ring.so`。
- immutable canonical：`~/.local/lib/cc-niri/focus-ring/3b9524d020ec7e4c7f402af9615bf82d4578457a3ccd98815fb3a9d68c6f1361/cc-niri-focus-ring.so`。
- 首次加载及卸载后重新加载的诊断：active=true、targetOutput=eDP-1、width=2、color=#7FC8FF。
- off 后 isEffectLoaded=false，诊断 endpoint 删除；重新 on 后恢复同一 owner。静态画面无残留须人工确认。
- 本轮日志含 READY / ARM / CLEAR，检查期间 KWin 无重启，未见新增崩溃信息。
- 82 个 JS 回归通过；Focus Ring 3 项原生 CTest 通过；安装测试覆盖 clip / ring 两种库，启停测试覆盖 opt-in 恢复、失败不写配置、ring 开关保持布局 / Bridge 运行。

备份目录：`/tmp/cc-niri-focus-ring-static-backup-20261004-6o8_f1ih`。包含 kwinrc、旧终端脚本、原安装路径 manifest、PID、smoke-result.json、deployment.json 与 kwin.log。

首次实机检查辅助脚本对 DBus `(false,)` 使用了 Python literal_eval 导致检查中止；插件按异常清理路径关闭，KWin 未重启。修正检查解析后重新运行通过，原输出保留在 deployment-first-verification-attempt.json；插件源码未因此修改。

自动回归日志：`/tmp/cc-niri-focus-deployment-gate.log`、`/tmp/cc-niri-focus-deployment-tests.log`。

## 终端控制

```sh
cc-niri focus-ring on
cc-niri focus-ring off
cc-niri focus-ring status
```

开关独立于布局 / Spring。on 必须有已运行的 cc-niri，成功加载才保存 opt-in。off 关闭并取消 opt-in；cc-niri stop 卸载边框但保留 opt-in，start / restart 根据 opt-in 恢复。install.sh 构建并通过 immutable 安装新插件，新用户默认关闭；uninstall.sh 随 stop 清理边框并移除发现链接与偏好。旧版本 canonical 文件保留，避免破坏已映射的 inode。

## 人工验收

以下为样式版本结果；随后部署的 [颜色一致性 renderer](FOCUS_RING_COLOR_RESULTS.md) 颜色与圆角已由用户确认正常，全屏与独立开关也已由用户复验通过。

- 第一轮：用户明确确认边框只留在当前窗口；同时反馈 2px 过细、圆角显示不一致。已按反馈调整为 4px 并匹配当前 12px 圆角，[调整记录](FOCUS_RING_STYLE_RESULTS.md)。用户确认“粗细合适，圆角都正常”，样式验收通过；内容点击随第二轮确认通过。
- 第二轮：用户确认“全屏、关闭清理和点击都正常”。native fullscreen 隐藏 / 恢复、关闭窗口清理和内容点击人工验收通过。
- 第三轮：新 renderer 用户确认“全屏和独立开关都正常”，off 无残留、on 恢复及全屏隐藏 / 恢复通过。

这轮只验收静态 POC；Spring / retarget、Wide 非等比缩放下固定粗细、Maximize 边缘和主屏 fractional scale 的完整视觉矩阵仍留后续，不作为已通过项。
