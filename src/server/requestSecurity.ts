export function isOriginAllowed(origin: string | undefined, host: string | undefined, allowedOrigins: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (host && parsed.host === host) return true;
    const allowed = (allowedOrigins ?? "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
    return allowed.includes(parsed.origin);
  } catch {
    return false;
  }
}
