import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

type Phase = "checking" | "current" | "available" | "downloading" | "installed" | "error" | "unsupported";

export default function UpdateSetting() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const resource = useRef<Update | null>(null);
  const pending = useRef(false);
  const active = useRef(false);

  async function release() {
    const previous = resource.current;
    resource.current = null;
    await previous?.close().catch(() => {});
  }

  async function checkNow() {
    if (pending.current) return;
    pending.current = true;
    setPhase("checking"); setError("");
    try {
      await release();
      const supported = await invoke<boolean>("updater_supported");
      if (!active.current) return;
      if (!supported) { setPhase("unsupported"); return; }
      const next = await check({ timeout: 15000 });
      if (!active.current) { await next?.close().catch(() => {}); return; }
      resource.current = next;
      setVersion(next?.version ?? "");
      setPhase(next ? "available" : "current");
    } catch {
      if (active.current) { setPhase("error"); setError("检查更新失败，请检查网络，或稍后重试。尚未发布更新清单时也会出现此提示。"); }
    } finally { pending.current = false; }
  }

  async function restart() {
    try { await relaunch(); }
    catch { if (active.current) setError("重启失败，请点击重新启动，或通过托盘退出后重新打开应用。"); }
  }

  async function install() {
    const next = resource.current;
    if (pending.current || !next) return;
    pending.current = true;
    setPhase("downloading"); setError(""); setProgress("正在下载…");
    let total = 0; let downloaded = 0;
    try {
      await next.downloadAndInstall(event => {
        if (!active.current) return;
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress(total > 0 ? `正在下载 ${Math.min(100, Math.round(downloaded / total * 100))}%` : `已下载 ${(downloaded / 1048576).toFixed(1)} MB`);
        }
        if (event.event === "Finished") setProgress("正在校验签名并安装…");
      }, { timeout: 120000 });
      await release();
      if (active.current) { setPhase("installed"); await restart(); }
    } catch {
      await release();
      if (active.current) { setPhase("error"); setError("更新失败，未能完成下载、签名校验或安装。请重新检查更新后重试。"); }
    } finally { pending.current = false; }
  }

  useEffect(() => {
    active.current = true;
    // Deferring the initial check avoids duplicate requests in StrictMode's effect replay.
    const timer = setTimeout(() => void checkNow(), 0);
    return () => {
      active.current = false;
      clearTimeout(timer);
      // An in-flight installation owns its resource until it settles.
      if (!pending.current) void release();
    };
  }, []);

  return <section className="update-setting" aria-labelledby="update-title">
    <div className="setting-heading"><h3 id="update-title">软件更新</h3><span className="muted">v{__APP_VERSION__}</span></div>
    <p className="muted" role="status">{
      phase === "checking" ? "正在检查更新…" : phase === "current" ? "已是最新版本" : phase === "available" ? `发现新版本 ${version}` :
      phase === "downloading" ? progress : phase === "installed" ? "更新已安装，正在重新启动…" : phase === "unsupported" ? "此安装方式不支持应用内更新，请从 GitHub Release 下载新安装包升级。" : "暂时无法更新"
    }</p>
    {error && <p className="error" role="alert">{error}</p>}
    {phase === "unsupported" ? <button type="button" onClick={() => { void openUrl("https://github.com/dmahacker/ntfy-native/releases").catch(() => setError("无法打开浏览器，请手动访问 github.com/dmahacker/ntfy-native/releases。")); }}>前往 GitHub Releases</button> :
      phase === "installed" ? <button type="button" onClick={() => void restart()}>重新启动</button> :
      phase === "available" || phase === "downloading" ? <button type="button" disabled={phase === "downloading"} onClick={() => void install()}>下载更新并重启</button> :
      <button type="button" disabled={phase === "checking"} onClick={() => void checkNow()}>检查更新</button>}
  </section>;
}
