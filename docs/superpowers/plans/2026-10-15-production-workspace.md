# 短剧项目与选片工作台 Implementation Plan

> Inline execution by the main agent; user has authorized implementation and acceptance. No Git mutation or external inference.

**Goal:** 上传素材后可以建立项目、分集、分镜、角色/场景设定版本，添加镜头候选并明确选择采用版，复用现有工作流与任务。

**Architecture:** PostgreSQL 保存带 revision 的项目聚合文档及资源引用索引；所有更新使用服务端命令、账号校验、行锁和乐观并发检查。设定版本和候选依据不可变；现有素材、声音、工作流、任务复用原接口，删除引用受保护。

**Tech Stack:** Next.js / React / Zod / PostgreSQL / Vitest，使用现有 CPU worker，不增加基础服务。

## Constraints

- 真实模型仍关闭，不引入 GPU/模型服务或新队列。
- 新制作工作台使用现有服务端模式；浏览器模式显示明确的启用提示，不静默迁移数据。
- 候选采用必须显式操作；修改镜头或设定不会覆盖已采用素材。
- 本期不做时间线、视频合成、真实多参考推理、计费和协作编辑。

## Tasks

- [x] `packages/contracts/src/production.ts` + `packages/core/src/production.ts`：定义项目、设定版本、分集、分镜与候选；纯命令 reducer，完整排序校验、采用版保护、快照与引用收集。用 `tests/production.test.ts` 验证修改后快照不变、错误引用和排序。
- [x] `packages/db/src/schema.ts` + 增量迁移；`packages/server/src/production.ts`：项目 list/create/get/change/delete，校验素材类型和账号，锁资源并重建引用索引，409 冲突；接入 service 删除保护。
- [x] `apps/web/app/api/production/**`：复用 owner/jsonInput/failure；项目读写和现有任务结果导入，工作流试运行通过现有队列。用服务端与 HTTP 测试验证权限、Origin、持久化、引用、冲突。
- [x] `apps/web/features/production/**` + `/projects` 页面和导航：项目列表、分集/剧本、设定库、分镜编辑、素材上传与选择、候选预览采用、镜头排序、任务/工作流关联。使用实际保存状态反馈并防重复操作。
- [x] 本机备份后迁移；在隔离测试库跑上传素材链路和既有回归。构建/类型/格式检查；用 CUA 验收桌面及移动端的创建、上传、选片、刷新恢复与试运行。
- [x] 更新 README、使用说明和本计划的验收证据。

## Acceptance

一项目两集，两角色一场景，多角度图片和声音绑定，两个镜头分别有图片/视频候选；选 A、换 B、刷新仍保留 B，后续上传 C 不改变采用版。修改设定不改旧镜头快照，错误账号和过期 revision 被拒绝；引用中的素材/声音/工作流/任务不能删除。采用图片生成并保存工作流，提交试运行、后台完成、回到项目可查看；真实模式仍 blocked。删除项目只解除关联，不删除私有素材。


## Verification results — 2026-10-15

- `pnpm test`: 50/50 passed.
- `pnpm test:server`: 41/41 passed with TEST_HTTP_URL enabled, PostgreSQL 17, private DiskStorage, and test-only provider. Latest full run: 16:45, duration 37.69 s.
- `pnpm build`, `pnpm lint`, `pnpm format:check`, `pnpm verify:sources`: passed (62 pinned upstream source records, 149 files checked for boundaries).
- Incremental migration 0006 applied to local and isolated test databases; pre-migration backup ID `4bf77e44-ef9d-4fc2-ac5a-6d3cc94e75cd`.
- CUA browser acceptance: project `2f61d98d-24d1-4417-8033-52581e81e76b`, uploaded PNG/MP4/WAV, role version preservation, explicit adoption and reload, linked dry-run task `d762db32-c2c6-4f6e-94f9-61ebef89fb07` completed by the existing independent worker.
- Desktop and measured 390/320 CSS px acceptance. At 320 px, history audio overflow was found, fixed and rechecked (`scrollWidth === innerWidth === 320`). No browser console errors observed.
- Screenshots: `/private/tmp/aivideo-production-desktop-20261015.png` and `/private/tmp/aivideo-production-mobile-20261015.png`.
- During acceptance, added upload-in-progress save guards, link/unlink recovery, pinned version media previews, accurate dry-run labels, and a 256,000-byte command body limit to accommodate 50,000-character Chinese scripts. A 40,000-character Chinese script is covered by HTTP tests.
- Model calls remain disabled. Fixture-generated task outputs only run in isolated tests; no production inference or final video rendering is claimed.
