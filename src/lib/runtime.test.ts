import { describe, expect, test } from "vitest";

import type { ClaudeProcess, RuntimeSnapshot, SessionGrounding } from "@/types";
import {
  deriveSessionGrounding,
  groundingToInvokeArgs,
  shortLabel,
  tildify,
} from "./runtime";

function mkProc(pid: number, cwd: string, startedAt = 0): ClaudeProcess {
  return {
    pid,
    started_at: startedAt,
    cwd,
    argv: ["claude"],
    environ: {},
  };
}

function snap(
  processes: ClaudeProcess[],
  status: RuntimeSnapshot["platform_status"] = "ok",
  error: string | null = null,
): RuntimeSnapshot {
  return { processes, platform_status: status, error };
}

describe("deriveSessionGrounding", () => {
  test("unsupported platform → unsupported state", () => {
    const g = deriveSessionGrounding(snap([], "unsupported"), null, null);
    expect(g.kind).toBe("unsupported");
  });

  test("sysinfo error → no-claude state, carrying picked root", () => {
    const g = deriveSessionGrounding(
      snap([], "error"),
      null,
      "/Users/sam/Projects/foo",
    );
    expect(g).toEqual({
      kind: "no-claude",
      pickedRoot: "/Users/sam/Projects/foo",
    });
  });

  test("zero processes → no-claude", () => {
    const g = deriveSessionGrounding(snap([]), null, null);
    expect(g).toEqual({ kind: "no-claude", pickedRoot: null });
  });

  test("zero processes carries previous picked root forward", () => {
    const g = deriveSessionGrounding(snap([]), null, "/tmp/proj");
    expect(g).toEqual({ kind: "no-claude", pickedRoot: "/tmp/proj" });
  });

  test("exactly one process → auto-attach", () => {
    const p = mkProc(4172, "/Users/sam/Projects/foo");
    const g = deriveSessionGrounding(snap([p]), null, null);
    expect(g.kind).toBe("attached");
    if (g.kind === "attached") {
      expect(g.pid).toBe(4172);
      expect(g.process).toEqual(p);
    }
  });

  test("prior pid still present → keep that selection across refreshes", () => {
    // Two claudes are running; user previously selected the second. A
    // refresh should keep them on the second, not silently switch to the
    // first or drop them into the picker.
    const a = mkProc(100, "/a", 1);
    const b = mkProc(200, "/b", 2);
    const g = deriveSessionGrounding(snap([a, b]), 200, null);
    expect(g.kind).toBe("attached");
    if (g.kind === "attached") {
      expect(g.pid).toBe(200);
    }
  });

  test("prior pid gone → fall back to no-claude even when processes exist", () => {
    // User's claude died; two other claudes are running. Don't auto-attach
    // to one of them — make the user pick explicitly.
    const a = mkProc(100, "/a", 1);
    const b = mkProc(200, "/b", 2);
    const g = deriveSessionGrounding(snap([a, b]), 999, null);
    expect(g).toEqual({ kind: "no-claude", pickedRoot: null });
  });

  test("two+ processes with no prior → no-claude (pick required)", () => {
    const a = mkProc(100, "/a", 1);
    const b = mkProc(200, "/b", 2);
    const g = deriveSessionGrounding(snap([a, b]), null, null);
    expect(g).toEqual({ kind: "no-claude", pickedRoot: null });
  });
});

describe("groundingToInvokeArgs", () => {
  test("attached → attached_pid", () => {
    const g: SessionGrounding = {
      kind: "attached",
      pid: 42,
      process: mkProc(42, "/x"),
    };
    expect(groundingToInvokeArgs(g)).toEqual({ attached_pid: 42 });
  });

  test("no-claude with pickedRoot → project_root_override", () => {
    const g: SessionGrounding = { kind: "no-claude", pickedRoot: "/tmp/x" };
    expect(groundingToInvokeArgs(g)).toEqual({
      project_root_override: "/tmp/x",
    });
  });

  test("no-claude with no pickedRoot → empty args (legacy CWD fallback)", () => {
    const g: SessionGrounding = { kind: "no-claude", pickedRoot: null };
    expect(groundingToInvokeArgs(g)).toEqual({});
  });

  test("loading / unsupported → empty args", () => {
    expect(groundingToInvokeArgs({ kind: "loading" })).toEqual({});
    expect(groundingToInvokeArgs({ kind: "unsupported" })).toEqual({});
  });
});

describe("tildify", () => {
  test("returns plain path when home is null", () => {
    expect(tildify("/Users/sam/foo", null)).toBe("/Users/sam/foo");
  });

  test("collapses home prefix to ~", () => {
    expect(tildify("/Users/sam", "/Users/sam")).toBe("~");
    expect(tildify("/Users/sam/foo", "/Users/sam")).toBe("~/foo");
  });

  test("leaves unrelated paths alone", () => {
    expect(tildify("/tmp/x", "/Users/sam")).toBe("/tmp/x");
    // Prefix match that isn't a directory boundary — must not match.
    expect(tildify("/Users/samuel/foo", "/Users/sam")).toBe(
      "/Users/samuel/foo",
    );
  });
});

describe("shortLabel", () => {
  test("includes pid + tildified cwd", () => {
    const p = mkProc(4172, "/Users/sam/Projects/foo");
    expect(shortLabel(p, "/Users/sam")).toBe("PID 4172 · ~/Projects/foo");
  });
});
