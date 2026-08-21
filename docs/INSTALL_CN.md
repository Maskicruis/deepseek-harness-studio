# 安装与迁移指南

## 目标电脑要求

- Windows 10/11 64 位。
- 首次启动、模型调用和在线安装社区插件时需要联网。
- 无需预先安装 Node.js、pnpm 或 DeepSeek Harness；安装包已内置所需运行环境。

## 安装

1. 将 `DeepSeek-Harness-Studio-Setup-1.07.3-x64.exe` 复制到目标电脑。
2. 双击运行，在安装向导中选择安装目录；覆盖升级时可继续选择原目录。
3. 可选择任意有写入权限的目录。若选择 `Program Files` 等受保护目录，Windows 可能要求管理员授权。
4. 安装完成后程序会自动启动，并创建桌面与开始菜单快捷方式。
5. 首次启动会自动创建并选中 `%USERPROFILE%\Documents\DeepSeek Harness\Workspace`，可以直接新建会话。

## 首次配置

- 在 Harness 内部“设置”中配置模型供应商和 API Key。
- 在 Studio 右上角“偏好设置”中可修改默认工作区、本地端口和开机启动。
- 在聊天框中写出已有绝对路径（例如 `E:\Project\demo`），程序会自动识别并注册为任务路径。
- 在“插件”中可导入 npm、GitHub 或本地社区插件。请只安装你信任的来源。
- 在“插件 → 生态组件”中可一键接入 ModLens 等精选 DSH 组件；在“Skills”中可导入包含 `SKILL.md` 的本地技能目录。
- 在“偏好设置 → 软件更新”中可检查 GitHub Release；自动线路优先使用国内社区镜像，失败后回退 GitHub，下载通过 SHA-256 校验后可确认原地覆盖升级。

## 数据位置

- Harness 配置、会话和插件：`%USERPROFILE%\.dsh`
- Studio 偏好：`%APPDATA%\DeepSeek Harness Studio\studio-settings.json`
- 默认工作区：`%USERPROFILE%\Documents\DeepSeek Harness\Workspace`

若要把原电脑的个人配置迁移到新电脑，请先退出程序，再复制 `%USERPROFILE%\.dsh`。其中可能包含 API Key 等敏感信息，不要上传到公开仓库或发送给他人。

## 常见提示

- 当前安装包尚未进行 Authenticode 代码签名，Windows SmartScreen 可能显示未知发布者；公开分发前建议购买代码签名证书。
- 默认服务仅监听本机 `127.0.0.1:3080`。若端口被占用，请在 Studio 偏好中改为 1024–65535 范围内的其他端口。
- 本项目为非官方社区客户端；使用 DeepSeek 名称、商标和图标公开分发前，请确认相应品牌授权。
- 若当前使用 v1.0，请直接运行最新安装程序覆盖原安装目录。之后更新无需先卸载。
