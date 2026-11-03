# AIvideo · 全 API 创作平台

图片、视频、语音克隆全部预留托管 API，不部署模型、GPU、训练或微调服务。已完成短剧项目、分集、分镜、角色/场景版本、候选与采用版、剪辑时间线与真实 MP4 导出，以及服务端统一任务、独立后台执行、私有素材归档、列表分页搜索、运行健康、本地告警和数据库/素材备份恢复；**真实模型适配器仍关闭，填写模型密钥不会发起付费请求**。

## 运行方式

要求 Node.js **24 LTS**、pnpm **10.22**。有两种明确的数据模式：

| 模式 | 数据和执行 | 用途 |
| --- | --- | --- |
| 默认浏览器模式 | IndexedDB、页面内试运行，无数据库要求 | 保留原有本地编辑和数据 |
| `WORKSPACE_BACKEND=server` | PostgreSQL 保存账号、任务、快照和素材元数据；独立 Node worker；本地私有目录或 S3 保存文件 | 本轮的后台闭环 |

切换模式不会迁移或清除原浏览器数据。服务端请求失败时不会偷偷退回浏览器存储。任务/历史/工作流运行记录读取同一套服务端任务。开发时修改服务端 service 或环境变量后，应重启 Web 与 worker，避免进程内连接实例仍使用旧配置。

### 浏览器模式

```bash
cd /Users/weiyuan/AIvideo/platform
pnpm install --frozen-lockfile
pnpm dev
```

打开 <http://127.0.0.1:3000>。原本地试运行继续可用；该模式关闭页面后不执行。生成提交会保存本地参数，然后停为“待接入 API”。

### 服务端模式，无需模型密钥

准备 PostgreSQL 17（本轮验收版本）和私有文件目录；Web 与 worker 使用**同一个数据库和绝对存储路径**。本机模式仅绑定回环地址，不需要 Docker 或 Redis。

```bash
cp .env.example apps/web/.env.local
```

编辑该文件：

```dotenv
WORKSPACE_BACKEND=server
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/aivideo
PRIVATE_STORAGE_ROOT=/absolute/path/to/private-files
BETTER_AUTH_URL=http://127.0.0.1:3000
# 只用于本机单人工作区；此时 BETTER_AUTH_SECRET 留空
LOCAL_WORKSPACE_ENABLED=true
```

初始化数据库后分别启动 Web 和 worker：

```bash
# db:migrate 不自动读取 .env.local，命令行只引用变量，避免把密码写进历史
set -a
. apps/web/.env.local
set +a
pnpm db:migrate
pnpm dev
# 另开终端，在 platform 目录执行；worker 自动读取 apps/web/.env.local
pnpm worker
```

正式构建使用 `pnpm build`、`pnpm start`，worker 仍需独立运行。配置监控和备份后，另运行 `pnpm ops`；进程管理器分别管理 Web、worker 和运维进程。不要把后台执行依附于 HTTP 请求或浏览器生命周期。首次执行会由 pg-boss 自动创建其队列表，数据库账号须具备创建 schema/table 的权限。

本机单人模式只接受显式配置的回环 origin，共用 `local-server-workspace` 用户。**多人或公网部署须关闭 `LOCAL_WORKSPACE_ENABLED`，配置至少 32 字符的随机 `BETTER_AUTH_SECRET` 和实际 `BETTER_AUTH_URL`，注册/登录后按 session 隔离资源。** 不应把本机模式代理成公网服务。Web 写接口校验 Origin；用户身份来自 Better Auth session，不接受前端传 owner ID。

