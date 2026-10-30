# GitHub 自动更新与无边框窗口实现计划

> **面向 AI 代理的工作者：** 使用 executing-plans 在当前会话逐任务实现；未经用户要求不调度子代理。

**目标：** 支持经用户确认的 GitHub 签名更新、无边框窗口及一屏设置页。

**架构：** 保留 Rust 订阅与托盘逻辑，使用 Tauri 官方 updater/process 插件处理更新和重启。React 根级管理更新状态；新增标题栏组件，设置改为两列，消息仅内部滚动。发行作业汇总签名产物并生成更新清单。

**技术栈：** Tauri 2、Rust、React 19、TypeScript、Vitest、GitHub Actions。

**规格：** `docs/superpowers/specs/2026-10-30-updater-window-design.md`

## 全局约束

- 在 `.worktree/github-updater-window` / `feat/github-updater-window` 工作。
- 只公开 Release 提供更新，不自动发布草稿，不自动创建新 tag。
- 不更改连接、通知、托盘、未读和自启动语义；不增加自动安装或自动重启。
- 不将签名私钥写入仓库、命令参数或日志，不在应用嵌入 GitHub token。
- deb/rpm 不执行应用内自覆盖升级。
- 默认 1040×760；最小尺寸通过布局实测确定，目标不超过 960×680。

## 审查重点

1. 无网络、无 Release、无当前架构或签名错误：显示可重试提示，不影响订阅。
2. React effect 重挂载、视图切换、重复点击：不重复下载或并发安装。
3. 关闭按钮和托盘失败：调用原生 close 路径，不能直接杀进程或留下不可见实例。
4. 长错误、长消息、100 条消息和系统缩放：动作可达，设置正常尺寸完整，列表内部滚动。
5. CI 缺资产、缺签名、版本不符：拒绝发布不完整更新清单，不修改已发布版本。

## 任务 1：更新检查与确认安装

