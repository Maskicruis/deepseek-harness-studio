# DeepSeek Harness Studio v1.09.1

> 版本：1.09.1 ｜ 发布时间：2026-09-16 ｜ [GitHub Release](https://github.com/Maskicruis/deepseek-harness-studio/releases/tag/v1.09.1)

## 修复内容

本版系统修复以下启动错误：

```text
Failed to load plugins
client-modules: @deepseek-ai/dsh-client-modules/client.js did not export the bootstrap module face
```

该错误不是普通社区插件缺少导出，而是 Harness 宿主 bootstrap 与浏览器实际取得的 `client.js` 属于不同 DSH 接口代际。常见触发条件是覆盖更新后 Electron 持久缓存仍保存旧资源，或 Studio 连接到同一端口上另一个版本的 Harness。

## 四层保护

- Harness Web 改用非持久专用 session，关闭应用后不再残留可跨版本复用的插件脚本缓存。
- 每次启动、重启和手动刷新都会生成新的页面修订参数；同时清理 HTTP cache、Service Worker 和 Cache Storage。
- 启动进程前检查 `dsh`、`dsh-base`、`dsh-web-app`、`dsh-client-modules`、`dsh-client-web`、`dsh-web-frontend` 的版本一致性，并验证 client module 导出面。
- 对端口中已有的 Harness 先做兼容性握手：支持 `host.describe` 的版本核对版本；rc.7 则检查实际返回的 boot 清单、Web shell 和 `client.js` 是否使用同一接口。

发现混合安装或不兼容外部进程时，Studio 会停止加载并显示明确原因，不会再把损坏页面误报成某个社区插件故障。

## 升级说明

在“偏好设置 → 软件更新”检查 v1.09.1，下载后运行安装向导覆盖原目录即可，无需卸载。首次运行会清理旧版 Harness Web 缓存；`%USERPROFILE%\.dsh` 内的会话、社区插件、Skills、API Key，以及已有工作区均会保留。

## 验证

- 51 项自动化测试全部通过。
- 前端生产构建通过。
- 使用隔离 DSH home 完成真实 `dsh web` 启动、bootstrap 契约校验、工作区注册和桌面控制包部署冒烟测试。
