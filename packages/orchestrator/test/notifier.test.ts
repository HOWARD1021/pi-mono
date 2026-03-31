import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { Notifier } from "../src/notifier.js";

describe("Notifier", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "123456";
    mockFetch.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    vi.clearAllMocks();
  });

  it("sends a ready notification via Telegram fetch", async () => {
    const notifier = new Notifier();
    await notifier.notifyReady("task-1", 42, "https://github.com/org/repo/pull/42");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("test-token");
    expect(url).toContain("sendMessage");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("123456");
    expect(body.text).toContain("task-1");
    expect(body.text).toContain("#42");
  });

  it("logs to console when tokens are missing", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const notifier = new Notifier();
    await notifier.notifyFailed("task-2", 3, "CI exploded");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
