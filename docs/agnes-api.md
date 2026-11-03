# Agnes API 接入

模型运行于 Agnes，Web、PostgreSQL、pg-boss worker 和私有素材存储沿用原架构，不部署模型或新增服务。

在 `apps/web/.env.local` 保留现有配置并添加：

```dotenv
WORKSPACE_BACKEND=server
AGNES_API_KEY=填写自己的密钥
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
```

修改后重启 Web 和 `pnpm worker`。API 地址只接受上述官方地址，避免错误配置导致密钥发送给其他站点。配置页只返回配置状态，不返回密钥。配置就绪不代表供应商有容量或账号有额度。

## 当前能力

| 平台能力 | 模型 | 参数范围 |
| --- | --- | --- |
| 文生图 / 单图编辑 | agnes-image-2.5-flash | 固定 1K；1:1、16:9、9:16 |
| 文生视频 / 单张首帧图生视频 | agnes-video-2.5-flash | 固定 720P；4、5、6、8、10、12 秒；16:9、9:16、1:1 |

其他模型保持待接入状态，包括语音克隆。未接入收费版 Agnes Video、Pro 文本模型、多图参考、尾帧和音频参考。Flash 在官方价格页当前标为免费活动，实际费用与活动变化以供应商控制台为准。

## 参考素材与归档

- 图片编辑由 worker 从私有存储读取参考图，通过 `extra_body.image` 发送 Data URI，客户端不持有密钥。
- 图生视频要求公网可读的图。已配置 S3 时使用短期签名地址；本机存储下，复用本账号 Agnes 生成结果的原始图片地址。
- 本机上传图片不能直接作为视频首帧 URL。可以先提交图片编辑，再复用成功生成的结果；不会把本机素材目录公开到互联网。
- 原始供应商 URL 留在服务端操作记录，生成结果下载并归档后，浏览器只读取本平台的鉴权媒体路由。供应商地址过期后，可重试归档或改用持久 S3。
- 下载媒体不带模型密钥、不跟随重定向，并限制媒体格式、大小和地址范围。

## 执行与故障语义

图片 API 同步返回 URL，因此提交等待上限为 240 秒，外层执行上限为 255 秒；返回结果先写入数据库，再开始下载归档。下载失败可以单独重试归档，不再调用模型。

视频仅使用 `video_id` 查询，并始终携带 `model_name=agnes-video-2.5-flash`。使用外层 `status` 和 `url` 判断完成，不使用可能停留在 pending 的内部状态。每 2 秒查询，单次执行最多查询 5 分钟；超时保留任务 ID，用户可核对既有任务。

鉴权、权限、额度、参数错误、限流和明确的供应商队列满拒绝会显示具体失败原因。普通 5xx、连接中断、缺少 `video_id` 等受理不明的情况标记为“提交待核对”，禁止自动重新生成。没有请求 ID 的不确定提交需要到供应商控制台核对。

Agnes 当前文档未提供此接入使用的取消接口；提交后取消是本地申请，仍可能获得结果，会保留成功生成的媒体。

## 官方参考

- [图片 2.5 Flash](https://agnes-ai.com/en/docs/agnes-image-25-flash)
- [视频 2.5 Flash](https://agnes-ai.com/en/docs/agnes-video-25-flash)
- [价格](https://agnes-ai.com/en/docs/pricing)
- [额度与频率限制](https://agnes-ai.com/en/docs/tokenplan)
