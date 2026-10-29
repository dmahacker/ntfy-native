# ntfy-native

基于 Tauri 2、React、TypeScript 和 Vite 的轻量 ntfy 桌面客户端，非 ntfy 官方客户端。

## 已实现

- 配置一个 ntfy 服务器和主题，以用户名 / 密码（HTTP Basic Auth）订阅。
- 托盘常驻；已有配置时静默启动，由 Rust 后端自动恢复连接。未配置或配置损坏时打开配置窗口。
- 实时显示消息标题、正文、主题和时间，并通过系统通知提醒。
- 网络中断自动重连，使用最后接收的消息 ID 补收缓存消息，并对最近 1000 个 ID 去重。补收依赖服务器启用消息缓存；不保证离线期间的消息完整性。
- 401 / 403 等配置错误停止重连，修改配置后点击「保存并连接」重试。
- 「断开连接」保留配置，「清除配置」删除保存的凭据并断开。
- 托盘铃铛图标显示四种状态：蓝色正常、蓝色加红点表示未读、灰色加黄色警告表示离线，以及离线且未读。
- 打开消息列表清除未读；消息列表处于前台时收到的新消息直接视为已读。配置窗口不清除未读，系统通知始终照常发送。

消息列表仅保留当前连接最近 100 条，不落盘；手动重新连接会清空列表和未读计数，自动网络重连不会清空。**关闭窗口只隐藏到托盘，托盘菜单「退出」才会结束程序。** 未读数独立于列表长度，不跨进程保存。不含开机启动、多主题、附件或通知操作按钮。

## 环境要求

