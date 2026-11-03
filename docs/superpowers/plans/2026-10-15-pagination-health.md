# 服务端分页搜索与运行健康实施计划

> Inline execution: main agent implements and accepts this already-authorized scope. No Git operations or model calls.

**Goal:** 三个列表可跨越 500 条记录进行服务端检索、分页与复用；配置页反映数据库、私有存储、后台心跳和当前账号队列状态。

**Architecture:** PostgreSQL 负责账号隔离、筛选、计数和 `(created_at,id)` 游标分页；Web 只请求当前页。现有 CPU worker 每 5 秒记录队列连接/分发状态，20 秒未更新视为失联。健康探针读写并移除专用临时对象，缓存 30 秒，避免重复 I/O。不新增 Redis、GPU 或云服务。

## Task 1: 分页与引用闭环

Files: `packages/contracts/src/lists.ts`, `packages/server/src/listing.ts`, `packages/db/src/schema.ts`, 增量迁移；`service.ts`、两个列表 API；`packages/core/src/pages.ts`；任务/素材页面与公共分页组件。

Interfaces: `JobListQuery {limit,q,cursor,kind,status,mode,workflowId}`、`AssetListQuery {limit,q,cursor,kind}`；`ListPage<T> {items,total,nextCursor,summary?}`。默认 20 条，上限 500 条供现有参考选择器兼容；页面使用 20/24 条。游标绑定账号和筛选，拒绝错误游标。任务创建时间落列并回填旧记录。

- [x] 测试：超过 500 条、同时间戳、状态变化和新插入不导致跨页重复；字面量 `%/_`、完整提示词与 ID 搜索；历史排除试运行；跨账号隔离和非法参数。
- [x] 实现分页 SQL、索引和 API，当前页前后翻页、筛选重置、读取失败重试和浏览器模式回退。
- [x] 工作流执行与前端校验按引用 ID 读取，验证旧素材仍可提交、执行并归档；工作流运行记录按 graph ID 查询。

## Task 2: 心跳与健康

Files: `packages/server/src/health.ts`, `worker.ts`, `storage.ts`；心跳表/迁移；`/api/health`、`/api/workspace/health`；配置页健康面板。

Interfaces: `WorkspaceHealth {status,checkedAt,generationEnabled:false,database,storage,worker,queue?}`。公开接口只返回组件状态；队列数量与心跳详情要求当前账号会话。数据库/存储探测超时有限，错误不回显连接串或路径。队列统计区分排队、执行、归档、归档失败、待核对、待分发及最老排队时间。

- [x] 测试数据库不可用、存储读写失败、探针清理、心跳正常/过期/停止，队列账号隔离和积压。
- [x] 独立 worker 启停/崩溃恢复仍适用；心跳不会取消任务或清理业务资源。
- [x] 配置页展示实际结果、检查时间、刷新和恢复，不把“配置已填写”当作连通成功。

## Task 3: 集成与验收

- [x] 应用增量迁移到独立测试库，运行 `pnpm test`、完整 `pnpm test:server`（包含 HTTP）、lint、build、format、来源校验。
- [x] 内置浏览器验收分页搜索 → 详情 → 旧素材复用/工作流；桌面和手机宽度；健康正常 → worker 停止 → 重启恢复。
- [x] 正常工作区应用迁移、恢复 Web/worker，清理临时服务；更新 README 并报告证据与剩余限制。

## 验收记录 · 2026-10-15

- 单元 45/45；服务端完整 28/28，包含 HTTP 真实 session、三种媒体/工作流、SIGKILL 恢复；lint/build/format/source 校验通过。健康测试追加测试库强校验后，相关 3 项重跑通过。
- UI 隔离库初始 521 个任务、522 个素材；桌面 1422×800、手机 390×844 和 320×568。任务 20/页、素材 24/页前后翻页不重叠；历史筛选结果、搜索旧记录、筛选往返重置通过。旧图片用于工作流，输出固定 MP4 归档并可读取；旧录音用于克隆，固定 WAV 归档；命名声音可补读旧录音。
- UI 见证 worker 未启动及待接管队列、恢复执行清空队列、正常停止、SIGKILL 后心跳过期、重启恢复。故障数据库、故障本地存储及 S3 协议探针由集成测试覆盖。
- 正常库 `aivideo_local` 已备份并应用迁移，3000 Web 与默认 worker 在线，数据库/存储/心跳显示正常。3002/3003 与隔离媒体 worker 已停止；模型适配器保持关闭。
- 未验收：真实供应商调用和模型效果、远程 S3 账号/网络、真机 Safari、公网运行、告警与备份恢复、大规模搜索负载。
