# 托盘常驻实现计划

> 用户已确认当前会话原生执行，不启动子代理。原始步骤见本文件初始提交 `81cd33b`。

**目标：** 正常运行只显示托盘，按需打开消息或配置窗口，图标显示未读和连接状态。
**架构：** Rust 管理启动、订阅、未读、托盘及窗口生命周期。React 只显示后端快照并提交用户操作，不在挂载时发起连接。SVG 在开发时转换成位图后内嵌。
**技术栈：** Tauri 2 tray-icon、现有 Rust / React / Vitest；沿用现有通知插件。
**规格：** `docs/superpowers/specs/2026-10-29-tray-resident-design.md`（对话批准内容与实现默认选择）。

## 文件与接口

- 新建 `src-tauri/src/state.rs`：迁移 `Snapshot`，增加 `view_mode`（`settings` / `messages`）、`unread_count`、`tray_error`；内部跟踪消息视图是否前台可见。提供消息接收、切换视图、前台状态更新方法及纯状态测试。
- 新建 `src-tauri/src/tray.rs`：`setup` 创建固定 ID 托盘和菜单；`refresh` 根据状态选择四态图标并更新菜单；窗口显示 / 隐藏入口集中处理错误。
- 修改 `src-tauri/src/lib.rs`：共用订阅启动函数，供启动恢复、表单连接和托盘重连使用；初始化托盘、恢复配置、注册关闭与焦点事件，新增 `show_view` 命令。快照仍用递增 revision，所有操作保持旧连接取消并等待退出的保证。
- 修改 `src-tauri/Cargo.toml`、`tauri.conf.json`：启用 tray-icon 和位图加载支持，窗口初始隐藏；不额外开放前端托盘控制权限。
- 新建 `assets/icon.svg`、`assets/tray-*.svg`，更新 `src-tauri/icons/`：铃铛图标 SVG 源及四态 PNG，更新应用图标。
- 修改 `src/App.tsx`、`src/App.css`、`src/App.test.tsx`：消息 / 配置独立视图、导航、托盘兜底提示；移除挂载自动连接。
- 修改 `README.md`：后台运行、退出、未读规则、图标再生成及平台验收说明。

## 全局约束与审查重点

- 消息仍最多 100 条，ID 去重最近 1000 个；未读计数与列表长度不绑定，仅在进程内保存。
- 重复消息不能增加未读或产生通知；网络重连不能重置未读。
- 配置页即使有焦点也不能把消息标为已读；消息页失焦 / 隐藏后收到新消息必须重新标记。
- 前端重挂载、切换页面不能重新连接或清空消息。
- 托盘不可用时不能隐藏唯一窗口；配置损坏必须显示配置页；重连错误不能自动弹窗。
- 保持凭据脱敏、明文存储提示及现有 Unix 权限约束。

## 执行账本

### 任务 1：状态模型与回归测试
- [x] 6 项状态测试先因 todo! 全部失败，再实现通过；已有配置、协议和取消测试保持通过（当时合计 17 项）。
- [x] `dae5fbe`：迁移 Snapshot，接入后台 / 前台 / 视图相关未读规则、列表限额及启动 / 关闭决策。

### 任务 2：托盘、启动与窗口生命周期
- [x] `0335f73`：Rust 启动恢复、菜单、关闭隐藏、焦点跟踪、托盘兜底、4 态图标和生成脚本。
- [x] Rust 测试、实际二进制构建和 Clippy 通过。SVG 源及桌面 PNG / ICO / ICNS 已生成并提交；4 个内嵌 PNG 通过尺寸及差异检查。

### 任务 3：按需窗口与前端测试
- [x] 8 项前端测试先观察到 6 项行为失败（旧挂载自动连接、始终显示配置、缺少导航 / 托盘提示），实现后 8 项全通过。
- [x] `3b18046`：配置 / 消息独立视图、后端导航、挂载不重连；仅保存配置时请求通知权限，静默启动只检查权限。
- [x] `pnpm build` 包含 TypeScript 检查，通过。

### 任务 4：验证与交付
- [x] 独立一轮作者自审（用户选择不使用子代理，不视为全新审查者审查）。检查后台状态、窗口入口、取消及失败兜底路径，补充 README。
- [x] 补充 Linux SNI 主机属性测试，先失败后通过；用 `G_DEBUG=fatal-criticals` 发现错误 Variant 结构可能触发 GLib abort，加外层类型验证后全套 19 项通过。
- [x] 最终 `pnpm test` 8 项、Rust 19 项、`pnpm build`、`cargo build`、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`git diff --check` 通过。
- [x] `pnpm exec tauri build --debug --no-bundle` 通过，验证内嵌前端资源的实际桌面二进制，不仅是 Vite / Rust 库编译。
- [x] 当前 DISPLAY / WAYLAND_DISPLAY 均为空：没有实测窗口闪现、托盘菜单、关闭隐藏、实际焦点事件、系统通知弹出，以及 Windows / macOS。README 列出桌面验收步骤，未声称这些已通过。
- [x] 在 `feat/tray-resident` 交付；不合并 main、不推送。

## 自审裁决及限制

- Ruling: Linux 在加载托盘前检查 AppIndicator 动态库和 `IsStatusNotifierHostRegistered`，不能只凭 watcher 名称存在就隐藏窗口。没有托盘支持时保留窗口并恢复任务栏入口；代价是非标准 SNI 实现也可能保守地回退为窗口。
- Ruling: SVG 只作源文件，原生层使用 Tauri CLI 生成的 PNG；生成脚本直接用 Node 启动 CLI，避免 Windows 的 .cmd shell 差异。
- Ruling: 焦点处理及消息接收读取当前窗口状态，而不是重放过期焦点事件；托盘 UI 队列只传递轻量展示状态，避免每次复制完整消息历史。
- Ruling: 托盘失败与隐藏窗口并发时，隐藏后再次检查可用性，必要时恢复窗口；图形行为仍待桌面验证。
- LSP 核对仍报告 Rust `!bool`、合法数组索引及 Tauri 宏展开类型错误；真实 rustc、Clippy、单元测试和 Tauri 桌面构建均通过，已按对应诊断标记 false-positive，未为绕过分析器而修改正确代码，也未更改机器分析器配置。
- 无延后的代码审查 Minor 项。跨平台图形验收是未完成的验证范围，不是已确认通过的结果。
