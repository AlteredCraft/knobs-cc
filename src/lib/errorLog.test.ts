import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  _resetForTesting,
  clearErrors,
  getEntries,
  getUnseenCount,
  installGlobalHandlers,
  markAllSeen,
  reportError,
  subscribe,
} from "./errorLog";

beforeEach(() => {
  _resetForTesting();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportError", () => {
  test("records an entry with id, timestamp, and message", () => {
    const entry = reportError({ message: "boom" });
    expect(entry.id).toBe(1);
    expect(entry.message).toBe("boom");
    expect(typeof entry.timestamp).toBe("number");
    expect(getEntries()).toHaveLength(1);
  });

  test("formats Error detail as stack/name+message", () => {
    const err = new Error("scope rejected");
    const entry = reportError({ message: "open failed", detail: err });
    expect(entry.detail).toContain("scope rejected");
  });

  test("formats string detail as-is", () => {
    const entry = reportError({ message: "x", detail: "raw string" });
    expect(entry.detail).toBe("raw string");
  });

  test("formats object detail as JSON", () => {
    const entry = reportError({ message: "x", detail: { code: 42, ok: false } });
    expect(entry.detail).toContain('"code": 42');
    expect(entry.detail).toContain('"ok": false');
  });

  test("newest entry comes first", () => {
    reportError({ message: "first" });
    reportError({ message: "second" });
    const entries = getEntries();
    expect(entries[0].message).toBe("second");
    expect(entries[1].message).toBe("first");
  });

  test("caps stored entries at 50", () => {
    for (let i = 0; i < 60; i++) reportError({ message: `e${i}` });
    expect(getEntries()).toHaveLength(50);
    expect(getEntries()[0].message).toBe("e59");
    expect(getEntries()[49].message).toBe("e10");
  });

  test("mirrors to console.error", () => {
    reportError({ message: "boom", source: "openInEditor" });
    expect(console.error).toHaveBeenCalledWith(
      "[openInEditor] boom",
      undefined,
    );
  });
});

describe("subscribe", () => {
  test("notifies on report and clear", () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    reportError({ message: "a" });
    expect(fn).toHaveBeenCalledTimes(1);
    clearErrors();
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
    reportError({ message: "b" });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("unseen tracking", () => {
  test("getUnseenCount returns total before any markAllSeen", () => {
    reportError({ message: "a" });
    reportError({ message: "b" });
    expect(getUnseenCount()).toBe(2);
  });

  test("markAllSeen zeros unseen count", () => {
    reportError({ message: "a" });
    reportError({ message: "b" });
    markAllSeen();
    expect(getUnseenCount()).toBe(0);
  });

  test("subsequent reports increment unseen", () => {
    reportError({ message: "a" });
    markAllSeen();
    reportError({ message: "b" });
    reportError({ message: "c" });
    expect(getUnseenCount()).toBe(2);
  });

  test("markAllSeen on empty log is a no-op (no notify)", () => {
    const fn = vi.fn();
    subscribe(fn);
    markAllSeen();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("clearErrors", () => {
  test("removes all entries", () => {
    reportError({ message: "a" });
    reportError({ message: "b" });
    clearErrors();
    expect(getEntries()).toHaveLength(0);
    expect(getUnseenCount()).toBe(0);
  });

  test("on empty log is a no-op (no notify)", () => {
    const fn = vi.fn();
    subscribe(fn);
    clearErrors();
    expect(fn).not.toHaveBeenCalled();
  });
});

// Vitest runs in node by default — no DOM. Rather than pulling in jsdom
// for three tests, stub a minimal `window` and capture the listeners as
// they're registered, then invoke them directly.
type Listener = (e: unknown) => void;
type FakeWindow = {
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
  __listeners: Map<string, Set<Listener>>;
};

function makeFakeWindow(): FakeWindow {
  const map = new Map<string, Set<Listener>>();
  return {
    __listeners: map,
    addEventListener(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      map.get(type)?.delete(fn);
    },
  };
}

describe("installGlobalHandlers", () => {
  test("captures unhandled rejections with reason as message", () => {
    const fake = makeFakeWindow();
    vi.stubGlobal("window", fake);
    const uninstall = installGlobalHandlers();
    const reason = new Error("kaboom");
    for (const fn of fake.__listeners.get("unhandledrejection") ?? []) {
      fn({ reason });
    }
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("kaboom");
    expect(entries[0].source).toBe("unhandledrejection");
    uninstall();
    vi.unstubAllGlobals();
  });

  test("captures window.onerror events", () => {
    const fake = makeFakeWindow();
    vi.stubGlobal("window", fake);
    const uninstall = installGlobalHandlers();
    for (const fn of fake.__listeners.get("error") ?? []) {
      fn({
        message: "Uncaught TypeError: foo",
        error: new TypeError("foo"),
        filename: "x.js",
        lineno: 1,
        colno: 2,
      });
    }
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("Uncaught TypeError: foo");
    expect(entries[0].source).toBe("window.onerror");
    uninstall();
    vi.unstubAllGlobals();
  });

  test("uninstall removes handlers", () => {
    const fake = makeFakeWindow();
    vi.stubGlobal("window", fake);
    const uninstall = installGlobalHandlers();
    uninstall();
    expect(fake.__listeners.get("error")?.size ?? 0).toBe(0);
    expect(fake.__listeners.get("unhandledrejection")?.size ?? 0).toBe(0);
    vi.unstubAllGlobals();
  });
});
