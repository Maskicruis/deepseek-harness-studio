# DeepSeek Harness Studio v1.4.0

本版本补齐 ModLens 从“安装成功”到“能够识图”的配置闭环。

## 新增

- 在“偏好设置 → 视觉能力”中直接配置 ModLens Provider。
- 支持 OpenAI 兼容多模态接口、Gemini API、Anthropic API，以及 Antigravity / Claude 本地 CLI。
- OpenAI 兼容接口可接入 Qwen-VL、GLM-V、自建 vLLM/Ollama 等支持图片输入的模型。
- 提供离线健康检查，区分已就绪、备用引擎、未配置、未安装和异常状态。
- ModLens 组件卡新增“配置视觉 API”快捷入口。
- 保存视觉配置后自动重启 Harness，并给出 `(modlens vision)` 模型与粘图使用提示。

## 安全与可靠性

- API Key 不写入 Studio 设置、工作区或 Git 仓库，只由 ModLens 保存到当前用户的 `~/.modlens/config.json`。
- 状态读取只返回密钥是否存在，不把已保存的密钥明文回传到界面。
- API Key 不进入命令行参数或应用日志。
- Base URL 仅接受 HTTP(S)，拒绝把用户名或密码嵌入 URL；非本机 HTTP 地址会显示明文传输警告。
- 诊断不会请求视觉模型，不消耗 API 额度。

## 问题说明

旧版只提供 ModLens 安装入口，容易让人误以为“已接入”就能识图。实际上 ModLens 是视觉桥，仍需一个可用的多模态 Provider。会话中的 `vision engine failed` 表示图片已进入 ModLens，但视觉 Provider 调用失败；升级后可直接在 Studio 内检查并修复配置。
