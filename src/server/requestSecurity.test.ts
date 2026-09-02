import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "./requestSecurity.js";

describe("Origin validation", () => {
  it("accepts same-origin requests", () => {
    expect(isOriginAllowed("http://wb.local:8787", "wb.local:8787", undefined)).toBe(true);
  });

  it("accepts an explicitly configured Vite origin", () => {
    expect(isOriginAllowed(
      "http://localhost:5173",
      "127.0.0.1:8787",
      "http://localhost:5173,http://127.0.0.1:5173",
    )).toBe(true);
  });

  it("rejects an unrelated or malformed origin", () => {
    expect(isOriginAllowed("https://example.com", "wb.local:8787", "http://localhost:5173")).toBe(false);
    expect(isOriginAllowed("not a URL", "wb.local:8787", undefined)).toBe(false);
  });
});
