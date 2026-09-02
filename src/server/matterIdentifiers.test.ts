import { describe, expect, it } from "vitest";
import { matterSerialNumber } from "./matterIdentifiers.js";

describe("Matter-facing identifiers", () => {
  it("creates a stable serial number within the Matter 32 character limit", () => {
    const uuid = "9a56a98f-e098-4130-923d-8a157e35057c";
    expect(matterSerialNumber(uuid)).toBe(matterSerialNumber(uuid));
    expect(matterSerialNumber(uuid)).toHaveLength(32);
  });

  it("does not expose or collide for different internal IDs", () => {
    const first = matterSerialNumber("9a56a98f-e098-4130-923d-8a157e35057c");
    const second = matterSerialNumber("fef90164-e75c-4b00-8b28-7c5721168bc5");
    expect(first).not.toContain("9a56a98f");
    expect(first).not.toBe(second);
  });
});
