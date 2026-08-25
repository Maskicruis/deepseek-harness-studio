# DeepSeek Harness Studio v1.08.0

> 版本：1.08.0 ｜ 发布时间：2026-08-25 ｜ [GitHub Release](https://github.com/Maskicruis/deepseek-harness-studio/releases/tag/v1.08.0)

本版本接入 DeepSeek 新模型 `deepseek-v4-flash-vision-exp`，并移除模型目录只能是 Flash/Pro 的静态假设。

## 动态模型更新

- 打开 Harness 模型选择器时，DeepSeek 适配器通过认证后的官方 `GET /models` 获取当前可用模型。
- 成功目录缓存 5 分钟；缓存到期后再次打开选择器会自动检查。
- 官方接口返回的后续模型 ID 会自动进入选择器，不需要再次修改 Flash/Pro 常量。
- 接口失败、超时或尚未设置 Key 时使用最后成功目录或内置兜底，已有模型仍可使用。

## DeepSeek 原生视觉

- `deepseek-v4-flash-vision-exp` 显示为支持文字和图片输入。
- Harness 图片附件通过持久附件服务读取，并按 DeepSeek 官方 OpenAI 兼容 Base64 `image_url` 格式发送。
- 支持 PNG、JPEG、GIF 和 WebP；无需安装 ModLens，也无需配置另一家视觉 API。
- ModLens 继续保留，适合把 Qwen-VL、Gemini、Claude 或其他视觉端点桥接给纯文本模型。
- 切回纯文本模型时，历史图片仍会转换为明确占位，避免向不支持视觉的 API 误发图片。

## 验证

- 使用真实 DeepSeek `/models` 接口验证当前返回 Flash、Pro 和 Flash Vision Exp。
- 41 项自动测试通过，覆盖未来未知模型、目录缓存、视觉能力标记、Base64 图片请求和文本模型兼容。
