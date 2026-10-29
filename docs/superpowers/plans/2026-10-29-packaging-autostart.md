# 安装包与登录自启动实现计划

> **面向 AI 代理的工作者：** 使用 executing-plans 在当前会话逐任务实现；仅在用户明确选择子代理执行时使用 subagent-driven-development。

**目标：** 提供 Linux、Windows、macOS 安装包和可开关的登录自启动。

**架构：** 沿用 Tauri 2，以官方 autostart 插件管理系统登录项。React 设置页独立读取并修改系统状态，不将自启动混入连接配置。GitHub Actions 在各自平台构建并发布版本标签对应的 Release。

**技术栈：** Tauri 2、React、TypeScript、Rust、pnpm、GitHub Actions。

**规格：** 本次对话中用户已批准的方案：Linux deb/rpm/AppImage、Windows NSIS、macOS DMG；自启动默认关闭；已配置时后台托盘订阅；未配置时显示设置；先交付未签名包，不实现系统服务。

## 全局约束

- 在 `.worktree/packaging-autostart` / `feat/packaging-autostart` 工作，不修改主检出。
- 不自动开启自启动；不引入独立的自启动布尔持久化文件。
- 保留托盘缺失时的窗口回退、已有凭据持久化与自动连接逻辑。
- 发布流程不需要签名秘密；明确 Windows/macOS 安全提示及本机验证限制。
- 架构由实现者选择：Linux/Windows x86_64，macOS arm64 和 x86_64；不扩展自动更新。

## 审查重点

1. 状态读取失败必须提示且禁用开关，不能伪装为关闭。
2. 开启或关闭失败不能乐观显示成功；操作中禁止重复提交。
3. 清除连接凭据不能悄悄改变登录项。
4. AppImage 的自启动应指向稳定的安装路径；记录移动文件的限制。
5. Release 标签必须匹配应用版本；失败不得发布看似完整的正式 Release。

## 文件结构

- `src/AutostartSetting.tsx`、`src/AutostartSetting.test.tsx`：独立设置控件及边界测试。
- `src/App.tsx`、`src/App.test.tsx`、`src/App.css`：设置页接入、回归测试与最小样式。
- `package.json`、`pnpm-lock.yaml`：官方插件前端依赖及打包脚本。
- `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/src/lib.rs`、`src-tauri/capabilities/default.json`：插件注册与最小权限，实际 capability 文件名以仓库为准。
- `src-tauri/tauri.conf.json`：安装包元数据及格式。
- `.github/workflows/release.yml`：各平台构建与 Release。
- `README.md`：安装、自启动、发行和验收说明。

## 任务 1：登录自启动设置

- [x] 检查官方插件文档和项目权限结构，确定 macOS LaunchAgent 及插件的 Linux AppImage 路径处理。
- [x] 控件集成测试放入现有 `src/App.test.tsx`，通过真实插件 JS 绑定和 IPC 替身验证状态、失败、回读、禁用与凭据独立性。
- [x] 运行 `pnpm test`，观察新增 9 个用例因缺少自启动设置而失败，再实现并验证通过。
- [x] 加入官方插件依赖、Rust 注册及最小权限，实现独立控件并挂到设置页，默认不调用 enable。
- [x] 运行 `pnpm test`、`pnpm build` 和 Rust 测试，确认通过。

## 任务 2：安装包与发布

- [x] 配置 bundle 元数据和打包脚本；各平台通过 CLI bundles 参数指定格式。
- [x] 编写 GitHub Actions：标签 `v*` 触发，版本一致性预检，最小权限，三平台四架构矩阵，执行测试并构建安装包；版本检查另有真实 CLI 回归测试。
- [x] 配置 workflow artifacts；仅全部构建成功且六个包齐全后创建或更新草稿 Release，不修改已发布 Release（尚未推送运行）。
- [x] actionlint 及 Tauri 配置验证通过；本机 Linux 编译并生成 deb、rpm、AppImage。
- [x] 更新 README：安装格式、产物路径、标签发布、未签名提示、自启动启停和 AppImage 稳定路径要求。

## 任务 3：最终验证与交付

- [x] 运行 pnpm test（27 项）、pnpm build、cargo test（19 项）、cargo fmt、cargo clippy -D warnings、cargo check --all-targets，均通过。
- [x] 检查 LSP 与 git diff --check，自审插件权限、错误状态和发布条件；未使用子代理。
- [x] 交付真实 Linux 安装包，明确 Windows/macOS 构建与桌面登录验收未执行。
- [x] 保留分支和工作区，不自动合并或推送。

## 验证记录与限制

- 真实 Linux release 编译成功；`pnpm tauri bundle --bundles deb,rpm,appimage` 成功复用已编译程序生成三个安装包。deb/rpm 约 4.34 MiB，AppImage 约 103.19 MiB，位于本工作区的 `src-tauri/target/release/bundle/`。
- 依赖安装使用 frozen lockfile；actionlint、版本检查和 git diff --check 通过。
- 自启动测试覆盖正确命令、失败回读和状态未知，不修改当前用户系统登录项；实际安装卸载、注销再登录和通知弹窗需要桌面验收。
- LSP 探测的 TypeScript 检查未能确认 clean；Rust analyzer 给出 bool 取反及宏展开等异常诊断，但实际 cargo check/tests/Clippy 全部编译通过。没有宣称 LSP 全绿。
- 没有运行远端 CI、推送分支或标签、创建 Release、配置代码签名或公证；Windows/macOS 仍需对应系统构建验收。
- 作者自审，不等同于独立审查。
