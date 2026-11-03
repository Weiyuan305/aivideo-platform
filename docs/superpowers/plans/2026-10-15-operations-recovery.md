# 监控告警与备份恢复实施计划

> Main agent executes inline under the user's authorization; no Git mutation, real model requests, external notification delivery or production restore.

**Goal:** 数据库故障时仍有持久告警；数据库与素材组成可校验的一致备份；恢复到新的隔离数据库/存储后可以查询、下载、复用和继续任务。

**Architecture:** 独立 Node 运维进程复用现有健康检查，原子文件记录故障状态与通知 outbox，不依赖 PostgreSQL 写告警。数据库导出快照同时供元数据枚举和 pg_dump 使用，流式复制快照引用的素材并核对 SHA-256。pg_restore 只允许新库与空目标，排除瞬态队列，按持久任务 outbox 重建调度。

**Tech Stack:** Node 24、现有 postgres.js / AWS SDK / Vitest、PostgreSQL 17 的 pg_dump / pg_restore。无需新依赖、Redis、GPU、模型或监控云账号。

## Task 1: 一致备份与安全恢复

Files: `packages/contracts/src/operations.ts`, `packages/server/src/ops/state.ts`, `pg-tools.ts`, `backup.ts`；`storage.ts` 增加空目标检查；`tests/server/backup.test.ts`。

Interfaces: `createBackup(app,url,{root,stateRoot,pgBinDir}) → manifest`；`verifyBackup(directory) → manifest`；`restoreBackup(directory,{databaseURL,storage,pgBinDir}) → report`。备份目录包含 `database.dump`、`objects/<原对象键>`、`manifest.json`；失败只有未发布的临时目录，不成为成功备份。

- [x] 测试先定义：真实 pg_dump/pg_restore；图片、视频、录音、声音、工作流、任务、迁移和权限信息恢复；快照后的新增记录不会混入；丢失/损坏文件或 dump 拒绝恢复；现有库与非空存储拒绝覆盖。
- [x] 实现只读导出快照、流式复制、原子发布、哈希校验，错误记录不回显路径和密码。pg_dump 连接参数通过进程环境传入，不放密码到参数或日志。
- [x] 恢复只创建 `aivideo_restore_*` / `aivideo_test_restore_*` 新库；先验证所有备份内容；失败标记保留隔离目标供排查；不更改当前运行连接。恢复后清空瞬态心跳并重置活跃任务 outbox，未知提交和归档失败保留人工处理状态。

## Task 2: 持久告警与周期运维

Files: `packages/server/src/ops/monitor.ts`, `scripts/ops.mts`、package scripts / env / Linux service templates；`tests/server/monitor.test.ts`。

Interfaces: `Monitor.tick()` 检查 Web、数据库、存储、worker、全局队列和备份新鲜度；`OpsStore.change(fn)` 原子持久化。默认 30 秒一轮，连续 2 次失败开告警、连续 2 次恢复关告警。Webhook 未配置只保存本地；配置后持久重试，收到 2xx 才标记送达，恢复通知按顺序处理。

- [x] 本机接收器验证故障/恢复、去重、防抖、重启持续状态、Webhook 超时/失败与重试。实际数据库不可达和损坏存储仍落本地告警。
- [x] 实现单实例进程锁、周期检测、手动备份/校验/恢复 CLI；配置后每天备份，失败记录与过期备份进入告警。不自动删除备份，不自行注册外部通知或宿主机服务。
- [x] 复用系统进程管理的轻量 service 模板和清晰命令，监控进程停止时面板显示过期。

## Task 3: 可见状态与整体验收

Files: 账号保护的只读 `/api/workspace/operations`、配置页 `operations-panel.tsx`；README 与运维手册。

- [x] 面板展示监控最近检查、活动告警、通知积压、最近成功备份和恢复校验；不返回备份路径、连接串、个人内容或 Webhook。
- [x] 运行完整单元/服务端闭环、lint/build/format/source 校验；用隔离恢复库重新执行任务、读媒体、验证账号隔离。桌面/手机面板验收。
- [x] 为本机正常工作区启动独立运维进程并创建真实本地备份；不对正常库制造故障或恢复覆盖。保留 Web/worker/ops，停止测试服务，记录证据与远程/异地/真机的剩余边界。

## 验收记录 · 2026-10-15

- 完整单元测试 45/45、完整服务端测试 36/36；lint/typecheck/build/format 与 62 个固定源码来源校验通过。通知测试追加真实 5 秒超时场景后，相关 3 项重跑验收。
- 真实 PostgreSQL 工具备份并恢复到新库；恢复后图片、视频、语音、声音、工作流、任务及迁移记录可读取，账号隔离、素材复用和活跃任务继续执行通过。快照期间新增素材未进入当次备份。实际 AWS SDK 在本机 S3 协议接收器完成空 bucket 检查、恢复读回和再次备份。
- 故障检测涵盖真实数据库不可达、损坏存储路径、无响应 Web、worker 停止/恢复和 SIGKILL 后监控重启。通知去重、防抖、持久 outbox、503/超时/重试及恢复通过；备份目录不可写 → 本地告警 → 修复源文件并重新备份 → 告警恢复通过。
- 内置浏览器 `http://127.0.0.1:3000/settings`：桌面 1422×800、手机 390×844/320×568；运维面板正确展示在线、历史故障已恢复、备份和恢复时间、本地记录模式。刷新有效，无横向溢出，无相关控制台错误或框架错误遮罩。
- 正常工作区备份 `3b22d2a9-a097-4299-9a78-3f0759ebf608` 已校验，恢复到新的 `aivideo_restore_drill_20261015`，原连接未切换。正常库当前 0 个素材，媒体恢复来自独立测试库的固定样本。演练目标保留供检查，HTTP 测试服务和失败的空测试恢复库已清理。
- 当前本机保留 Web、CPU worker、独立运维进程；正常模式没有外部通知或真实模型请求。Linux systemd 模板已交付但未安装到 macOS。异地备份、整机灾难、远程 S3、系统服务/开机自启和真机 Safari 尚未验收。