**文件：** 修改 `package.json`、`pnpm-lock.yaml`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/src/lib.rs`、`src-tauri/tauri.conf.json`、`src-tauri/capabilities/default.json`、`src/App.tsx`；创建 `src/UpdateSetting.tsx`、`src/UpdateSetting.test.tsx`，必要时创建根级 `src/useUpdater.ts`。

- [x] 阅读官方 Tauri updater/process 文档，确认当前插件签名、权限、安装与重启 API；检测 Linux AppImage 身份必须依据后端运行环境，不仅依据浏览器 UA。
- [x] 在新 worktree 安装锁定依赖，运行 `pnpm test`、`pnpm build` 和 Cargo 测试建立基线；失败则先报告。
- [x] 先写失败测试：启动一次检查、无新版本、发现版本但未下载、点击确认才下载、进度、失败重试、重启失败、并发点击、视图切换不重复检查、组件卸载清理资源、deb/rpm 不进入安装路径。
- [x] 运行聚焦 Vitest 确认测试因缺少功能失败，再实现最小状态管理与更新组件。更新提示在消息视图也能看到，但不能自动打开隐藏窗口。
- [x] 注册 updater/process 插件；配置 HTTPS GitHub latest.json 和真实公钥，最小化权限。根据已核实 API，在正确阶段释放 Update 资源，重试不能复用已关闭资源。
- [x] 运行聚焦测试、全部前端测试、TypeScript 构建、Rust 测试；检查错误不泄露凭据。

## 任务 2：签名发行与 GitHub 更新清单

**文件：** 修改 `.github/workflows/release.yml`、`README.md`；创建 `scripts/create-update-manifest.mjs` 及其测试，沿用现有脚本测试组织方式。

- [x] 阅读官方 updater 各平台产物格式，确认 macOS app 压缩包和签名、Windows NSIS 签名、Linux AppImage 签名的实际名称。
- [x] 先写失败测试：正确生成四个平台条目、URL 编码、版本号、缺架构/缺签名/空签名拒绝、重复资产拒绝、稳定版与预发布处理。仅发布明确支持的版本格式。
- [x] 实现清单生成脚本，输出 `latest.json`，签名读取对应文件而非硬编码；下载地址固定本仓库与当前 tag。
- [x] CI 开启 updater 产物，macOS 同时保留 DMG 与 updater app 包。上传/下载 artifact 保留完整更新资产；汇总六个原有安装包及全部更新资产后才创建草稿和上传。
- [x] CI 从 Secrets 注入私钥和密码，缺失时清楚失败；不打印 Secret；保持已公开 Release 不可覆盖保护。
- [x] 与用户确认签名密钥生成、备份和 GitHub Secrets 设置方式。真实公钥未就绪前不得声称更新功能可发布；禁止用占位公钥交付。
- [x] 运行脚本测试、`actionlint`、版本检查；README 写明一次性密钥配置、草稿发布和 v0.1.0 手动升级限制。

## 任务 3：自定义标题栏

**文件：** 创建 `src/WindowTitlebar.tsx`、`src/WindowTitlebar.test.tsx`；修改 `src/App.tsx`、`src/App.css`、`src-tauri/tauri.conf.json`、`src-tauri/capabilities/default.json`、`src/App.test.tsx`。

- [x] 先写失败测试：最小化、最大化/还原、关闭各调用正确 Tauri API，窗口尺寸变化后状态更新、监听器清理、操作拒绝时错误可见。
- [x] 实现拖动区域和具中文 aria-label 的按钮；关闭调用 getCurrentWindow().close()，保留 Rust CloseRequested。按钮不可落入拖动区域。
- [x] 设置 decorations=false，按官方文档授予拖动和各窗口操作的最小权限；不要顺便开放全部窗口或进程权限。
- [x] 运行聚焦及全部测试。
- [ ] 原生检查拖动、双击标题栏、最小化/还原、关闭到托盘及无托盘关闭路径；当前仅有边界测试和原生构建，未进行真实桌面交互验收。

## 任务 4：一屏设置和内部消息滚动

**文件：** 修改 `src/App.tsx`、`src/App.css`、`src/AutostartSetting.tsx`、`src/SoundSetting.tsx`、相关前端测试与 `src-tauri/tauri.conf.json`。

- [x] 更新结构测试：连接字段、所有操作、启动/声音/更新区都可见；消息保留内部列表容器；长错误摘要有展开详情入口。
- [x] 改为视口高度应用壳、紧凑标题/导航/状态区，两列设置区，页脚固定在布局末端；min-height:0 让消息区可正确收缩。避免全局 overflow:hidden 裁剪设置按钮。
- [x] 用浏览器在 1040×760 和最终最小尺寸检查 document.scrollHeight <= innerHeight、表单和按钮全部位于视口内；100 条和长消息仅列表内部滚动。覆盖 HTTP 警告、权限/托盘错误及组件读取失败组合。
- [x] 检查 125%/150% 等效 CSS 视口和小工作区，验证局部滚动及控件可达；明确记录一屏保证的尺寸条件。
- [ ] 实际操作系统缩放及完整键盘导航验收；浏览器等效视口检查不能替代。
- [x] 运行 `pnpm test`、`pnpm build`、`cargo test --manifest-path src-tauri/Cargo.toml --locked`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings`；主动诊断变更文件。

## 交付验收

- [x] 自查全部 diff、权限、密钥引用和 README，未授权不提交或推送 tag。
- [x] 更新当前任务进度；测试失败或外部配置未完成时保持未完成状态。
- [ ] 在有签名 Secrets 的 GitHub Actions 验证四平台安装/更新产物；本次未推送开发分支或触发新发行。
- [ ] 使用两个正式版本执行 Windows/macOS/AppImage 真实升级验收；已明确列为待验收，不把单元测试当作端到端成功。

## 本地验证结果

- `pnpm test`：6 个文件、57 项测试通过；`pnpm build`、Cargo fmt/Clippy、24 项 Rust 测试、版本校验及 `actionlint` 均通过。
- Playwright：1040×760 / 960×680 下设置面板无滚动；HTTP 警告和折叠长错误不破坏一屏布局。100 条长消息的列表高度 352px、内容高度 51788px，页面不整体滚动；组合读取失败仍可局部滚动访问操作。
- Linux debug AppImage 和 `.sig` 实际生成；使用 `minisign-verify` 对应用配置中的真实公钥验证成功，修改包内容后验证被拒绝。此项不是两版本更新端到端验证。
- LSP 主动检查未返回诊断，但 4 个文件均标记 inconclusive，不能当作 LSP 确认无错；类型验证依据实际通过的 `tsc` / Vite 构建。
- 长期密钥已在用户授权后生成并配置 Actions Secret；私钥保存在仓库外，0700/0600 权限。离线备份仍需维护者执行，GitHub Secret 不可作为可恢复备份。
- 当前版本仍为 0.1.0；没有新 tag、没有新公开 Release，没有把变更合并到 main。
