# ntfy-native

基于 Tauri 2、React、TypeScript 和 Vite 的 ntfy 桌面客户端项目。

当前仅初始化官方基础模板，保留欢迎页和 `greet` Rust 命令用于验证前后端通信。尚未实现主题订阅、消息列表或系统通知；本项目不是 ntfy 官方客户端。

## 环境要求

- Node.js 22.12+（或 20.19+）
- pnpm 12.15.0
- Rust stable（支持 edition 2024）
- 对应操作系统的 [Tauri 2 开发依赖](https://v2.tauri.app/start/prerequisites/)

Linux 需要 GTK 3、WebKitGTK 4.1 等开发库；Windows 需要 Microsoft C++ Build Tools 和 WebView2，macOS 需要 Xcode Command Line Tools。

## 本地开发

```bash
pnpm install
pnpm tauri dev
```

仅启动前端预览可运行 `pnpm dev`，但浏览器中无法调用 Tauri 的 Rust 命令。

## 验证与构建

```bash
# TypeScript 检查与前端构建
pnpm build

# Rust 检查
cargo check --manifest-path src-tauri/Cargo.toml

# 构建当前平台的桌面程序和安装包
pnpm tauri build
```

安装包默认输出到 `src-tauri/target/release/bundle/`。跨平台产物应在各自平台构建；签名与发行配置尚未设置。

## 目录

- `src/`：React 前端
- `public/`：静态资源
- `src-tauri/src/`：Rust 应用入口与命令
- `src-tauri/tauri.conf.json`：窗口、构建和应用配置
- `src-tauri/capabilities/`：Tauri 权限配置

应用标识暂定为 `com.ntfy.native`，正式发布前应改为自己拥有的唯一标识。图标仍为 Tauri 模板默认图标。
