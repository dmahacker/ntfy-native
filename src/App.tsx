import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import AutostartSetting from "./AutostartSetting";
import SoundSetting from "./SoundSetting";
import UpdateSetting from "./UpdateSetting";
import WindowTitlebar from "./WindowTitlebar";
import "./App.css";

interface Config { server: string; topic: string; username: string; password: string }
interface Message { id: string; time: number; topic: string; title: string; message: string }
type ViewMode = "settings" | "messages";
interface Snapshot {
  revision: number; status: string; detail: string;
  notification_error: string | null; messages: Message[];
  view_mode: ViewMode; unread_count: number; tray_available: boolean; tray_error: string | null;
}
const emptyConfig: Config = { server: "", topic: "", username: "", password: "" };
const initialSnapshot: Snapshot = { revision: -1, status: "disconnected", detail: "尚未连接", notification_error: null, messages: [], view_mode: "settings", unread_count: 0, tray_available: false, tray_error: null };
const statusLabels: Record<string, string> = { disconnected: "未连接", connecting: "连接中", connected: "已连接", reconnecting: "重连中", error: "连接失败" };

async function notificationPermission(request = true): Promise<string> {
  try {
    if (await isPermissionGranted() || (request && await requestPermission() === "granted")) return "";
    return "通知权限未获准，仍会接收消息；请在系统设置中允许通知。";
  } catch {
    return "无法检查通知权限，请确认系统通知服务可用。";
  }
}