本机文件目录需持久卷、访问权限及备份；多个 Web/worker 实例必须共享这个目录，或切换私有 S3。使用 S3 时配置 `S3_BUCKET`、`S3_REGION`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`，兼容服务可额外配置 `S3_ENDPOINT`。S3 适配器使用 AWS SDK 的流式上传/下载和 15 分钟签名输入 URL；文件读取仍经会话验证。远程 S3 的账号、CORS、权限和网络尚待实际部署验收。

## 已实现的闭环

| 模块 | 当前行为 | 后续真实接入 |
| --- | --- | --- |
| 短剧项目 `/projects` | 项目搜索/分页，分集剧本、分镜排序、固定角色/场景版本、参考图片和声音绑定、上传候选与明确采用；复用任务/工作流并保护引用 | 剧本自动拆镜、模型多参考能力 |
| 剪辑与成片 | 已采用镜头/上传素材、排序和裁剪、实时多轨预览、配音波形裁剪、交叉淡化/擦除、字幕样式与 SRT、版本保存、后台 MP4 导出和素材复用 | 自动转录、调色/关键帧、任意视频叠加、多字幕层与 4K 输出 |
| 图片、视频、语音 Studio | API 模式提交返回 202 和任务 ID，立即进入统一任务中心；保留草稿和素材复用 | fal / Replicate 或其他厂商适配器 |
| 统一任务与历史 | 服务端快照、事件、节点检查点、供应商请求 ID、独立重试尝试、分页搜索、筛选、导出、结果链接 | 配额、成本结算 |
| 后台执行 | PostgreSQL outbox 与任务同事务；pg-boss 持久队列；独立 CPU worker；心跳、队列状态、重启后恢复 | 多供应商轮询/验签回调与告警 |
| 素材列表与运行健康 | 服务端分页、文件名/ID 搜索、旧素材按引用 ID 补读；数据库查询与私有存储读写探针 | 大规模搜索性能、外部监控和部署验收 |
| 文件归档 | 私有输入上传、格式头/大小校验、流式写入、SHA-256、输出确定性对象键、下载与 Range、归档独立重试 | 实际模型结果与远程存储验收、转码和缩略图 |
| 声音库 | 私有参考音频、命名/重命名/试听、克隆任务引用、所有权和删除保护 | IndexTTS 托管版本 schema 验证、音频标准化 |
| 工作流 | 六类节点、React Flow、版本和冻结快照、DAG 传值；每个节点单独持久化并调度下一步 | 真实媒体节点、模板发布为一键应用 |
| 账号与资源 | Better Auth session；跨账号任务/文件/声音/工作流隔离；已保存版本与任务引用保护 | 公网限流、账号生命周期、运营管理 |

短剧工作台仅在服务端模式启用，使用原 PostgreSQL、私有素材存储和 CPU worker，无新增服务。升级前先 `pnpm ops:backup`，再应用数据库迁移（本次新增 `0006_violet_bloodaxe.sql`）。使用流程、数据边界和验收记录见 [短剧项目使用说明](docs/production-workspace.md)。

剪辑增量不新增数据库迁移。Web 和 worker 需要 FFmpeg/ffprobe（含 libx264、AAC、overlay、xfade、acrossfade）与相同中文字体，分别支持波形/字幕实时预览和最终编码；时间线和合成任务复用原 JSONB、outbox、队列和归档。默认导出 720p、30 fps，单集最多 10 分钟、成片不超过 100 MB。具体安装、操作、复用范围与验收见 [剪辑与成片说明](docs/timeline-export.md)。

模型未启用时，服务端也会保存任务并由 worker 将生成节点停为“待接入 API”，不会伪造成功或展示测试媒体。试运行输出仅是 `planned: true` 的计划引用，不是图片、视频或音频。

异常处理：

- 同一账号相同 Idempotency-Key 和内容返回同一个任务；相同键不同内容返回 409。不同账号键互不影响，供应商操作键以任务 UUID 隔离。
- 在可能向供应商提交前先保存检查点；若受理结果不明，进入“提交待核对”，禁止直接重试。核对复用原请求 ID；没有 ID 时保留未知状态，等待真实适配器的人工核对流程。
- 取消区分“申请”与“供应商确认”；取消竞争中已经完成的媒体仍归档。无供应商提交的任务可直接取消。
- 模型输出已生成但保存失败进入“归档失败”，重试只读取原输出，不重复提交生成。CPU 成片任务归档失败后，会从冻结剪辑版本重新编码再归档，界面会明确提示。逐文件与逐节点检查点用于恢复。
- 供应商事件入口是**内部可信接口** `recordProviderEvent`，支持去重和终态保护；当前没有暴露未验签的公网 webhook。真实接入必须先完成该厂商的验签和规范化。
- 删除素材前检查声音、任务和所有已保存工作流版本；任务记录删除后仍保留已归档输出。未提交的前端草稿不提供引用保护。

本轮没有实现任意 ComfyUI/Python 节点执行、GPU 队列、模型微调、计费充值、多人协作和社区市场。任务中心、生成历史和素材库可持续翻页，不再受总共 500 条记录的限制；现有参考选择器预加载最近 500 个素材，已选择的旧引用会按 ID 补读。文件头校验不等于完整解码检测，上传限制为图片 20 MB、音频 30 MB、视频 100 MB。垃圾文件清理、异地备份、外部监测及公网防护属于上线前的后续工作。

## 分页、搜索与健康检查

`GET /api/jobs` 接受 `limit`、`cursor`、`q`、`kind`、`status`、`mode`、`workflowId`、`projectId`、`episodeId`；`mode=render` 查成片，`mode=media` 查模型提交和成片（排除试运行）。`GET /api/workspace/assets` 接受 `limit`、`cursor`、`q`、`kind`。返回 `{items,total,nextCursor}`，任务另带当前账号全工作区的 `summary`。单次默认 20 条、最多 500 条；任务/历史页面每页 20 条，素材页面每页 24 条。总记录数没有 500 条上限。

查询在 PostgreSQL 中按当前账号筛选，并按不可变的 `(created_at,id)` 倒序使用游标分页。微秒时间以 UTC 保留，状态更新不会改变排序；翻页期间新增的记录在刷新第一页后出现。游标绑定账号和筛选条件，错误游标、越界页大小返回 400。任务搜索覆盖名称、完整提示词和 ID；素材覆盖名称和 ID，`%`、`_` 按普通字符搜索。搜索/筛选改变或刷新列表会回到第一页。生成历史在服务端排除试运行。

增量迁移 `0004`/`0005` 增加任务创建时间、账号与时间复合索引和心跳表，回填历史快照，并统一为带时区时间戳。更新已有工作区时先执行 `pnpm db:migrate`，再启动新版 Web 和 worker。

配置页的“运行健康”每 15 秒刷新，也可手动重新检查：

- 数据库：执行真实查询，连接/探测超时有限；失败不回显连接串。
- 私有存储：写入专用随机探针对象、读取字节校验、最后移除；最多缓存 30 秒，同一进程合并并发探针。适用于本地目录和现有 S3 适配器，不创建业务素材。
- worker：每 5 秒写入心跳并检查 pg-boss 队列连接及 outbox 分发，超过 20 秒未更新显示“心跳过期”，正常退出显示“已停止”。重启可恢复健康；状态检查不会取消任务。
- 当前账号队列：排队、执行、归档、归档失败、提交待核对、等待后台接管和最老排队秒数。排队超过 60 秒、存在归档失败或待核对记录时显示“需要处理”。

`GET /api/health` 是公开的粗粒度组件状态，不返回队列数量、worker 标识、心跳详情或配置值。`GET /api/workspace/health` 需要会话（或显式启用的本机工作区），返回该账号队列详情。组件故障或 worker 异常时使用 HTTP 503，并保留结构化状态供面板显示。配置卡的“已填写”仍只代表环境变量存在。

部署为 Web + CPU worker + PostgreSQL + 私有目录，可增加一个独立 CPU 运维进程，不新增 Redis、GPU 或模型请求。运行 `pnpm ops` 可每 30 秒检测故障并记录恢复；配置后默认每天备份。手动 `ops:backup`、`ops:verify`、`ops:restore` 支持一致快照和素材哈希校验，恢复只写入新的数据库和空存储。详见 [运维手册](docs/operations.md)。大规模包含搜索、远程 S3、异地备份与整机故障留待目标环境验收。

## 项目结构与复用边界

```text
platform/
├── apps/web/                  Next.js 页面、Better Auth、统一 HTTP API
│   ├── features/              studio/tasks/assets/voices/workflows/settings/auth
│   ├── lib/workspace/         仅服务端工作区、session/Origin 校验
│   └── app/api/               jobs、workspace、config/catalog/auth
├── packages/contracts/        Zod 协议、模型目录、任务/节点类型
├── packages/core/             共用状态机、纯 DAG 执行、本地存储/服务端客户端
├── packages/server/           自研业务 service + pg-boss worker + 私有存储适配
├── packages/providers/        服务端配置状态；不含真实模型请求
├── packages/db/               Drizzle schema 和增量迁移
├── packages/studio-ui/        Open-Generative-AI 三个 Studio + 平台桥接
├── packages/workflow-ui/      React Flow + Vibe 的字段、音频、菜单组件
├── scripts/worker.mts         独立后台进程入口
├── scripts/ops.mts            独立监控、告警与备份恢复命令
├── tests/server/              PostgreSQL、HTTP 登录、恢复、归档、S3 SDK 闭环
└── third-party/               固定源码 SHA、逐文件哈希、licenses/notices
```

底座 UI 复用 nextjs/saas-starter；Studio 复用 Open-Generative-AI；画布用 React Flow 和 Vibe 组件。队列直接复用 **pg-boss 12.37.1**，文件适配复用 **AWS SDK 3.1150.0**，账号复用 Better Auth，schema/migration 复用 Drizzle。业务任务协议、outbox、所有权、快照、取消/核对、归档与 DAG 编排是平台自研胶水，没有复制 Vibe 的服务端执行引擎或 MuAPI proxy。

选择 pg-boss 是为了在没有模型/云队列密钥的情况下，仅增加 PostgreSQL 即可独立执行。Trigger.dev 保留未来托管调度边界和配置，**没有同时运行两套执行器**。开源来源及改造见 [third-party/notices.md](third-party/notices.md)，逐文件哈希见 [manifest.json](third-party/manifest.json)。不包含 RunningHub 私有源码或模型权重。

## 真实模型接入预留

当前统一目录保留 13 个 capability：Nano Banana 2/Pro、FLUX.2 图片；Seedance 2.0、MiniMax Hailuo 2.3、Kling O3 视频；IndexTTS 2 语音克隆。图片/视频预留 `FAL_KEY`；语音预留 `REPLICATE_API_TOKEN` 和固定 `REPLICATE_INDEXTTS_VERSION`。这是已有目录，不构成供应商账号可调用性或模型效果证明，版本和参数需在接入时重新核对。

`packages/server/src/types.ts` 的 `ProviderAdapter` 定义 `submit(request,key,inputs)`、`poll(requestId)`、`cancel(requestId)`、`openOutput(artifact)`。默认注入 `disabledProvider`。接入时增加服务端路由适配器，完成：输入私有签名 URL、供应商幂等与请求 ID、错误/终态规范化、验签回调、受限媒体下载，再返回规范化 `Artifact` 交给已有归档链路。不要将用户传入 URL 直接交给服务器下载，也不要把测试供应商放进产品 API。

仅填写密钥不会自动启用生成。未来模型接入需增加受控样本和成本/权限/供应商取消语义的真实验收。

## 验证

2026-10-15 剪辑增量最终验证：53/53 单元测试、46/46 服务端与 HTTP 测试通过（无跳过），lint、format、生产构建和 62 项固定来源校验通过；桌面与 390/320 CSS 像素浏览器完成上传/采用镜头 → 配音字幕 → 后台 MP4 → 下载/素材复用。细节见 [剪辑验收记录](docs/timeline-export.md)。下文较早测试数字是历史阶段记录。

```bash
pnpm lint              # 客户端/服务端边界 + Web/worker/test 类型
pnpm test              # 无数据库单元测试
pnpm verify:sources    # 62 个移植文件哈希
pnpm format:check
pnpm build
```

服务端闭环只允许数据库名以 `aivideo_test` 开头，避免测试媒体混入用户工作区。先创建独立数据库并应用迁移，执行 pnpm build，再在一个终端启动测试 Web（生产构建可避免开发热更新保留旧 service 实例）：

```bash
export TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/aivideo_test
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate
WORKSPACE_BACKEND=server DATABASE_URL="$TEST_DATABASE_URL" \
PRIVATE_STORAGE_ROOT=/absolute/path/to/test-files \
BETTER_AUTH_URL=http://127.0.0.1:3002 \
BETTER_AUTH_SECRET=test-only-secret-at-least-32-characters \
LOCAL_WORKSPACE_ENABLED=false pnpm start --port 3002
```

另一个终端也先设置 TEST_DATABASE_URL，再运行（TEST_HTTP_STORAGE_ROOT 必须与上述私有目录相同）：

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" \
TEST_HTTP_URL=http://127.0.0.1:3002 \
TEST_HTTP_STORAGE_ROOT=/absolute/path/to/test-files pnpm test:server
```

