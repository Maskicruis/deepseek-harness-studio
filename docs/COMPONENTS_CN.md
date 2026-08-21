# DSH 生态组件与 Skills

Studio v1.2.0 在“插件中心”新增“生态组件”和“Skills”两个页面。精选组件均为第三方社区软件，不会静默预装；只有用户点击“接入”后才会写入 DSH `web` profile，并在安装完成后重启 Harness。

## 精选组件

| 组件 | 固定版本 | 用途 | 使用提示 |
| --- | --- | --- | --- |
| `@liustack/modlens` | `3.22.0` | 为纯文本模型增加图片读取、OCR、布局与语义分析 | 安装后选择名称中带 `modlens vision` 的模型入口；首次使用需配置可用视觉引擎 |
| `@liustack/modsearch` | `5.6.0` | 网页搜索、页面抓取与 X 搜索 | 安装启用后由智能体按任务调用 |
| `@liustack/pptfast` | `0.20.0` | 生成可编辑 PPTX 演示文稿 | 适合汇报、方案和教学演示 |
| `@wntediluvian/dsh-backup` | `0.2.3` | 会话、记忆、插件、Skills 与配置的备份恢复 | 安装后在 Harness 设置中检查备份策略 |
| `@paicat1/dsh-screenshot` | `1.0.0` | 屏幕捕获与智能体截图工具 | 属于高敏感能力，建议按需启用，可配合 ModLens |

固定版本可以避免上游更新导致同一个安装入口在不同时间得到不同结果。需要升级时点击“更新 / 修复”，Studio 会重新执行 DSH 插件安装命令。

## ModLens 使用

1. 打开“插件 → 生态组件”，找到“ModLens 视觉引擎”并点击“一键接入”。
2. 安装成功后等待 Harness 自动重启。
3. 点击该组件的“配置视觉 API”，或进入“偏好设置 → 视觉能力”。
4. 选择视觉 Provider（默认就是「阿里千问 Qwen-VL」），填写相应配置并点击“保存并重启”。
5. 进入 Harness 模型选择器，选择名称中带 `(modlens vision)` 的文本模型。
6. 粘贴图片、上传截图或在消息中提供图片绝对路径，然后直接提出视觉问题。

> ⚠️ **填 API 的地方只有一处**：Studio「偏好设置 → 视觉能力」。如果你打开的是 ModLens 插件自带的「插件配置」页（标题为“视觉引擎 (ModLens)”、引擎默认“自动”、带 claude/codex 勾选），那是插件的原生界面，不需要在那里填 API——直接回到 Studio「偏好设置 → 视觉能力」，默认选中的「阿里千问 Qwen-VL」里粘贴 API Key，点“保存并重启”即可。

### 为什么需要另一套 API

ModLens 是视觉桥，不是视觉模型。主智能体仍可使用 DeepSeek 等擅长推理与编码的纯文本模型；当消息包含图片时，ModLens 把图片交给独立的多模态模型解析，再将结构化视觉证据交回主智能体。因此，Harness 的主模型 API 和 ModLens 的视觉 API 是两套互不替代的配置。

| Provider | 需要填写 | 适合场景 |
| --- | --- | --- |
| OpenAI 兼容 API | Base URL、API Key、视觉模型名 | Qwen-VL、GLM-V、OpenRouter、自建 vLLM/Ollama 等兼容端点 |
| Gemini API | API Key；地址和模型可选 | Google AI Studio 直连 |
| Anthropic API | API Key；地址和模型可选 | Claude 多模态接口 |
| Antigravity / Claude CLI | 先在本机安装并登录对应 CLI | 不单独填写 API Key，但速度和额度取决于 CLI |

OpenAI 兼容端点中的模型必须真正支持图片输入；纯文本 DeepSeek Chat API 不能充当视觉 Provider。Studio 不内置第三方密钥，也不会替用户猜测 Base URL，避免把密钥和图片发送到错误服务。

配置页会运行离线诊断，不消耗模型额度。API Key 只保存到当前 Windows 用户的 `%USERPROFILE%\.modlens\config.json`，读取状态时只返回“是否已设置”，不会把密钥明文送回界面。若使用非本机 HTTP 地址，密钥和图片可能被明文传输，建议使用 HTTPS。

截图中出现的 `vision engine failed` 表示附件已经到达 ModLens，但所选视觉 Provider 调用失败；这时无需全盘搜索图片文件，应先进入视觉设置检查当前首选引擎、缺失字段和登录状态，修复后重新粘贴图片。

ModLens 文档：https://github.com/liustack/modlens

## 本地 Skills

DSH 会扫描 `%USERPROFILE%\.dsh\skills`。Studio 的 Skill 导入器接受单层技能目录，目录根部必须包含 `SKILL.md`：

```text
my-skill/
  SKILL.md
  references/
  scripts/
  assets/
```

`SKILL.md` 至少需要以下 frontmatter：

```yaml
---
name: my-skill
description: Describe when and why the agent should use this skill.
---
```

名称必须使用小写 kebab-case。导入器拒绝符号链接，并将单个技能包限制为最多 500 个文件、25 MB，防止路径逃逸和异常大包。导入后通常无需重启；可在聊天框输入 `/my-skill` 显式调用，也可由模型根据描述自动匹配。

## 安全说明

- 社区插件可能获得工作区、网络、命令执行或屏幕捕获权限，请先查看来源与许可证。
- API Key 只应填写在相应组件的本地配置中，不要写入公开项目或截图。
- 卸载插件不会主动删除它独立创建的配置文件；移除本地 Skill 会删除 `%USERPROFILE%\.dsh\skills` 下对应的技能目录。
