import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WindowTitlebar from "./WindowTitlebar";
const native = vi.hoisted(() => ({ minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn(), onResized: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
beforeEach(() => {
  vi.resetAllMocks();
  native.isMaximized.mockResolvedValue(false);
  native.onResized.mockResolvedValue(vi.fn());
  for (const method of [native.minimize, native.toggleMaximize, native.close]) method.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("uses native close so the backend can keep the app in the tray", async () => {
  render(<WindowTitlebar />);
  await userEvent.click(screen.getByRole("button", { name: "关闭窗口" }));
  expect(native.close).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "最小化" }));
  expect(native.minimize).toHaveBeenCalledTimes(1);
});
it("reflects window manager maximize changes and releases the listener", async () => {
  const unlisten = vi.fn(); native.onResized.mockResolvedValue(unlisten);
  const view = render(<WindowTitlebar />);
  await waitFor(() => expect(native.onResized).toHaveBeenCalledTimes(1));
  native.isMaximized.mockResolvedValue(true);
  await act(async () => native.onResized.mock.calls[0][0]());
  await userEvent.click(screen.getByRole("button", { name: "还原窗口" }));
  expect(native.toggleMaximize).toHaveBeenCalledTimes(1);
  view.unmount(); expect(unlisten).toHaveBeenCalledTimes(1);
});
it("keeps a native-operation failure visible", async () => {
  native.close.mockRejectedValue("denied");
  render(<WindowTitlebar />);
  await userEvent.click(screen.getByRole("button", { name: "关闭窗口" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "窗口操作失败，请重试。");
});
