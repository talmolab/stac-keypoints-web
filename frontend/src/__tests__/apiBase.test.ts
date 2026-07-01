import { describe, it, expect } from "vitest";
import { resolveApiBase, backendStatusFrom } from "../api";

describe("resolveApiBase", () => {
  it("prefers the localStorage override over env and same-origin", () => {
    expect(resolveApiBase("http://box:8000", "http://env:9000")).toBe("http://box:8000");
  });

  it("falls back to VITE_API_BASE when no override is stored", () => {
    expect(resolveApiBase(null, "http://env:9000")).toBe("http://env:9000");
    expect(resolveApiBase("", "http://env:9000")).toBe("http://env:9000");
    expect(resolveApiBase("   ", "http://env:9000")).toBe("http://env:9000");
  });

  it("defaults to same-origin ('') when nothing is set", () => {
    expect(resolveApiBase(null, null)).toBe("");
    expect(resolveApiBase(undefined, undefined)).toBe("");
    expect(resolveApiBase("", "")).toBe("");
  });

  it("strips trailing slashes so ${BASE}/api/... never doubles up", () => {
    expect(resolveApiBase("http://box:8000/")).toBe("http://box:8000");
    expect(resolveApiBase("http://box:8000///")).toBe("http://box:8000");
    expect(resolveApiBase(null, "http://env:9000/")).toBe("http://env:9000");
  });
});

describe("backendStatusFrom", () => {
  it("is connected whenever the probe succeeds, regardless of base", () => {
    expect(backendStatusFrom(true, "")).toBe("connected");
    expect(backendStatusFrom(true, "http://box:8000")).toBe("connected");
  });

  it("is standalone when the probe fails and no base is configured", () => {
    expect(backendStatusFrom(false, "")).toBe("standalone");
  });

  it("is unreachable when a base is configured but the probe fails", () => {
    expect(backendStatusFrom(false, "http://box:8000")).toBe("unreachable");
  });
});
