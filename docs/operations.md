# 监控告警与备份恢复

## 运行架构

保留 Web、CPU worker、PostgreSQL 和私有素材存储，增加一个独立 Node 运维进程。无需 Redis、Prometheus、GPU 或模型密钥。它默认每 30 秒检查 Web、数据库、存储、worker、全局任务队列和备份新鲜度；告警与通知 outbox 写入独立的主机目录，数据库不可用时仍能记录。配置页显示最近检测、活动告警、故障/恢复、最近成功备份和恢复演练。

检测连续两次异常后开告警，连续两次正常后关闭。同一次故障不重复开单；重启保留故障和通知状态。监控超过 120 秒没有更新，配置页显示过期。数据库不可用时网页登录依赖的 session 可能也不可读，可直接运行 `pnpm ops:status` 查看主机记录。整台主机宕机时本机进程无法发出通知，仍需外部可用性检测。

当前选择**本地告警记录 + 预留 Webhook**。不向外发通知；告警保存在 `OPS_STATE_ROOT/state.json` 并输出结构化进程日志。将来显式配置 `OPS_WEBHOOK_URL` 才启用通知；支持可选 Bearer token、5 秒超时、30 秒起指数退避（上限一小时）、故障与恢复按顺序发送。只有 2xx 才算送达；非 2xx 或网络失败保持待发送。投递至少一次，接收方以稳定的 `id` / `Idempotency-Key` 去重；不把地址、token、数据库密码或媒体内容写进告警。

## 配置与命令

Web 和运维进程共用以下环境变量，`.env.local` 已被忽略，不要提交密钥：

```dotenv
OPS_STATE_ROOT=/absolute/private/ops-state
BACKUP_ROOT=/absolute/private/backups
PG_BIN_DIR=/path/to/postgresql-17/bin
OPS_CHECK_INTERVAL_SECONDS=30
BACKUP_INTERVAL_HOURS=24
BACKUP_MAX_AGE_HOURS=26
OPS_WEBHOOK_URL=
OPS_WEBHOOK_TOKEN=
```

`OPS_STATE_ROOT`、`BACKUP_ROOT` 使用绝对路径，放在素材目录之外；前者不能只依赖数据库或故障的备份目的盘。若 PostgreSQL 客户端在 PATH 中，`PG_BIN_DIR` 可留空。支持 PostgreSQL URL 的 `sslmode` 参数；其他连接 URL 参数目前拒绝，避免导出和应用连接到不同目标。

```bash
# platform 目录；三项分别由进程管理器或不同终端运行
pnpm start
pnpm worker
pnpm ops

# 手动操作不需要停止 Web/worker
pnpm ops:status
pnpm ops:backup
pnpm ops:verify /absolute/private/backups/BACKUP_ID
```

配置备份目的目录后，首次运行自动备份，默认每 24 小时一次；失败后每小时重试。上次备份进程中断后，重启会识别失效进程锁并重新执行。备份失败、运行超过两小时、没有成功备份或成功备份超过 26 小时，都会成为监控异常。备份没有自动删除或保留天数策略；应按容量和业务要求另外安排异地复制与保留政策。

Linux 的三个 systemd 模板在 `deploy/systemd/`，示例部署目录 `/opt/aivideo/platform`、运行用户 `aivideo`、环境文件 `/etc/aivideo/platform.env`；按实际 Node 24 和应用路径调整。模板使用 `Restart=on-failure` 和私有 umask。本轮只交付模板，未在这台 macOS 上安装系统服务；本机当前为独立进程运行，开机自启和 Linux 主机目标验收另行进行。

## 备份内容与一致性

每次备份包含：

```text
BACKUP_ROOT/<UUID>/
├── database.dump        PostgreSQL custom archive
├── objects/<对象键>      快照引用的全部输入和归档媒体
└── manifest.json        版本、时刻、UUID、每个对象及 dump 的大小和 SHA-256
```