完整套件覆盖真实 HTTP 注册/session、权限/Origin、三种媒体任务与私有归档、生成结果复用、冻结工作流、幂等提交与回调、取消竞争/确认、归档重试、独立 worker SIGKILL 后恢复，以及实际 AWS SDK 对本机 S3 协议 fixture 的读写/签名。FixtureProvider 仅被测试导入；媒体是极小固定字节样本，验证传输和状态链路，不代表模型生成或视频播放质量。未提供 TEST_HTTP_URL 时 HTTP 套件会跳过，因此不能声称完整闭环通过。

2026-10-15 最终代码验证：45 项单元测试、28 项完整服务端测试通过；lint、build、format 和 62 个移植文件来源校验通过。新增测试覆盖超过 500 条记录、同时间戳微秒游标、状态变化与新插入、字面量搜索、跨账号/筛选游标拒绝、旧素材工作流、数据库/存储故障、探针清理、心跳启停与队列异常。

同日运维增量验证后：45 项单元测试、36 项完整服务端测试通过，覆盖真实数据库/素材备份恢复、监控崩溃重启、通知持久重试和备份故障恢复；页面展示及具体边界见 [运维验收记录](docs/superpowers/plans/2026-10-15-operations-recovery.md)。

本轮内置浏览器在独立测试库准备 521 条任务、522 个有效素材，验收桌面、390px 和 320px 的列表翻页与搜索、旧任务参数复用、旧图片工作流归档、旧录音语音复用，以及 worker 未启动 → 正常 → 停止 → 心跳过期 → 重启恢复。固定媒体 worker 只用于该隔离环境。真机 Safari、公网运行和真实模型效果未验收。

