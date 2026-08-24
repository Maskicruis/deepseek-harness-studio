# DeepSeek Harness Studio v1.07.6

> 版本：1.07.6

## 插件安装补丁

- 修复部分设备安装插件时只显示 `dsh: pnpm failed in profile directory`、因缺少底层网络错误代码而未切换国内镜像的问题。
- npm 官方源失败后，即使 DSH 只返回通用 pnpm 错误，也会自动使用 `https://registry.npmmirror.com` 再试一次。
- pnpm 子进程输出改用连续 UTF-8 解码，避免中文输出跨数据分块时出现 `����`。
- 官方源和国内镜像都失败时，会返回明确的双线路失败提示并保留可读诊断信息。

## 路径与兼容性

- 安装包仍不包含开发机盘符、用户名或工程目录硬编码。
- Node、DSH CLI、pnpm shim 与 `%USERPROFILE%\.dsh\profiles\web` 仍根据当前设备动态解析。
- 移动或覆盖安装后，pnpm shim 会自动重写为当前安装位置。

## 验证

- 使用现有 5 个社区组件的 profile 副本完成隔离安装，全部识别为 ready。
- 通用 DSH pnpm 错误、国内镜像回退和乱码清理回归测试通过。
