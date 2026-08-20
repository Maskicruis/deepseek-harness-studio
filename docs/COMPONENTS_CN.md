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
3. 进入 Harness 模型选择器，选择名称中带 `modlens vision` 的模型。
4. 粘贴图片、上传截图或在消息中提供图片绝对路径，然后直接提出视觉问题。
5. 如果健康检查提示没有视觉引擎，请按 ModLens 文档配置 Gemini、OpenAI 兼容视觉接口或受支持的本地 CLI。

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
