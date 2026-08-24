# DeepSeek Harness Studio v1.07.9

> 版本：1.07.9 ｜ 发布时间：2026-08-24 ｜ [GitHub Release](https://github.com/Maskicruis/deepseek-harness-studio/releases/tag/v1.07.9)

本补丁将应用更新的默认安装包线路改为“仅国内镜像”。

- 新安装和未保存过线路设置的用户默认只连接国内镜像。
- 默认模式不会连接 GitHub 安装包下载线路。
- 需要时仍可在“偏好设置 → 软件更新”手动选择自动回退、仅 GitHub 官方或仅自定义镜像。
- 保留 v1.07.8 的单下载任务锁、临时文件句柄收尾、SHA-256 校验和安装前停止 Harness。
