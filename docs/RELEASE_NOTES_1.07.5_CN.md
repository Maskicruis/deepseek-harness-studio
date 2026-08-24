# DeepSeek Harness Studio v1.07.5

> 版本：1.07.5

## 跨设备插件安装修复

- 已扫描源码和发布包，确认不存在开发机盘符、用户名或工程目录硬编码。
- 使用“另一用户 + 多层空格 + 自定义安装目录 + 全新 `.dsh` profile”完成真实插件安装验证。
- Node、DSH CLI、pnpm shim 和 profile 均根据当前设备动态解析。
- 覆盖安装或迁移应用后，旧 pnpm shim 会被当前安装路径自动重写。
- npm 官方源发生 `ECONNRESET`、超时、DNS 或网络不可达错误时，自动切换国内 npm 镜像重试。
- 插件活动日志现在会显示实际 Node 和 profile 路径，便于远程排查。

## 兼容性

- 安装目录可以包含空格和非默认盘符；
- 插件与会话数据仍保存在当前用户 `%USERPROFILE%\.dsh`；
- v1.07.4 的插件启动自愈、持久隔离和模型切换修复全部保留。

## 验证

- 自定义安装目录下成功安装并启用 `dsh-plugin-doc-reader@0.1.2`；
- DSH/pnpm 已验证接受 `registry.npmmirror.com` 参数；
- 安装目录迁移与网络镜像回退自动化测试通过。