原 `pnpm test:e2e` 仍是浏览器本地模式的回归脚本。2026-10-14 已通过 Codex 内置浏览器对服务端模式进行点击验收：图片、视频和语音提交 → 任务中心/历史 → 私有归档预览 → 参数及素材复用；并检查了工作流版本快照、依赖传值和试运行。成功媒体来自隔离测试数据库中的固定样本，产品默认适配器仍关闭，不代表真实模型效果或公网生产验收。

素材库中的生成结果可以返回来源任务；同名素材选择项包含时间和短标识。历史工作流任务可通过“复用此工作流”打开当次冻结快照，原草稿保留在“恢复上一个草稿”入口，不会修改原任务。工作流首期仍只支持平台定义的六类 API 节点，不支持任意 ComfyUI 图或模型训练。剪辑合成通过项目内独立时间线提交，尚未增加工作流合成节点。

移除来源任务记录会保留已归档文件；素材卡片显示“来源记录已移除”，不再提供失效任务链接。该边界由真实 PostgreSQL 集成测试与隔离 UI 样本验证。

本轮检查及边界见 [docs/server-execution-plan.md](docs/server-execution-plan.md) 和 [分页与健康验收记录](docs/superpowers/plans/2026-10-15-pagination-health.md)。上线前仍需真实模型、远程 S3、真机浏览器和目标部署环境验收。
