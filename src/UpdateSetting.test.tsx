import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UpdateSetting from "./UpdateSetting";

const mocks = vi.hoisted(() => ({ check: vi.fn(), invoke: vi.fn(), relaunch: vi.fn(), download: vi.fn(), close: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
const update = () => ({ version: "0.2.0", body: "New release", downloadAndInstall: mocks.download, close: mocks.close });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.invoke.mockResolvedValue(true);
  mocks.check.mockResolvedValue(update());
  mocks.download.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.relaunch.mockResolvedValue(undefined);
  mocks.openUrl.mockResolvedValue(undefined);
});
afterEach(cleanup);
it("checks once under StrictMode, but never installs before confirmation", async () => {
  render(<StrictMode><UpdateSetting /></StrictMode>);
  expect(await screen.findByText(/发现新版本 0.2.0/)).toBeTruthy();
  expect(mocks.check).toHaveBeenCalledTimes(1);
  expect(mocks.download).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "下载更新并重启" }));
  await waitFor(() => expect(mocks.relaunch).toHaveBeenCalledTimes(1));
  expect(mocks.download).toHaveBeenCalledTimes(1);
});
it("reports no updates and supports manual checks", async () => {
  mocks.check.mockResolvedValue(null);
  render(<UpdateSetting />);
  expect(await screen.findByText(/已是最新版本/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "检查更新" }));
  await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
});
it("does not invoke the updater for package-manager installs", async () => {
  mocks.invoke.mockResolvedValue(false);
  render(<UpdateSetting />);
  expect(await screen.findByText(/请从 GitHub Release 下载/)).toBeTruthy();
  expect(mocks.check).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "下载更新并重启" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "前往 GitHub Releases" }));
  expect(mocks.openUrl).toHaveBeenCalledWith("https://github.com/dmahacker/ntfy-native/releases");
});
it("shows check failures and can retry", async () => {
  mocks.check.mockRejectedValueOnce("Network unavailable");
  render(<UpdateSetting />);
  expect(await screen.findByText(/检查更新失败/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "检查更新" }));
  expect(await screen.findByText(/发现新版本 0.2.0/)).toBeTruthy();
});
it("blocks duplicate downloads, reports progress and releases a failed update before rechecking", async () => {
  let fail!: (reason: Error) => void;
  mocks.download.mockImplementationOnce((progress) => {
    progress({ event: "Started", data: { contentLength: 100 } });
    progress({ event: "Progress", data: { chunkLength: 25 } });
    return new Promise((_, reject) => { fail = reject; });
  });
  render(<UpdateSetting />);
  const button = await screen.findByRole("button", { name: "下载更新并重启" });
  await userEvent.click(button);
  expect(await screen.findByText(/25%/)).toBeTruthy();
  expect(button).toHaveProperty("disabled", true);
  await act(async () => fail(new Error("signature verification failed")));
  expect(await screen.findByText(/更新失败/)).toBeTruthy();
  expect(mocks.relaunch).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "检查更新" }));
  expect(await screen.findByRole("button", { name: "下载更新并重启" })).toBeTruthy();
});
it("allows retrying restart without reinstalling", async () => {
  mocks.relaunch.mockRejectedValueOnce("restart denied");
  render(<UpdateSetting />);
  await userEvent.click(await screen.findByRole("button", { name: "下载更新并重启" }));
  expect(await screen.findByText(/重启失败/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "重新启动" }));
  await waitFor(() => expect(mocks.relaunch).toHaveBeenCalledTimes(2));
  expect(mocks.download).toHaveBeenCalledTimes(1);
});
it("closes results that arrive after unmount", async () => {
  let finish!: (result: ReturnType<typeof update>) => void;
  mocks.check.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<UpdateSetting />);
  await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finish(update()));
  expect(mocks.close).toHaveBeenCalledTimes(1);
});
it("shows a manual URL when the external browser cannot be opened", async () => {
  mocks.invoke.mockResolvedValue(false);
  mocks.openUrl.mockRejectedValueOnce("browser unavailable");
  render(<UpdateSetting />);
  await userEvent.click(await screen.findByRole("button", { name: "前往 GitHub Releases" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("请手动访问"));
  expect(mocks.check).not.toHaveBeenCalled();
});
it("reports unknown download sizes and holds an in-flight resource until installation settles", async () => {
  let finish!: () => void;
  mocks.download.mockImplementationOnce(progress => {
    progress({ event: "Started", data: {} });
    progress({ event: "Progress", data: { chunkLength: 1048576 } });
    return new Promise<void>(resolve => { finish = resolve; });
  });
  const view = render(<UpdateSetting />);
  await userEvent.click(await screen.findByRole("button", { name: "下载更新并重启" }));
  expect(await screen.findByText("已下载 1.0 MB")).toBeTruthy();
  view.unmount();
  expect(mocks.close).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.relaunch).not.toHaveBeenCalled();
});
