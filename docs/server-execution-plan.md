# 统一任务、后台执行与文件归档：实施与验收

日期：2026-10-13。范围为不依赖模型 API 密钥的基础闭环，不包含真实生成效果或公网发布。

2026-10-14 补验：通过 Codex 内置浏览器跑通三类媒体提交、任务/历史、素材复用、工作流冻结版本与重跑；默认禁用模型时的待接入、取消与重试也已检查。最终单元测试 43/43、服务端集成测试 20/20 通过，类型、构建、格式及 62 份来源快照校验通过。成功媒体仅来自独立测试数据库中的固定样本。

## 已实现

- [x] 统一任务提交/查询/动作：服务端保存请求、工作流冻结快照、幂等键、重试尝试、事件和供应商检查点。任务中心、历史、工作流运行记录共用 `/api/jobs`。
- [x] 任务与 outbox 同事务，复用 pg-boss 持久队列，独立 CPU worker；检查点按节点保存并调度下一步。使用数据库锁阻止同一个任务并发执行。
- [x] 提交检查点与取消共用事务锁；区分取消申请/供应商确认，保留竞争中完成的媒体。提交未知禁止盲目重试；核对复用请求 ID。
- [x] 私有输入上传、格式头与大小校验、流式归档、SHA-256、确定性输出对象键、私有下载和 Range。归档失败按原输出重试，不重复提交模型。
- [x] 素材/声音/工作流/任务的 session 所有权、Origin 校验和引用删除保护；声音库可复用参考录音。已保存版本和任务冻结快照保护资源。
- [x] 前端按配置选择服务端或浏览器模式，保留原 IndexedDB，不静默迁移或失败回退。Studio 提交显示任务 ID 和详情入口；服务端状态定期刷新。
- [x] PostgreSQL 与 HTTP 集成闭环：幂等、权限、取消竞争、独立进程恢复、三种媒体归档、资源复用、节点归档重试、版本快照和回调去重。
- [x] 类型、单元测试、生产构建、格式和来源检查通过。原渲染/点击缺口已在 2026-10-14 补验，见上方记录。

## 复用与自研边界

| 模块 | 具体使用 | 平台自研 |
| --- | --- | --- |
| 底座/Studio/画布 | 已固定 SHA 的 SaaS Starter、Open-Generative-AI、Vibe 组件，以及 React Flow | 统一 API 桥接、任务反馈与服务端资源模式 |
| 后台队列 | pg-boss 12.37.1 原生持久队列、租约、heartbeat、重投递与维护 | PostgreSQL outbox、任务锁、业务状态、节点检查点和恢复策略 |
| 文件存储 | AWS SDK client-s3/lib-storage/presigner 3.1150.0 | 本机私有磁盘适配、文件校验、归档幂等、资产元数据和访问控制 |
| 账号/数据库 | Better Auth、Drizzle、PostgreSQL | 资源归属、引用保护、工作流版本与快照核验 |
| 真实模型 | `ProviderAdapter` 接口和 `disabledProvider` | 后续厂商路由、验签 webhook、输入 URL、错误/取消语义规范化 |

轻量部署只需要 Next.js Web、Node worker 和 PostgreSQL；没有 Redis、GPU、模型权重、训练服务或自托管 Trigger.dev。选择 pg-boss 使队列不依赖云端密钥；Trigger.dev 只保留未来托管调度边界。S3 可替代共享本地目录，但不是本机验收的前置条件。

## 验证证据

### 无数据库测试

`pnpm test`：**29/29 通过**，覆盖已有模型/协议/状态机/DAG，以及 7 条本机地址校验回归。NextRequest 会将回环地址规范化为 localhost；本机模式同时核验原 Host、协议、端口与显式回环配置，避免误拒绝 127.0.0.1。

### PostgreSQL 和最终生产构建 HTTP 闭环

`pnpm test:server`，明确配置 TEST_DATABASE_URL、TEST_HTTP_URL、TEST_HTTP_STORAGE_ROOT：**19/19 通过**。

