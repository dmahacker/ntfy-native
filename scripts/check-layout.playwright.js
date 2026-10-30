// Run against `pnpm dev` with: playwright cli run-code --filename scripts/check-layout.playwright.js
// All Tauri IPC is replaced in this browser-only test; no desktop settings or subscriptions are changed.
async page => {
  await page.addInitScript(() => {
    const callbacks = new Map(); let id = 0; let stateHandler;
    const failSettings = new URLSearchParams(location.search).has("layout-errors");
    const snapshot = { revision: 0, status: "connected", detail: "已连接", notification_error: null, messages: [], view_mode: "settings", unread_count: 0, tray_available: true, tray_error: null };
    window.__layoutSnapshot = snapshot;
    window.__emitLayoutSnapshot = next => callbacks.get(stateHandler)?.({ event: "subscription-state", payload: next });
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: fn => { const next = ++id; callbacks.set(next, fn); return next; },
      unregisterCallback: key => callbacks.delete(key),
      invoke: async (command, args = {}) => {
        if (failSettings && ["plugin:autostart|is_enabled", "get_sound_enabled", "plugin:updater|check"].includes(command)) throw new Error("模拟读取失败".repeat(20));
        if (command === "plugin:event|listen") { if (args.event === "subscription-state") stateHandler = args.handler; return ++id; }
        if (command === "get_snapshot") return snapshot;
        if (command === "load_settings") return { server: "https://ntfy.example.com", topic: "alerts", username: "test-user", password: "not-a-real-password" };
        if (command === "get_sound_enabled" || command === "updater_supported" || command === "plugin:notification|is_permission_granted") return true;
        if (command === "plugin:updater|check") return null;
        return false;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  await page.goto("http://127.0.0.1:1420");
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.getByText("已是最新版本", { exact: true }).waitFor();
  const results = [];
  async function measure(label, requireNoPanelScroll) {
    const result = await page.evaluate(() => {
      const panels = [...document.querySelectorAll(".settings, .preferences")].map(el => ({ class: el.className, height: el.clientHeight, scroll: el.scrollHeight }));
      const submit = document.querySelector(".primary")?.getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight, documentWidth: document.documentElement.scrollWidth, panels, submitBottom: submit?.bottom };
    });
    if (result.documentHeight > result.height || result.documentWidth > result.width) throw new Error(`${label}: document overflow ${JSON.stringify(result)}`);
    if (requireNoPanelScroll && result.panels.some(panel => panel.scroll > panel.height + 1)) throw new Error(`${label}: settings need scrolling ${JSON.stringify(result)}`);
    if (requireNoPanelScroll && result.submitBottom > result.height) throw new Error(`${label}: submit is outside viewport`);
    results.push({ label, ...result });
  }
  await measure("default", true);
  await page.setViewportSize({ width: 960, height: 680 });
  await measure("minimum", true);
  await page.getByLabel("服务器地址").fill("http://ntfy.example.com");
  await measure("HTTP warning", true);
  await page.evaluate(() => window.__emitLayoutSnapshot({ ...window.__layoutSnapshot, revision: 1, notification_error: "通知错误".repeat(100), tray_error: "托盘错误".repeat(100) }));
  await page.getByText(/需要留意/).waitFor();
  await measure("long error summaries", true);
  await page.getByText(/需要留意/).click();
  await measure("expanded errors remain accessible", false);
  await page.setViewportSize({ width: 768, height: 544 });
  await measure("125 percent equivalent CSS viewport", false);
  // Equivalent CSS viewport to a 960×680 window at 150% display scaling.
  await page.setViewportSize({ width: 640, height: 453 });
  await measure("150 percent equivalent CSS viewport", false);
  const nonOverlapping = await page.evaluate(() => document.querySelector(".settings").getBoundingClientRect().bottom <= document.querySelector(".preferences").getBoundingClientRect().top);
  if (!nonOverlapping) throw new Error("Scaled settings panels overlap");
  await page.getByRole("button", { name: "检查更新", exact: true }).scrollIntoViewIfNeeded();
  const accessible = await page.getByRole("button", { name: "检查更新", exact: true }).evaluate(el => {
    const box = el.getBoundingClientRect(); const area = document.querySelector(".workspace").getBoundingClientRect();
    return box.top >= area.top && box.bottom <= area.bottom;
  });
  if (!accessible) throw new Error("Scaled settings controls cannot be reached by scrolling");
  await page.setViewportSize({ width: 960, height: 680 });
  await page.evaluate(() => {
    window.__emitLayoutSnapshot({ ...window.__layoutSnapshot, revision: 2, view_mode: "messages", messages: Array.from({ length: 100 }, (_, i) => ({ id: String(i), time: 1, topic: "alerts", title: `Message ${i}`, message: "Long message ".repeat(100) })) });
  });
  await page.getByRole("list", { name: "收到的消息" }).waitFor();
  const list = await page.getByRole("list", { name: "收到的消息" }).evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
  if (list.height <= 0 || list.scroll <= list.height) throw new Error("Message list must scroll internally");
  await measure("100 long messages", false);
  await page.goto("http://127.0.0.1:1420?layout-errors");
  await page.getByText("自启动状态未知", { exact: true }).waitFor();
  await page.getByText(/检查更新失败/).waitFor();
  await measure("combined preference read failures", false);
  await page.getByRole("button", { name: "检查更新", exact: true }).scrollIntoViewIfNeeded();
  return { results, list };
}