- Node.js 22.12+（或 20.19+）
- pnpm 12.15.0
- Rust stable（支持 edition 2024）
- 对应操作系统的 [Tauri 2 开发依赖](https://v2.tauri.app/start/prerequisites/)

Linux 需要 GTK 3、WebKitGTK 4.1 等开发库，以及正在运行的桌面通知服务和用户 D-Bus 会话；Windows 需要 Microsoft C++ Build Tools 和 WebView2，macOS 需要 Xcode Command Line Tools。

Linux 托盘还需要 `libayatana-appindicator3.so.1` 或 `libappindicator3.so.1`，以及支持 StatusNotifierItem 的桌面面板（Hyprland 常用的 Waybar / Quickshell 等；GNOME 可能需要 AppIndicator 扩展）。应用在隐藏前检查库及用户 D-Bus 上 `org.kde.StatusNotifierWatcher` 的 `IsStatusNotifierHostRegistered` 属性。缺少支持或托盘创建失败时会保留窗口，并明确提示关闭窗口会退出。

托盘菜单在各平台提供完整操作，不依赖 Linux 支持不一致的点击事件或悬浮提示。

## 本地开发

```bash
pnpm install
pnpm tauri dev
```

首次使用，填写服务器地址（例如 `https://ntfy.example.com`）、主题、用户名和密码，点击「保存并连接」。填写服务器根地址，不要加 `/主题/json`；支持反向代理路径前缀。该账号需要拥有主题的读取权限。地址重定向不会自动跟随，请填写最终地址。

保存配置并开始订阅后，窗口隐藏到托盘；从托盘菜单打开「查看消息」或「连接设置」。已配置时再次启动不弹窗口。配置和消息是独立视图，打开界面不会重新连接或清空消息。没有可用托盘时不会自动隐藏。

仅启动前端预览可运行 `pnpm dev`，但浏览器无法连接 Rust 后端。接收和系统通知必须在 Tauri 桌面应用中使用。

## 安全与配置

按当前第一版的设计，**密码以明文保存**，不是加密或 hash；HTTP Basic Auth 需要原始密码。不要共享配置文件或提交到版本库。能够读取本机当前用户文件的人也能取得密码。

配置文件为 Tauri 应用配置目录中的 `connection.json`：

- Linux：`${XDG_CONFIG_HOME:-~/.config}/com.ntfy.native/connection.json`
- macOS：`~/Library/Application Support/com.ntfy.native/connection.json`
- Windows：`%APPDATA%\com.ntfy.native\connection.json`

Unix 目录权限设为 `0700`，文件权限为 `0600`；Windows 依赖当前用户应用目录的默认 ACL。写入采用临时文件原子替换。密码不写入应用日志，也不写入浏览器 localStorage。

**推荐 HTTPS**。HTTP 会把可还原的用户名、密码及消息传到网络上；应用允许 HTTP 以便连接局域网服务，但会明确警告。不绕过 HTTPS 证书校验；自签名证书需先正确配置系统信任。

新消息的标题和正文会显示在系统通知中，可能被桌面或锁屏上的其他人看到。通知权限被拒绝时仍可在应用查看消息。操作系统的勿扰模式、通知服务或通知权限可能影响实际弹窗；插件成功提交不等于系统实际展示。

## 验证与构建

```bash
# 前端交互测试（Tauri 边界使用测试替身）
pnpm test

# TypeScript 检查与前端构建
pnpm build

# Rust 单元测试及本地真实 HTTP 协议测试，不访问外部 ntfy
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# 构建当前平台的桌面程序和安装包
pnpm tauri build
```

安装包默认输出到 `src-tauri/target/release/bundle/`。跨平台产物应在各自平台构建；签名与发行配置尚未设置。

### 桌面验收

1. 首次启动显示配置页；保存并连接后，窗口隐藏且托盘出现蓝色铃铛。退出后重新启动，只显示托盘，不闪现配置窗口。
2. 从手机或网页发送新消息，确认系统通知一次、铃铛出现红点，菜单显示未读数。打开「查看消息」后红点清除；关闭窗口后再次发消息仍会接收并出现红点。
3. 消息窗口前台收到新消息不增加未读；切到其他应用后收到消息应增加未读。单独打开「连接设置」不应清除已有未读，新消息仍增加未读。
4. 临时断开网络，确认灰色铃铛和黄色警告；恢复后自动连接，已有消息不重复提醒，未读数不丢失。离线且未读时同时保留黄色警告和红点。
5. 使用错误密码确认认证失败、不无限重试、不抢焦点；通过菜单打开设置修改密码后重试。清除配置后重启应显示配置页。
6. 菜单「断开」停止接收，菜单「连接」恢复；「退出」后进程退出，托盘消失。
7. 在无托盘支持的桌面启动，确认保留窗口和明确提示，保存配置不会隐藏，关闭窗口正常退出。检查本机配置文件权限，不要分享文件内容。

无图形显示环境的构建 / 单元测试不能替代系统通知和原生窗口的实际验收。

## 图标

SVG 源文件在 `assets/`：`icon.svg` 是应用图标，`tray-connected.svg`、`tray-unread.svg`、`tray-offline.svg`、`tray-offline-unread.svg` 是托盘四态。运行时内嵌 PNG，不依赖 SVG 渲染器；所有桌面 PNG / ICO / ICNS 已提交。

修改 SVG 后重新生成：

```bash
node scripts/generate-icons.mjs
```

脚本使用项目已安装的 Tauri CLI，在临时目录生成资源，只复制桌面图标到 `src-tauri/icons/`，不提交移动端资源。

## 目录

- `src/`：React 配置界面、消息列表和前端测试
- `src-tauri/src/config.rs`：配置验证及持久化
- `src-tauri/src/subscription.rs`：认证 HTTP 请求、JSON 流解析及去重
- `src-tauri/src/lib.rs`：Tauri 命令、连接管理、重连、通知
- `src-tauri/src/state.rs`：视图、前台状态、未读计数及启动决策
- `src-tauri/src/tray.rs`：托盘菜单、四态图标及 Linux 支持检查
- `src-tauri/capabilities/`：最小前端通知权限

应用标识暂定为 `com.ntfy.native`，正式发布前应改为自己拥有的唯一标识。
