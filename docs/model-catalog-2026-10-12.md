# 主流模型 API 预留目录

核对日期：2026-10-12。以下依据供应商公开 API 文档登记，不代表已完成账号权限、区域可用性、计费或真实生成验收。当前执行器保持关闭，浏览器只向本地 `/api/jobs` 提交请求。

| 模型                        | 文本入口文档                                                                           | 参考图片入口文档                                                                        | 本期参数子集                      |
| --------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| Nano Banana 2               | [文生图](https://fal.ai/models/fal-ai/nano-banana-2/api)                               | [图片编辑](https://fal.ai/models/fal-ai/nano-banana-2/edit/api)                         | 单张参考图片；1:1 / 16:9 / 9:16   |
| Nano Banana Pro             | [文生图](https://fal.ai/models/fal-ai/nano-banana-pro/api)                             | [图片编辑](https://fal.ai/models/fal-ai/nano-banana-pro/edit/api)                       | 单张参考图片；1:1 / 16:9 / 9:16   |
| Seedance 2.0                | [文生视频](https://fal.ai/models/bytedance/seedance-2.0/text-to-video/api)             | [图生视频](https://fal.ai/models/bytedance/seedance-2.0/image-to-video/api)             | 5 / 10 / 15 秒；1:1 / 16:9 / 9:16 |
| MiniMax Hailuo 2.3 Standard | [文生视频](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/text-to-video/api) | [图生视频](https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/image-to-video/api) | 6 / 10 秒；路由未暴露比例参数     |

新增 8 个能力入口，连同原有 FLUX.2、Kling O3、IndexTTS 2 共 13 个入口。既有模型 key 保持稳定，已保存草稿和工作流可继续读取。

`packages/contracts/src/index.ts` 是模型 key、显示名、供应商路由和首期参数的统一来源。`packages/studio-ui/src/models.js` 从中生成复用工作台需要的元数据；设置页和工作流节点也读取同一目录。服务端根据所选模型校验参数，客户端不接收供应商 endpoint 或凭证。

图片与视频本期统一预留 fal 路由，只需要服务器变量 `FAL_KEY`。这些路径是 fal 的模型标识，不是字节、MiniMax、Google 官方直连接口。后续若增加厂商直连，需另写服务端适配器和配置，保持平台模型 key 稳定。

接通执行器时仍需完成各模型参数翻译。例如 Nano Banana 编辑接口使用 `image_urls` 数组，而平台统一保存 `assetIds`；Seedance/Hailuo 的视频时长需要转换为供应商字符串。素材必须先持久上传并解析为供应商可访问的地址。当前 `platform-client.js` 只负责工作台到本地统一协议的翻译，不是这些供应商的调用实现。

首尾帧、多图/视频/音频参考、分辨率和原生音频等高级能力未在本次表单中开放。当前不宣称目录覆盖最新全部版本；先为用户点名的模型系列登记明确版本，再通过受控调用验收扩展。
