import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowTitlebar() {
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    async function initialize() {
      try {
        const window = getCurrentWindow();
        const refresh = async () => {
          const value = await window.isMaximized();
          if (active) setMaximized(value);
        };
        const unlisten = await window.onResized(() => { void refresh().catch(() => {}); });
        if (!active) { unlisten(); return; }
        cleanup = unlisten;
        await refresh();
      } catch { if (active) setError("无法读取窗口状态。"); }
    }
    void initialize();
    return () => { active = false; cleanup?.(); };
  }, []);

  async function action(command: "minimize" | "toggleMaximize" | "close") {
    setError("");
    try { await getCurrentWindow()[command](); }
    catch { setError("窗口操作失败，请重试。"); }
  }

  return <>
    <header className="titlebar">
      <div className="titlebar-drag" data-tauri-drag-region><span data-tauri-drag-region>ntfy <b data-tauri-drag-region>native</b></span></div>
      <div className="window-controls">
        <button type="button" aria-label="最小化" title="最小化" onClick={() => void action("minimize")}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button>
        <button type="button" aria-label={maximized ? "还原窗口" : "最大化"} title={maximized ? "还原窗口" : "最大化"} onClick={() => void action("toggleMaximize")}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized ? <path d="M5 5V3h8v8h-2M3 5h8v8H3z" /> : <path d="M3 3h10v10H3z" />}</svg></button>
        <button type="button" className="window-close" aria-label="关闭窗口" title="关闭窗口" onClick={() => void action("close")}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
      </div>
    </header>
    {error && <p className="titlebar-error error" role="alert">{error}</p>}
  </>;
}
