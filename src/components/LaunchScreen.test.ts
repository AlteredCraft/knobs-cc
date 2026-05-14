import { describe, expect, test } from "vitest";

import type { ClaudeProcess, RuntimeSnapshot } from "@/types";
import { deriveAttachState } from "./LaunchScreen";

function mkProc(pid: number, cwd = "/tmp"): ClaudeProcess {
  return { pid, started_at: 0, cwd, argv: ["claude"], environ: {} };
}

function snap(
  processes: ClaudeProcess[],
  status: RuntimeSnapshot["platform_status"] = "ok",
): RuntimeSnapshot {
  return { processes, platform_status: status, error: null };
}

describe("deriveAttachState", () => {
  test("null snapshot → loading (cold start, before runtime read returns)", () => {
    expect(deriveAttachState(null)).toBe("loading");
  });

  test("unsupported platform wins over process count", () => {
    // Even if the platform listed processes, an `unsupported` status means
    // the runtime can't attribute argv/environ reliably (Windows v1). The
    // attach card should reflect that, not silently offer a broken attach.
    expect(deriveAttachState(snap([mkProc(1)], "unsupported"))).toBe(
      "unsupported",
    );
    expect(deriveAttachState(snap([], "unsupported"))).toBe("unsupported");
  });

  test("zero processes on a supported platform → empty (educational state)", () => {
    expect(deriveAttachState(snap([]))).toBe("empty");
  });

  test("one process → single (auto-prominent attach affordance)", () => {
    expect(deriveAttachState(snap([mkProc(42)]))).toBe("single");
  });

  test("two-plus processes → multi (user must pick)", () => {
    expect(deriveAttachState(snap([mkProc(1), mkProc(2)]))).toBe("multi");
    expect(
      deriveAttachState(snap([mkProc(1), mkProc(2), mkProc(3)])),
    ).toBe("multi");
  });

  test("sysinfo error status with processes present still surfaces them", () => {
    // The runtime layer can return `error` as a soft failure with a partial
    // process list. The launch screen treats this the same as a normal
    // read — `unsupported` is the only special-case status. (Mirrors how
    // PrecedenceRail treats `error`: best-effort, don't black-hole data.)
    expect(deriveAttachState(snap([mkProc(1)], "error"))).toBe("single");
  });
});
