import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), permission: vi.fn(), request: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-notification", () => ({ isPermissionGranted: mocks.permission, requestPermission: mocks.request }));
const config = { server: "https://ntfy.example.com", topic: "alerts", username: "alice", password: "secret" };
const snapshot = { revision: 0, status: "disconnected", detail: "尚未连接", notification_error: null, messages: [] };

beforeEach(() => {
  mocks.listen.mockResolvedValue(vi.fn());
  mocks.permission.mockResolvedValue(true);
  mocks.invoke.mockImplementation(async (command: string) => command === "load_settings" ? null : command === "get_snapshot" ? snapshot : undefined);
});
afterEach(cleanup);

describe("ntfy client", () => {
  it("restores saved credentials and connects only once under StrictMode", async () => {
    mocks.invoke.mockImplementation(async (command: string) => command === "load_settings" ? config : command === "get_snapshot" ? snapshot : undefined);
    render(<StrictMode><App /></StrictMode>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("connect", { config }));
    expect(screen.getByLabelText("密码")).toHaveProperty("value", "secret");
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "connect")).toHaveLength(1);
  });
  it("saves and connects then supports disconnect and clearing credentials", async () => {
    const user = userEvent.setup(); render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存并连接" })).toHaveProperty("disabled", false));
    await user.type(screen.getByLabelText("服务器地址"), config.server);
    await user.type(screen.getByLabelText("订阅主题"), config.topic);
    await user.type(screen.getByLabelText("用户名"), config.username);
    await user.type(screen.getByLabelText("密码"), config.password);
    await user.click(screen.getByRole("button", { name: "保存并连接" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("connect", { config }));
    await user.click(screen.getByRole("button", { name: "断开连接" }));
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect");
    await user.click(screen.getByRole("button", { name: "清除配置" }));
    expect(mocks.invoke).toHaveBeenCalledWith("clear_settings");
    await waitFor(() => expect(screen.getByLabelText("密码")).toHaveProperty("value", ""));
  });
  it("shows HTTP warning, connection errors and denied notification permission", async () => {
    const user = userEvent.setup();
    mocks.permission.mockResolvedValue(false); mocks.request.mockResolvedValue("denied");
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "load_settings") return { ...config, server: "http://localhost:8080" };
      if (command === "get_snapshot") return snapshot;
      if (command === "connect") throw "认证失败，请检查用户名和密码";
    });
    render(<App />);
    expect(await screen.findByText(/认证失败/)).toBeTruthy();
    expect(screen.getByText(/HTTP 会以明文传输/)).toBeTruthy();
    expect(screen.getByText(/通知权限未获准/)).toBeTruthy();
    await user.clear(screen.getByLabelText("密码"));
  });
  it("renders incoming messages as text and ignores stale snapshots", async () => {
    render(<App />);
    await waitFor(() => expect(mocks.listen).toHaveBeenCalled());
    const callback = mocks.listen.mock.calls[0][1];
    act(() => callback({ payload: { ...snapshot, revision: 3, status: "connected", detail: "已连接", messages: [{ id: "1", time: 1, topic: "alerts", title: "New alert", message: "<script>danger</script>" }] } }));
    expect(await screen.findByText("New alert")).toBeTruthy();
    expect(screen.getByText("<script>danger</script>")).toBeTruthy();
    act(() => callback({ payload: { ...snapshot, revision: 2 } }));
    expect(screen.getByText("New alert")).toBeTruthy();
  });
  it("keeps saved credentials on clear failure", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "load_settings") return config;
      if (command === "get_snapshot") return snapshot;
      if (command === "clear_settings") throw "无法清除配置文件";
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "清除配置" })).toHaveProperty("disabled", false));
    await userEvent.click(screen.getByRole("button", { name: "清除配置" }));
    expect(await screen.findByText("无法清除配置文件")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toHaveProperty("value", "secret");
  });
});
