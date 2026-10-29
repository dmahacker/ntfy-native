import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), permission: vi.fn(), request: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-notification", () => ({ isPermissionGranted: mocks.permission, requestPermission: mocks.request }));
const config = { server: "https://ntfy.example.com", topic: "alerts", username: "alice", password: "secret" };
const snapshot = { revision: 0, status: "disconnected", detail: "尚未连接", notification_error: null as string | null, messages: [], view_mode: "settings", unread_count: 0, tray_available: true, tray_error: null as string | null };
function backend(saved: typeof config | null = null, initial = snapshot) {
  mocks.invoke.mockImplementation(async (command: string) => command === "load_settings" ? saved : command === "get_snapshot" ? initial : command === "get_sound_enabled" ? true : command === "plugin:autostart|is_enabled" ? false : undefined);
}
async function ready() { await waitFor(() => expect(screen.getByRole("button", { name: "保存并连接" }).matches(":disabled")).toBe(false)); }
function publish(payload: object) { act(() => mocks.listen.mock.calls[0][1]({ payload })); }
beforeEach(() => { mocks.listen.mockResolvedValue(vi.fn()); mocks.permission.mockResolvedValue(true); backend(); });
afterEach(cleanup);

describe("tray client windows", () => {
  it("keeps sound settings independent when credentials are cleared", async () => {
    backend(config); render(<App />); await ready();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "新消息提示音" })).toHaveProperty("checked", true));
    await userEvent.click(screen.getByRole("button", { name: "清除配置" }));
    await waitFor(() => expect(screen.getByLabelText("密码")).toHaveProperty("value", ""));
    expect(screen.getByRole("checkbox", { name: "新消息提示音" })).toHaveProperty("checked", true);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "set_sound_enabled")).toBe(false);
  });
  it("restores credentials without starting a duplicate subscription under StrictMode", async () => {
    backend(config); render(<StrictMode><App /></StrictMode>); await ready();
    expect(screen.getByLabelText("密码")).toHaveProperty("value", "secret");
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "connect")).toHaveLength(0);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("message view contains no credential form and asks the backend to open settings", async () => {
    backend(config, { ...snapshot, view_mode: "messages", status: "connected" });
    render(<App />);
    const settings = await screen.findByRole("button", { name: "连接设置" });
    await waitFor(() => expect(settings.matches(":disabled")).toBe(false));
    expect(screen.queryByLabelText("密码")).toBeNull();
    await userEvent.click(settings);
    expect(mocks.invoke).toHaveBeenCalledWith("show_view", { mode: "settings" });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "connect")).toHaveLength(0);
  });
  it("saves settings, supports disconnect and clearing, and leaves hiding to the native backend", async () => {
    const user = userEvent.setup(); render(<App />); await ready();
    for (const [label, value] of [["服务器地址", config.server], ["订阅主题", config.topic], ["用户名", config.username], ["密码", config.password]]) await user.type(screen.getByLabelText(label), value);
    await user.click(screen.getByRole("button", { name: "保存并连接" }));
    expect(mocks.invoke).toHaveBeenCalledWith("connect", { config });
    expect(mocks.invoke).not.toHaveBeenCalledWith("hide_window");
    await user.click(screen.getByRole("button", { name: "断开连接" }));
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect");
    await user.click(screen.getByRole("button", { name: "清除配置" }));
    expect(mocks.invoke).toHaveBeenCalledWith("clear_settings");
    expect(screen.getByLabelText("密码")).toHaveProperty("value", "");
  });
  it("shows HTTP warning and denied notification permission without reconnecting on mount", async () => {
    backend({ ...config, server: "http://localhost:8080" });
    mocks.permission.mockResolvedValue(false); mocks.request.mockResolvedValue("denied");
    render(<App />); await ready();
    expect(screen.getByText(/HTTP 会以明文传输/)).toBeTruthy();
    expect(mocks.request).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "保存并连接" }));
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(screen.getByText(/通知权限未获准/)).toBeTruthy();
  });
  it("renders native errors and tray fallback prominently", async () => {
    backend(null, { ...snapshot, status: "error", detail: "认证失败，请检查用户名和密码", tray_available: false, tray_error: "托盘不可用，已保留窗口" });
    render(<App />); await ready();
    expect(screen.getByText(/托盘不可用/)).toBeTruthy();
    expect(screen.getByText(/认证失败/)).toBeTruthy();
    expect(screen.getByText(/关闭窗口将退出/)).toBeTruthy();
  });
  it("renders plain text messages, switches native view and ignores stale revisions", async () => {
    render(<App />); await ready();
    publish({ ...snapshot, view_mode: "messages", revision: 3, status: "connected", messages: [{ id: "1", time: 1, topic: "alerts", title: "New alert", message: "<script>danger</script>" }] });
    expect(await screen.findByText("New alert")).toBeTruthy();
    expect(screen.queryByLabelText("密码")).toBeNull();
    expect(screen.getByText("<script>danger</script>")).toBeTruthy();
    publish({ ...snapshot, revision: 2 });
    expect(screen.getByText("New alert")).toBeTruthy();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "connect")).toHaveLength(0);
  });
  it("keeps saved credentials on clear failure", async () => {
    backend(config);
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command: string, args?: object) => { if (command === "clear_settings") throw "无法清除配置文件"; return original(command, args); });
    render(<App />); await ready();
    await userEvent.click(screen.getByRole("button", { name: "清除配置" }));
    expect(await screen.findByText("无法清除配置文件")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toHaveProperty("value", "secret");
  });
  it("requests the messages view rather than locally clearing unread state", async () => {
    render(<App />); await ready();
    await userEvent.click(screen.getByRole("button", { name: "查看消息" }));
    expect(mocks.invoke).toHaveBeenCalledWith("show_view", { mode: "messages" });
  });
});

