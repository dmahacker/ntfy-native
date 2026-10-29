import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function SoundSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    invoke<boolean>("get_sound_enabled")
      .then(value => { if (active) setEnabled(value); })
      .catch(cause => { if (active) setError(String(cause)); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, []);
  async function update(next?: boolean) {
    setPending(true); setError("");
    try {
      if (next === undefined) setEnabled(await invoke<boolean>("get_sound_enabled"));
      else { await invoke("set_sound_enabled", { enabled: next }); setEnabled(next); }
    } catch (cause) { setError(String(cause)); }
    finally { setPending(false); }
  }
  return <section className="autostart-setting" aria-busy={pending}>
    <h3>声音设置</h3>
    <label className="checkbox-label"><input type="checkbox" checked={enabled === true} disabled={pending || enabled === null} onChange={event => void update(event.target.checked)} />新消息提示音</label>
    <p className="muted">每条新消息使用系统通知音；受系统静音、勿扰模式及桌面通知服务支持情况影响。</p>
    {error && <><p className="error" role="alert">{error}</p><button type="button" disabled={pending} onClick={() => void update()}>重新读取声音设置</button></>}
  </section>;
}
