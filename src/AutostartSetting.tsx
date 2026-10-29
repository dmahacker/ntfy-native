import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

export default function AutostartSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    isEnabled()
      .then(value => { if (active) setEnabled(value); })
      .catch(cause => { if (active) setError(`无法读取自启动状态：${String(cause)}`); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, []);

  async function update(next?: boolean) {
    setPending(true);
    setError("");
    let failure = "";
    if (next !== undefined) {
      try { await (next ? enable() : disable()); }
      catch (cause) { failure = `无法修改自启动设置：${String(cause)}`; }
    }
    // A failed write can still have side effects; always query the system again.
    try {
      const actual = await isEnabled();
      setEnabled(actual);
      setError(failure || (next !== undefined && actual !== next ? "系统未应用自启动设置，请重试或检查系统登录项。" : ""));
    } catch (cause) {
      setEnabled(null);
      setError(`${failure ? `${failure}；` : ""}无法读取自启动状态：${String(cause)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="autostart-setting" aria-labelledby="autostart-title" aria-busy={pending}>
      <h3 id="autostart-title">启动设置</h3>
      <label className="checkbox-label">
        <input type="checkbox" checked={enabled === true} disabled={pending || enabled === null} onChange={event => void update(event.target.checked)} aria-describedby="autostart-description" />
        登录后自动启动
      </label>
      <p id="autostart-description" className="muted">登录系统桌面后启动；已有连接配置时在托盘后台接收消息。</p>
      <p className="muted" role="status">{pending ? "正在读取或修改自启动设置…" : enabled === null ? "自启动状态未知" : enabled ? "自启动已开启" : "自启动已关闭"}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" disabled={pending} onClick={() => void update()}>重新读取</button>
    </section>
  );
}