function App() {
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [permissionWarning, setPermissionWarning] = useState("");

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const apply = (next: Snapshot) => {
      if (active) setSnapshot(previous => next.revision >= previous.revision ? next : previous);
    };
    async function initialize() {
      try {
        const cleanup = await listen<Snapshot>("subscription-state", event => apply(event.payload));
        if (!active) { cleanup(); return; }
        unlisten = cleanup;
        apply(await invoke<Snapshot>("get_snapshot"));
        const saved = await invoke<Config | null>("load_settings");
        if (!active) return;
        if (saved) {
          setConfig(saved);
          const warning = await notificationPermission(false);
          if (!active) return;
          setPermissionWarning(warning);
          // Rust owns the subscription; mounting this view must never reconnect.
        }
      } catch (cause) {
        if (active) setError(String(cause));
      } finally {
        if (active) setBusy(false);
      }
    }
    void initialize();
    return () => { active = false; unlisten?.(); };
  }, []);

  async function action(command: "connect" | "disconnect" | "clear_settings") {
    setBusy(true); setError("");
    try {
      if (command === "connect") {
        setPermissionWarning(await notificationPermission());
        await invoke(command, { config: { ...config, server: config.server.trim(), topic: config.topic.trim() } });
      } else {
        await invoke(command);
        if (command === "clear_settings") { setConfig(emptyConfig); setPermissionWarning(""); }
      }
    } catch (cause) {
      setError(String(cause));
    } finally { setBusy(false); }
  }

  function field(name: keyof Config, value: string) { setConfig(previous => ({ ...previous, [name]: value })); }

  async function showView(mode: ViewMode) {
    setBusy(true); setError("");
    try { await invoke("show_view", { mode }); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  return (
    <main className={`app-shell view-${snapshot.view_mode}`}>
      <WindowTitlebar />
      <div className="app-content">
      <header className="app-header">
        <div><span className="eyebrow">YOUR NOTIFICATIONS, ON YOUR DESKTOP</span><h1>{snapshot.view_mode === "settings" ? "连接与偏好" : "消息中心"}</h1></div>
        <span className={`status-badge ${snapshot.status}`}><span aria-hidden="true">●</span> {statusLabels[snapshot.status] ?? "未连接"}</span>
      </header>
      <nav className="view-navigation" aria-label="窗口视图">
        <button type="button" disabled={busy} aria-current={snapshot.view_mode === "messages" ? "page" : undefined} onClick={() => void showView("messages")}>查看消息</button>
        <button type="button" disabled={busy} aria-current={snapshot.view_mode === "settings" ? "page" : undefined} onClick={() => void showView("settings")}>连接设置</button>
      </nav>
      <div className="window-feedback">
        <p className="connection-detail" role="status">{busy ? "正在处理…" : snapshot.detail || "尚未连接"}</p>
        {[error, permissionWarning, snapshot.notification_error, snapshot.tray_error].filter(Boolean).length > 0 && <details className="feedback-details">
          <summary>需要留意：{[error, permissionWarning, snapshot.notification_error, snapshot.tray_error].filter(Boolean).length} 项提示（展开查看）</summary>
          {error && <p className="error" role="alert">{error}</p>}
          {permissionWarning && <p className="warning" role="alert">{permissionWarning}</p>}
          {snapshot.notification_error && <p className="warning" role="alert">{snapshot.notification_error}</p>}
          {snapshot.tray_error && <p className="warning" role="alert">{snapshot.tray_error}</p>}
        </details>}
      </div>
      <div className="workspace">
        {snapshot.view_mode === "settings" && <section className="panel settings" aria-labelledby="settings-title">
          <h2 id="settings-title">连接设置</h2>
          <p className="muted">保存后在托盘中接收消息，需要时再打开这里。</p>
          <form onSubmit={event => { event.preventDefault(); void action("connect"); }}>
            <fieldset disabled={busy}>
              <div className="form-field"><label htmlFor="server">服务器地址</label>
              <input id="server" type="url" required placeholder="https://ntfy.example.com" value={config.server} onChange={event => field("server", event.target.value)} autoCapitalize="none" spellCheck={false} /></div>
              <div className="form-field"><label htmlFor="topic">订阅主题</label>
              <input id="topic" required maxLength={64} pattern="[A-Za-z0-9_-]+" placeholder="my-alerts" value={config.topic} onChange={event => field("topic", event.target.value)} autoCapitalize="none" spellCheck={false} /></div>
              <div className="form-field"><label htmlFor="username">用户名</label>
              <input id="username" required autoComplete="username" value={config.username} onChange={event => field("username", event.target.value)} autoCapitalize="none" spellCheck={false} /></div>
              <div className="form-field"><label htmlFor="password">密码</label>
              <input id="password" type="password" required autoComplete="current-password" value={config.password} onChange={event => field("password", event.target.value)} /></div>
              <p className="security-note">配置会自动保留，密码以明文存储在本机应用配置目录。请勿共享配置文件。</p>
              {config.server.trim().toLowerCase().startsWith("http:") && <p className="warning">HTTP 会以明文传输用户名、密码和消息，建议使用 HTTPS。</p>}
              <button className="primary" type="submit">保存并连接</button>
              <div className="secondary-actions">
                <button type="button" onClick={() => void action("disconnect")}>断开连接</button>
                <button type="button" className="danger" onClick={() => void action("clear_settings")}>清除配置</button>
              </div>
            </fieldset>
          </form>
        </section>}
        {snapshot.view_mode === "messages" && <section className="panel feed" aria-labelledby="feed-title">
          <div className="feed-header"><h2 id="feed-title">消息</h2><span className="count">{snapshot.messages.length} / 100</span></div>
          {snapshot.messages.length === 0 ? (
            <div className="empty-state"><div aria-hidden="true" className="empty-icon">✳</div><h3>等待下一条消息</h3><p>连接后，新消息会出现在这里，<br />并通过系统通知提醒你。</p></div>
          ) : (
            <ol className="messages" aria-label="收到的消息">{snapshot.messages.map(message => (
              <li key={message.id} className="message-card">
                <div className="message-meta"><span>{message.topic}</span><time dateTime={new Date(message.time * 1000).toISOString()}>{new Date(message.time * 1000).toLocaleString()}</time></div>
                <h3>{message.title || message.topic}</h3><p>{message.message}</p>
              </li>
            ))}</ol>
          )}
        </section>}
        <aside className="panel preferences" aria-label="应用偏好">
          <div hidden={snapshot.view_mode !== "settings"} className="connection-preferences"><AutostartSetting /><SoundSetting /></div>
          <UpdateSetting />
        </aside>
      </div>
      <footer>仅保留当前连接最近 100 条消息 · {snapshot.tray_available ? "关闭窗口后仍在托盘接收，通过托盘菜单退出" : "关闭窗口将退出程序"}</footer>
      </div>
    </main>
  );
}

export default App;
