import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SoundSetting from "./SoundSetting";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
it("reads and immediately persists sound changes", async () => {
  invoke.mockResolvedValue(true);
  render(<SoundSetting />);
  const checkbox = screen.getByRole("checkbox", { name: "新消息提示音" });
  await waitFor(() => expect(checkbox).toHaveProperty("checked", true));
  fireEvent.click(checkbox);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_sound_enabled", { enabled: false }));
  await waitFor(() => expect(checkbox).toHaveProperty("checked", false));
});
it("keeps actual state and displays save errors", async () => {
  invoke.mockResolvedValueOnce(true).mockRejectedValueOnce("磁盘只读");
  render(<SoundSetting />);
  const checkbox = screen.getByRole("checkbox", { name: "新消息提示音" });
  await waitFor(() => expect(checkbox).toHaveProperty("checked", true));
  fireEvent.click(checkbox);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "磁盘只读");
  expect(checkbox).toHaveProperty("checked", true);
});
it("disables unknown state and supports retry", async () => {
  invoke.mockRejectedValueOnce("读取失败").mockResolvedValue(false);
  render(<SoundSetting />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "读取失败");
  expect(screen.getByRole("checkbox")).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "重新读取声音设置" }));
  await waitFor(() => expect(screen.getByRole("checkbox")).toHaveProperty("disabled", false));
});
