import type { AppConfig, DeviceDraftResponse, MatterDeviceConfig, MqttTopicInfo, ValidationResult } from "../shared/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  getDevices: () => request<DeviceDraftResponse>("/api/v1/devices"),
  getTopics: () => request<MqttTopicInfo[]>("/api/v1/mqtt/topics"),
  getConfig: () => request<AppConfig>("/api/v1/config"),
  getStatus: () => request<any>("/api/v1/status"),
  getCommissioning: () => request<any>("/api/v1/matter/commissioning"),
  createDevice: (device: Omit<MatterDeviceConfig, "id" | "endpointId">, revision: number) =>
    request<{ draft: DeviceDraftResponse }>("/api/v1/devices", json({ device, expectedDraftRevision: revision })),
  updateDevice: (id: string, device: Omit<MatterDeviceConfig, "id" | "endpointId">, revision: number) =>
    request<{ draft: DeviceDraftResponse }>(`/api/v1/devices/${id}`, { ...json({ device, expectedDraftRevision: revision }), method: "PUT" }),
  deleteDevice: (id: string, revision: number) =>
    request<DeviceDraftResponse>(`/api/v1/devices/${id}?expectedDraftRevision=${revision}`, { method: "DELETE" }),
  discard: (revision: number) => request<DeviceDraftResponse>("/api/v1/config/discard", json({ expectedDraftRevision: revision })),
  validate: () => request<ValidationResult>("/api/v1/config/validate", json({})),
  apply: (draftRevision: number, configRevision: number) =>
    request<{ draft: DeviceDraftResponse }>("/api/v1/config/apply", json({ expectedDraftRevision: draftRevision, expectedConfigRevision: configRevision })),
  openCommissioning: () => request<any>("/api/v1/matter/commissioning/open", json({})),
  resetMatter: () => request<any>("/api/v1/matter/reset", json({ confirmation: "СБРОСИТЬ MATTER" })),
};
