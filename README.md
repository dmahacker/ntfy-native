# ntfy-native

基于 Tauri 2、React、TypeScript 和 Vite 的轻量 ntfy 桌面客户端，非 ntfy 官方客户端。

## 已实现

- 配置一个 ntfy 服务器和主题，以用户名 / 密码（HTTP Basic Auth）订阅。
- 持久化配置；下次启动自动恢复并连接。
- 实时显示消息标题、正文、主题和时间，并通过系统通知提醒。
- 网络中断自动重连，使用最后接收的消息 ID 补收缓存消息，并对最近 1000 个 ID 去重。补收依赖服务器启用消息缓存；不保证离线期间的消息完整性。
- 401 / 403 等配置错误停止重连，修改配置后点击「保存并连接」重试。
- 「断开连接」保留配置，「清除配置」删除保存的凭据并断开。

消息列表仅保留当前连接最近 100 条，不落盘；手动重新连接会清空列表。最小化窗口时继续接收，关闭窗口即退出，不含托盘、开机启动、多主题、附件或通知操作按钮。

## 环境要求

- Node.js 22.12+（或 20.19+）
- pnpm 12.15.0
- Rust stable（支持 edition 2024）
- 对应操作系统的 [Tauri 2 开发依赖](https://v2.tauri.app/start/prerequisites/)

Linux 需要 GTK 3、WebKitGTK 4.1 等开发库，以及正在运行的桌面通知服务和用户 D-Bus 会话；Windows 需要 Microsoft C++ Build Tools 和 WebView2，macOS 需要 Xcode Command Line Tools。

## 本地开发

```bash
pnpm install
pnpm tauri dev
```

首次使用，填写服务器地址（例如 `https://ntfy.example.com`）、主题、用户名和密码，点击「保存并连接」。填写服务器根地址，不要加 `/主题/json`；支持反向代理路径前缀。该账号需要拥有主题的读取权限。地址重定向不会自动跟随，请填写最终地址。

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

1. 在桌面终端启动 `pnpm tauri dev`，连接一个有主题读取权限的测试账号。
2. 从手机或 ntfy 网页向同一主题发送带标题的消息，确认消息列表和系统通知各收到一次。首次使用时允许通知。
3. 临时断开网络再恢复，确认状态更新、自动重连，已有消息不重复提醒。
4. 使用错误密码确认显示认证失败且不持续重试；恢复正确密码重新连接。
5. 关闭后重新打开，确认配置恢复并自动连接；检查本机配置文件权限，不要把文件内容发给别人。
6. 点击「断开连接」，发送消息确认不再接收；点击「清除配置」后重启，确认不再恢复账号。

无图形显示环境的构建 / 单元测试不能替代系统通知和原生窗口的实际验收。

## 目录

- `src/`：React 配置界面、消息列表和前端测试
- `src-tauri/src/config.rs`：配置验证及持久化
- `src-tauri/src/subscription.rs`：认证 HTTP 请求、JSON 流解析及去重
- `src-tauri/src/lib.rs`：Tauri 命令、连接管理、重连、通知
- `src-tauri/capabilities/`：最小前端通知权限

应用标识暂定为 `com.ntfy.native`，正式发布前应改为自己拥有的唯一标识。图标仍为 Tauri 模板默认图标。