| 套件 | 数量 | 实际覆盖 |
| --- | --- | --- |
| closure.test.ts | 12 | 创建/outbox 原子性、跨账号相同幂等键隔离、文件持久化、取消竞争/确认、归档独立重试、未知提交不重发、重复/失败回调、重试动作去重、删除草稿后快照保留、工作流失败节点归档恢复 |
| http.test.ts | 5 | 真实 Better Auth 注册/session；401/403/404/409；私有上传/下载/Range；图片输出复用为视频输入；参考录音→声音库→语音任务→私有文件；冻结工作流传递真实归档 ID；格式错配拒绝 |
| worker.test.ts | 1 | 独立 Node worker，供应商请求 ID 持久化后 SIGKILL，启动新进程恢复并复用原请求 ID；随后运行完整 DAG 试运行 |
| s3.test.ts | 1 | 实际 AWS SDK 对本机协议 fixture 的 PUT/GET/DELETE、SHA-256 和 900 秒签名 URL |

FixtureProvider 只在独立测试数据库中使用，不进入产品 API。测试媒体是固定 PNG/WAV/MP4 字节，证明状态、传输、归档与复用，不证明模型效果、语音相似度或视频可播放质量。S3 用例不证明远程账号/权限已验收。手动 execute 的集成用例会清理其测试 outbox，避免后续套件使用其他文件目录执行残留任务。

### 构建与边界

- `pnpm lint`：浏览器/服务端边界扫描、Web/worker/server tests TypeScript 通过。
- `pnpm build`：Next.js 16.4 生产构建通过。
- `pnpm verify:sources`：62 个固定来源快照哈希通过。仅更新 shell 和三个 Studio 的改造后哈希，保留原始 upstream SHA。
- `pnpm format:check`：通过。

### 实际本机启动

已在 `http://127.0.0.1:3000` 启动最终生产构建，在独立进程启动 `pnpm worker`。使用未启用任何模型的真实产品入口，通过 HTTP 客户端验证：

1. 创建返回 202，后台完成三节点 DAG 试运行；输出是计划引用，没有媒体文件。
2. 图片请求保存为服务端任务，由正常 worker 进入 blocked / GENERATION_NOT_ENABLED，无供应商操作或生成文件。
3. 验收任务随后通过 HTTP 动作删除，未把 fixture 媒体写入产品工作区。

`.runtime/preview-acceptance.json` 保存该次 HTTP 验收结果；不是浏览器 UI 验收。

## 当前本机运行配置

已创建被忽略的 `apps/web/.env.local`，只含本机配置和空模型密钥。数据库为回环端口 55435 的 aivideo_local；测试库为独立 aivideo_test。PostgreSQL 数据、日志与私有文件位于被忽略的 `.runtime/`，不属于源码交付。

当前 PostgreSQL 由本机 Homebrew PostgreSQL 17 启动。重启电脑后，若它尚未运行，可在 platform 目录执行：

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D .runtime/postgres -l .runtime/postgres.log -o "-h 127.0.0.1 -p 55435 -k /Users/weiyuan/AIvideo/platform/.runtime/pg-socket" start
pnpm start
# 另一个终端
pnpm worker
```

如使用其他机器或数据库，请按 README 配置自己的 PostgreSQL，并执行增量迁移。公网部署须关闭 LOCAL_WORKSPACE_ENABLED，启用真实 session 和随机账号密钥；文件需要持久卷或私有 S3。

## 尚待验收与后续工作

- 内置浏览器的桌面/移动核心路径已补验；真机 Safari、其他浏览器及公网环境尚未验收。
- 图片、视频、语音真实模型适配器保持禁用；需按厂商文档接入输入签名 URL、提交/查询/取消、回调验签和真实媒体样本。
- 本地告警与数据库/素材备份恢复已补齐，见 [运维手册](operations.md)。远程 S3、系统进程管理、公网认证/限流、异地备份、垃圾文件回收与成本结算尚未验收。
- 2026-10-15 已补齐三个列表的服务端分页搜索、worker 心跳与数据库/存储健康；不支持任意 ComfyUI/Python 节点、GPU/训练、计费充值、社区和多人协作。后续仍需大规模搜索与目标部署环境验收。

运行方法及真实 API 接口边界见 [README](../README.md)。