使用 PostgreSQL 只读 repeatable-read 事务导出快照，元数据枚举和 `pg_dump --snapshot` 使用同一快照，不暂停业务写入。快照后的新素材不会混入；快照引用的文件若被并发删除、内容改变或读取失败，整次备份失败，可重新执行。流式复制并对照数据库记录校验每个素材的大小和 SHA-256；`manifest.json` 最后写入，再原子发布完整目录。

导出 `public` 业务/账号表及 `drizzle` 迁移记录，包含任务快照、事件、声音库、工作流版本、供应商检查点和 outbox。排除 pg-boss 的瞬态队列 schema 与心跳数据，恢复后重建调度。只备份数据库登记的素材，不打包浏览器 IndexedDB/未保存草稿、孤立对象、临时探针、环境文件、模型密钥、PostgreSQL 全局角色或主机告警目录；这些运维配置需另行私密保管。

目录 0700、文件 0600，数据库密码通过子进程环境传入，不写入命令参数或浏览器报告。备份含账号和私有内容，必须按私有数据保管。SHA-256 验证完整性，不替代备份来源可信性或加密；只恢复自己的可信备份。实现参考 PostgreSQL 的 [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)、[快照同步](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION) 和 [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)。

失败目录不会被报告为成功；进程强杀可能留下 `.partial-*` 或锁候选文件，确认没有相关备份进程后可人工清理。不会根据年龄自动删除业务文件或备份。

## 恢复与切换

恢复命令只允许新的 `aivideo_restore_*` 数据库（测试可用 `aivideo_test_restore_*`），**拒绝已有数据库和非空目标存储**。数据库账号需要创建新库权限。开始前先完整验证清单、dump 和所有媒体；目标新库使用单事务 `pg_restore`，素材复制后逐个读回并校验，再记录恢复完成。

```bash
RESTORE_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/aivideo_restore_drill
RESTORE_STORAGE_ROOT=/absolute/private/restored-files
# 将以上变量设入进程环境后执行，不要把实际密码写入共享日志
pnpm ops:restore /absolute/private/backups/BACKUP_ID
```

S3 恢复单独使用 `RESTORE_S3_BUCKET`、`RESTORE_S3_ENDPOINT`、`RESTORE_S3_REGION`、`RESTORE_S3_ACCESS_KEY_ID`、`RESTORE_S3_SECRET_ACCESS_KEY`；目标 bucket 必须存在且为空，需要 List/Get/Put 权限。不会默认沿用源 bucket 或源存储路径。恢复期间不要让其他进程写入目标存储。

成功后查询新库任务、声音、工作流和素材，验证账号隔离、下载与素材复用。活跃任务 outbox 重置为待分发，pg-boss 由新 worker 重建，继续使用原任务 UUID 和持久检查点；未知提交与归档失败保留原状态，禁止盲目重新生成。当前默认模型适配器关闭，恢复不会接通真实 API。

恢复失败时保留隔离目标用于排查，不覆盖或切换当前工作区；重试需另取新库和空存储。验收完成后，停止旧 Web/worker/ops，再把三者的数据库和存储配置同时切换到恢复目标后启动。恢复命令不会自动切换连接，也不会自动启动目标 worker。跨代码版本恢复需先确认迁移兼容。

## 验证边界

服务端测试使用真实 PostgreSQL `pg_dump`/`pg_restore` 和独立新库，验证图片、视频、语音、声音库、工作流、账号隔离、素材读回、复用与待执行任务恢复；验证一致快照排除期间新增对象、损坏备份拒绝、已有目标拒绝、备份盘错误记录、监控 SIGKILL 重启、故障/恢复去重和 Webhook 失败重试。本机 S3 协议接收器使用实际 AWS SDK 验证空 bucket 拦截及恢复再备份；不代表远程 S3 账号/网络验收。

本机正常工作区已创建、校验备份并恢复到独立演练目标。正常工作区当前没有素材，演练的媒体数为 0；三种媒体恢复由隔离测试样本验证。桌面及手机宽度的配置页验收与最新测试结果见 [实施验收记录](superpowers/plans/2026-10-15-operations-recovery.md)。

尚未验收：异地备份、整机灾难恢复、真实远程 S3、Linux systemd/开机自启、外部通知收件方和真机 Safari。真实模型 API 始终关闭。
