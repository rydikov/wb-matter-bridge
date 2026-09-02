import { createHash } from "node:crypto";

export function matterSerialNumber(internalId: string): string {
  const digest = createHash("sha256").update(internalId).digest("hex");
  return `wb-${digest.slice(0, 29)}`;
}