// The actual plugin bindings run against an IPC fake; no desktop login items are modified.
function autostart(initial: boolean) {
  let enabled = initial;
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args?: object) => {
    if (command === "plugin:autostart|is_enabled") return enabled;
    if (command === "plugin:autostart|enable") { enabled = true; return; }
    if (command === "plugin:autostart|disable") { enabled = false; return; }
    return original(command, args);
  });
}
const loginCheckbox = () => screen.getByRole("checkbox", { name: "登录后自动启动" });
async function autostartReady() { await waitFor(() => expect(loginCheckbox()).toHaveProperty("disabled", false)); }

describe("login autostart settings", () => {
  it.each([false, true])("reads the OS state (%s) without modifying it on mount", async enabled => {
    autostart(enabled); render(<StrictMode><App /></StrictMode>); await autostartReady();
    expect(loginCheckbox()).toHaveProperty("checked", enabled);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "plugin:autostart|enable" || command === "plugin:autostart|disable")).toBe(false);
  });
  it("enables and disables immediately, independently of connection credentials", async () => {
    autostart(false); render(<App />); await autostartReady();
    await userEvent.click(loginCheckbox());
    await waitFor(() => expect(loginCheckbox()).toHaveProperty("checked", true));
    expect(screen.getByLabelText("密码")).toHaveProperty("value", "");
    await userEvent.click(loginCheckbox());
    await waitFor(() => expect(loginCheckbox()).toHaveProperty("checked", false));
  });
  it("shows an unknown state and allows retry when the initial OS query fails", async () => {
    // Fail only the plugin query; subscription initialization must keep working.
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockReset().mockImplementation(async (command: string, args?: object) => {
      if (command === "plugin:autostart|is_enabled") throw "系统登录项不可读";
      return original(command, args);
    });
    render(<App />); await ready();
    expect(await screen.findByText(/无法读取自启动状态/)).toBeTruthy();
    expect(loginCheckbox()).toHaveProperty("disabled", true);
    expect(screen.getByText(/状态未知/)).toBeTruthy();
    autostart(true);
    await userEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await autostartReady();
    expect(loginCheckbox()).toHaveProperty("checked", true);
    expect(screen.queryByText(/无法读取自启动状态/)).toBeNull();
  });
  it.each([false, true])("preserves actual state (%s) and shows write errors", async enabled => {
    autostart(enabled);
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command: string, args?: object) => {
      if (command === "plugin:autostart|enable" || command === "plugin:autostart|disable") throw "系统拒绝修改";
      return original(command, args);
    });
    render(<App />); await autostartReady();
    await userEvent.click(loginCheckbox());
    expect(await screen.findByText(/无法修改自启动设置/)).toBeTruthy();
    expect(loginCheckbox()).toHaveProperty("checked", enabled);
    expect(loginCheckbox()).toHaveProperty("disabled", false);
  });
  it("disables duplicate submissions and reads back the OS result rather than assuming success", async () => {
    autostart(false);
    const original = mocks.invoke.getMockImplementation()!;
    let finish!: () => void;
    mocks.invoke.mockImplementation(async (command: string, args?: object) => {
      if (command === "plugin:autostart|enable") return new Promise<void>(resolve => { finish = resolve; });
      return original(command, args);
    });
    render(<App />); await autostartReady();
    await userEvent.click(loginCheckbox());
    expect(loginCheckbox()).toHaveProperty("disabled", true);
    await act(async () => finish());
    await autostartReady();
    expect(loginCheckbox()).toHaveProperty("checked", false);
    expect(await screen.findByText(/系统未应用/)).toBeTruthy();
  });
  it("does not change login items when clearing connection credentials", async () => {
    backend(config); autostart(true); render(<App />); await ready(); await autostartReady();
    await userEvent.click(screen.getByRole("button", { name: "清除配置" }));
    await waitFor(() => expect(screen.getByLabelText("密码")).toHaveProperty("value", ""));
    expect(loginCheckbox()).toHaveProperty("checked", true);
    expect(mocks.invoke.mock.calls.some(([command]) => command === "plugin:autostart|disable")).toBe(false);
  });
  it("marks state unknown if readback fails after a successful write", async () => {
    autostart(false);
    const original = mocks.invoke.getMockImplementation()!;
    let written = false;
    mocks.invoke.mockImplementation(async (command: string, args?: object) => {
      if (command === "plugin:autostart|enable") { written = true; return; }
      if (command === "plugin:autostart|is_enabled" && written) throw "读取失败";
      return original(command, args);
    });
    render(<App />); await autostartReady();
    await userEvent.click(loginCheckbox());
    expect(await screen.findByText(/无法读取自启动状态/)).toBeTruthy();
    expect(loginCheckbox()).toHaveProperty("disabled", true);
    expect(screen.getByText(/状态未知/)).toBeTruthy();
  });
});
