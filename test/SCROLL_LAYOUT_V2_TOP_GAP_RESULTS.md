# Scroll Layout V2 独立顶部间距

2026-10-16。用户明确只缩小顶部。自动审批拦截了把统一ScrollLayoutGap改为12的旧请求，该命令没有执行；统一gap保持16。

新增 `ScrollLayoutTopGap`（-1继承统一gap，配置范围-1…1000），仅控制正常V2列的顶部额外留白。默认兼容原行为；本机目标值8。列宽、横向camera、左右/底部/列间距仍由原ScrollLayoutGap=16决定。V1和副屏布局不变。顶部避让、纵向client整数网格及严格ACK保留。

JS geometry携带topGap；统一的layoutRect helper供实际窗口投影、P3和P4 producer使用。Controller复制和scope比较包含topGap，避免把高度变化误当camera-only滚动。Native接收既有layoutRect，Rust/FFI/Bridge/协议和动画参数没有改动。持久锚点仍只保存既有水平basis，配置单独保存。

回归覆盖旧默认、顶部16→8后三档列宽/camera/底边不变、生成入口实际R/F和150% client buffer ACK。完整JS **235项PASS**、私有150%+Fcitx5 **37/37 PASS**，源码与未变Native SHA见[validation](scroll-layout-v2-p6-evidence/20261016/top-gap/validation.json)。实际部署与几何见[live-verification](scroll-layout-v2-p6-evidence/20261016/top-gap/live-verification.json)。备份路径由该记录给出，原稳定版备份继续保留。

本机51px顶栏经client grid有效预留52px；预期窗口顶端68→60、高度1356→1364，底边均1424，左右位置和宽度不变。此数值为目标机器150%条件；视觉验收以用户反馈为准。

没有新服务、连接、timer、动画时钟、Native句柄/纹理或无界缓存。未执行内存/4K60长测，全项目资源仍NOT MEASURED。

## 前次实机状态：恢复确认阻止热重载（历史）

顶部独立8 / 其余统一16的配置和新脚本包已安装；**当前旧运行时仍未生效**。既有安全stop的Native退休成功，但一个客户端的恢复几何未确认，Bridge报告blocked/restoredCount=1，CLI在卸载之前退出1。旧恢复逻辑会锁住重试，当前布局已暂停。未伪造ACK、卸载正在运行的组件或强杀/重启KWin。为保持安全边界，仅升级磁盘脚本包供下次正常登录使用，live session保持旧blocked状态；待用户保存工作并正常注销登录后验证y=60等实机条件。最终状态为INSTALLED_PENDING_NORMAL_RELOGIN，不能记顶部实机PASS。

相关配置/布局与组件备份：`/tmp/cc-niri-v2-top-gap-8-20261016`，安全stop失败原始状态和日志同目录。原全局gap=12命令被自动审批拦截且未执行；只顶部变更的安全替代路径获准执行。

## 当前状态：经明确批准完成热恢复，顶部设置已生效

用户在了解自动ACK失败和逐窗确认替代方案后，明确回复“好的 重新加载”。再次只读审计全部存活KWin窗口，六个存活受管窗口均可见且在输出内；Native Scroll / Workspace / handoff均停用，pending buttons/touches为0。以这次人工批准作为恢复例外，只卸载已停用的旧Script并加载磁盘上的新Script；没有伪造Bridge ACK，没有重启KWin、Bridge、Native插件或关闭应用。

实机核验PASS：新session的recovery=running，Native source有效且completed；painted与真实frame的y均60、高度均1364；旧顶端68→60，底边均1424，既有列宽模式保留。Partial邻居的真实安全frame.x可以与visual.x不同，此为既有裁切契约，不作为顶部验证失败。顶部配置8、统一gap16。启动区间无JS异常或再次停用，KWin PID2075与Bridge PID754130前后未变。无需注销。

最终机器记录见[live-verification](scroll-layout-v2-p6-evidence/20261016/top-gap/live-verification.json)；原阻塞记录见[历史记录](scroll-layout-v2-p6-evidence/20261016/top-gap/blocked-before-approved-reload.json)。该次人工恢复不把原自动ACK改记PASS，现有自动恢复永久锁住重试的问题仍待修复；不会把一次批准变为以后自动跳过门禁的默认行为。用户对当前顶部间距与重载后观感的确认见下文；P6完整性能/资源验收仍Pending。

## 2026-10-16 用户确认与Git存档

用户在热恢复生效后回复“没有问题 git存档”，本次顶部间距及重载后目测验收记PASS。只顶部8、其余16的实现、生成包、235项JS/37项私有KWin回归、实机几何证据及审批恢复例外一并存档。该确认不扩大为全V2交互矩阵、4K60、mixed-DPI专项或全项目内存长测通过；自动恢复ACK超时后无法重试的问题仍未修复。
