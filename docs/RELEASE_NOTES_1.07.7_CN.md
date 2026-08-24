# DeepSeek Harness Studio v1.07.7

> 版本：1.07.7

## 无需预装 pnpm

- 修复 Windows 同时出现 `Path` 与 `PATH` 环境变量时，DSH 可能忽略 Studio 内置 pnpm 目录的问题。
- 插件子进程会移除重复路径键，写入唯一规范的 Windows `Path`，并把内置 Node、pnpm shim 与包目录放在最前面。
- DSH 官方源与国内镜像两次转发都失败时，Studio 会绕过 DSH 封装，直接调用安装包内置 Node + pnpm。
- 直连安装成功后会执行与 DSH 相同的 bundle 对账，把可用插件安全写回 `dsh.profile.bundles`。
- 已在仅保留 `C:\Windows\System32`、完全没有全局 pnpm 的隔离 PATH 中安装现有 5 个社区组件，全部为 ready。

## 全新应用图标

- 采用连续的 DeepSeek 蓝色渐变作为背景，并以官方鲸鱼标志作为视觉主体。
- 大尺寸版本加入完整 `HARNESS STUDIO` 标识，明确区分 Harness Studio 与普通 DeepSeek 客户端。
- 16–64 px 版本采用专门的鲸鱼 + `HS` 紧凑构图，适配 Windows 任务栏、开始菜单与资源管理器。
- 删除容易被误认为显示异常的弧形高光、水平分隔线和硬边色带。
- 应用窗口、可执行文件、安装向导、卸载程序、桌面快捷方式与开始菜单快捷方式使用同一套图标。

## 工程化

- 新增 `npm run icon:build`，可从 DeepSeek SVG 标志重复生成 512 px PNG 与七尺寸 Windows ICO。
- 图标生成已接入 `pack`、`dist:setup` 和 `dist` 构建流程。
- 新增 PNG 尺寸与 ICO 帧完整性自动化测试。

## 延续修复

- 保留 v1.07.6 的通用 pnpm 错误国内镜像回退和中文输出乱码修复。
- 安装路径、Node、DSH CLI、pnpm shim 与用户 profile 仍按当前设备动态解析。
