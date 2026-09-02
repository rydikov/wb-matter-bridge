import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { deviceTemplates, templateFor, type AttributeDefinition } from "../shared/deviceTemplates";
import type { AttributeBinding, DeviceDraftResponse, MatterDeviceConfig, MatterDeviceType, MqttTopicInfo } from "../shared/types";
import { api } from "./api";

type Tab = "devices" | "mqtt" | "commissioning";
type EditableDevice = Omit<MatterDeviceConfig, "id" | "endpointId"> & { id?: string; endpointId?: number | null };

export function App() {
  const [tab, setTab] = useState<Tab>("devices");
  const [draft, setDraft] = useState<DeviceDraftResponse>();
  const [topics, setTopics] = useState<MqttTopicInfo[]>([]);
  const [status, setStatus] = useState<any>();
  const [config, setConfig] = useState<any>();
  const [commissioning, setCommissioning] = useState<any>();
  const [editor, setEditor] = useState<EditableDevice>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const [nextDraft, nextTopics, nextStatus, nextConfig, nextCommissioning] = await Promise.all([
        api.getDevices(), api.getTopics(), api.getStatus(), api.getConfig(), api.getCommissioning(),
      ]);
      setDraft(nextDraft); setTopics(nextTopics); setStatus(nextStatus); setConfig(nextConfig); setCommissioning(nextCommissioning);
      setError("");
    } catch (e) { setError(messageOf(e)); }
  };

  useEffect(() => {
    void refresh();
    const source = new EventSource("/api/v1/events");
    let timer: number | undefined;
    source.onmessage = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 250); };
    ["mqtt.connected", "mqtt.disconnected", "mqtt.topic", "config.applied", "matter.factory-reset"].forEach(name => {
      source.addEventListener(name, () => { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 250); });
    });
    return () => { window.clearTimeout(timer); source.close(); };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  };

  const saveDevice = (device: EditableDevice) => run(async () => {
    if (!draft) return;
    const { id, endpointId: _endpointId, ...payload } = device;
    const result = id
      ? await api.updateDevice(id, payload, draft.draftRevision)
      : await api.createDevice(payload, draft.draftRevision);
    setDraft(result.draft); setEditor(undefined);
  });

  const apply = () => run(async () => {
    if (!draft) return;
    const validation = await api.validate();
    if (!validation.valid) {
      setError(validation.errors.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
      return;
    }
    const diff = validation.diff;
    const lines = [
      ...diff.added.map(item => `＋ ${item.name}: endpoint ${item.endpointId}`),
      ...diff.updated.map(item => `~ ${item.name}: endpoint ${item.endpointId}`),
      ...diff.replaced.map(item => `↻ ${item.name}: endpoint ${item.oldEndpointId} → ${item.newEndpointId}`),
      ...diff.removed.map(item => `− ${item.name}: endpoint ${item.endpointId}`),
    ];
    const summary = lines.length ? lines.join("\n") : "Изменений endpoints нет";
    if (!window.confirm(`Применить изменения?\n\n${summary}`)) return;
    const result = await api.apply(draft.draftRevision, draft.configRevision);
    setDraft(result.draft);
    await refresh();
  });

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">WB</span><div><strong>Matter Bridge</strong><small>Wiren Board 8</small></div></div>
      <nav>
        <Nav active={tab === "devices"} onClick={() => setTab("devices")} icon="◫">Устройства</Nav>
        <Nav active={tab === "mqtt"} onClick={() => setTab("mqtt")} icon="⌁">MQTT-топики</Nav>
        <Nav active={tab === "commissioning"} onClick={() => setTab("commissioning")} icon="◇">Подключение Matter</Nav>
      </nav>
      <div className="connection-summary">
        <StatusDot ok={status?.mqtt.connected} label={status?.mqtt.connected ? "MQTT подключён" : "MQTT недоступен"} />
        <StatusDot ok={status?.matter.started} label={status?.matter.commissioned ? "Matter подключён" : "Matter ожидает"} />
      </div>
    </aside>
    <main className="content">
      {error && <div className="alert"><pre>{error}</pre><button onClick={() => setError("")}>×</button></div>}
      {tab === "devices" && <DevicesPage
        draft={draft} topics={topics} matterStarted={Boolean(status?.matter.started)} busy={busy}
        onCreate={() => setEditor(newDevice("on_off_light"))}
        onEdit={device => setEditor(structuredClone(device))}
        onDelete={device => run(async () => {
          if (!draft || !window.confirm(`Удалить «${device.name}» из черновика? После применения endpoint будет удалён из Matter.`)) return;
          setDraft(await api.deleteDevice(device.id, draft.draftRevision));
        })}
        onApply={apply}
        onDiscard={() => run(async () => { if (draft) setDraft(await api.discard(draft.draftRevision)); })}
      />}
      {tab === "mqtt" && <MqttPage topics={topics} status={status} config={config} />}
      {tab === "commissioning" && <CommissioningPage data={commissioning} onOpen={() => run(async () => {
        setCommissioning(await api.openCommissioning());
      })} onReset={() => run(async () => {
        if (!window.confirm("Сбросить Matter fabrics? Список настроенных устройств сохранится.")) return;
        setCommissioning(await api.resetMatter());
      })} />}
    </main>
    {editor && draft && <DeviceEditor device={editor} topics={topics} busy={busy} onCancel={() => setEditor(undefined)} onSave={saveDevice} />}
  </div>;
}

function DevicesPage(props: {
  draft?: DeviceDraftResponse; topics: MqttTopicInfo[]; matterStarted: boolean; busy: boolean;
  onCreate(): void; onEdit(device: MatterDeviceConfig): void; onDelete(device: MatterDeviceConfig): void; onApply(): void; onDiscard(): void;
}) {
  const devices = props.draft?.devices ?? [];
  return <>
    <PageHeader eyebrow="Matter-модель" title="Устройства" description="Только созданные здесь устройства публикуются в Matter.">
      <button className="button primary" onClick={props.onCreate}>＋ Создать устройство</button>
    </PageHeader>
    {props.draft?.dirty && <div className="draft-bar">
      <span><strong>Есть неприменённые изменения</strong><small>Проверьте diff перед публикацией endpoints.</small></span>
      <div><button className="button ghost" disabled={props.busy} onClick={props.onDiscard}>Отменить</button><button className="button accent" disabled={props.busy} onClick={props.onApply}>Проверить и применить</button></div>
    </div>}
    {!devices.length ? <div className="empty"><div className="empty-icon">＋</div><h2>Пока нет Matter-устройств</h2><p>Создайте устройство и свяжите его атрибуты с MQTT-топиками.</p><button className="button primary" onClick={props.onCreate}>Создать первое устройство</button></div>
      : <div className="device-table">
        <div className="table-head"><span>Устройство</span><span>Тип</span><span>Endpoint</span><span>Атрибуты</span><span>Состояние</span><span /></div>
        {devices.map(device => {
          const health = deviceHealth(device, props.topics);
          return <div className="table-row" key={device.id}>
            <span className="device-name"><span className="device-icon">{iconFor(device.type)}</span><span><strong>{device.name}</strong><small>{device.room || "Помещение не указано"}</small></span></span>
            <span>{deviceTemplates[device.type].label}</span>
            <span className="mono">{device.endpointId ?? "после применения"}</span>
            <span>{Object.keys(device.attributes).length}</span>
            <span><span className={`pill ${health.ok ? "ok" : "warn"}`}>{health.label}</span>{device.endpointId !== null && <span className={`pill ${props.matterStarted ? "ok" : "warn"}`}>Matter</span>}</span>
            <span className="row-actions"><button title="Редактировать" onClick={() => props.onEdit(device)}>✎</button><button className="danger" title="Удалить" onClick={() => props.onDelete(device)}>⌫</button></span>
          </div>;
        })}
      </div>}
  </>;
}

function DeviceEditor({ device: initial, topics, busy, onCancel, onSave }: { device: EditableDevice; topics: MqttTopicInfo[]; busy: boolean; onCancel(): void; onSave(device: EditableDevice): void }) {
  const [device, setDevice] = useState(initial);
  const template = templateFor(device.type);
  const topicNames = topics.map(topic => topic.topic);

  const changeType = (type: MatterDeviceType) => {
    const next = newDevice(type);
    setDevice({ ...device, type, attributes: next.attributes });
  };
  const toggleAttribute = (definition: AttributeDefinition, enabled: boolean) => {
    const attributes = { ...device.attributes };
    if (enabled) attributes[definition.key] = defaultBinding(definition);
    else delete attributes[definition.key];
    setDevice({ ...device, attributes });
  };
  const updateBinding = (key: string, patch: Partial<AttributeBinding>) => {
    setDevice({ ...device, attributes: { ...device.attributes, [key]: { ...device.attributes[key], ...patch } } });
  };

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onCancel()}>
    <section className="modal editor-modal">
      <header><div><small>{device.id ? "Редактирование" : "Новое устройство"}</small><h2>{device.name || "Matter-устройство"}</h2></div><button className="close" onClick={onCancel}>×</button></header>
      <div className="editor-body">
        <section className="form-section"><div className="section-number">1</div><div className="section-content"><h3>Тип и название</h3>
          <div className="field-grid"><label>Тип Matter<select value={device.type} onChange={e => changeType(e.target.value as MatterDeviceType)}>{Object.values(deviceTemplates).map(item => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label>
            <label>Название<input maxLength={32} value={device.name} onChange={e => setDevice({ ...device, name: e.target.value })} placeholder="Свет в гостиной" /></label>
            <label>Помещение<input maxLength={32} value={device.room ?? ""} onChange={e => setDevice({ ...device, room: e.target.value })} placeholder="Гостиная" /></label></div>
        </div></section>
        <section className="form-section"><div className="section-number">2</div><div className="section-content"><h3>Отслеживаемые атрибуты</h3><p className="muted">Каждый атрибут получает собственный state topic и, если он управляемый, command topic.</p>
          <datalist id="mqtt-topics">{topicNames.map(topic => <option key={topic} value={topic} />)}</datalist>
          <div className="bindings">{template.attributes.map(definition => {
            const binding = device.attributes[definition.key];
            return <div className={`binding ${binding ? "enabled" : ""}`} key={definition.key}>
              <div className="binding-title"><span><strong>{definition.label}</strong><small>{definition.required ? "Обязательный" : "Опциональный"} · {definition.writable ? "чтение и управление" : "только чтение"}</small></span>
                {!definition.required && <label className="switch"><input type="checkbox" checked={Boolean(binding)} onChange={e => toggleAttribute(definition, e.target.checked)} /><span /></label>}</div>
              {binding && <BindingFields definition={definition} binding={binding} topics={topics} onChange={patch => updateBinding(definition.key, patch)} />}
            </div>;
          })}</div>
        </div></section>
        <section className="form-section"><div className="section-number">3</div><div className="section-content"><h3>Предпросмотр endpoint</h3>
          <div className="endpoint-preview"><span className="mono">{initial.endpointId ?? "новый ID после применения"}</span><span>{deviceTemplates[device.type].label}</span>
            {initial.id && initial.type !== device.type && <strong>Endpoint {initial.endpointId} будет удалён, затем будет создан новый endpoint.</strong>}
            {(!initial.id || initial.type === device.type) && <small>{initial.id ? "Имя и MQTT bindings сохраняют endpoint ID." : "Endpoint ID будет назначен при проверке черновика."}</small>}
          </div>
        </div></section>
      </div>
      <footer><button className="button ghost" onClick={onCancel}>Отмена</button><button className="button primary" disabled={busy || !device.name.trim()} onClick={() => onSave(device)}>Сохранить в черновик</button></footer>
    </section>
  </div>;
}

function BindingFields({ definition, binding, topics, onChange }: { definition: AttributeDefinition; binding: AttributeBinding; topics: MqttTopicInfo[]; onChange(patch: Partial<AttributeBinding>): void }) {
  const converter = binding.converter ?? {};
  const topic = topics.find(item => item.topic === binding.stateTopic);
  const updateConverter = (patch: Record<string, unknown>) => onChange({ converter: { ...converter, ...patch } });
  const stateChanged = (stateTopic: string) => onChange({ stateTopic, commandTopic: definition.writable && (!binding.commandTopic || binding.commandTopic === `${binding.stateTopic}/on`) ? `${stateTopic}/on` : binding.commandTopic });
  return <div className="binding-fields">
    <label>State topic<input list="mqtt-topics" value={binding.stateTopic} onChange={e => stateChanged(e.target.value)} placeholder="/devices/.../controls/..." /></label>
    {definition.writable && <label>Command topic<input list="mqtt-topics" value={binding.commandTopic ?? ""} onChange={e => onChange({ commandTopic: e.target.value })} placeholder="/devices/.../controls/.../on" /></label>}
    {topic && <div className="topic-hint"><code>{topic.value ?? "нет значения"}</code><span>{isReadonly(topic) ? "readonly" : "writable"}</span><span>{topic.error ? `error: ${topic.error}` : "без ошибок"}</span><time>{topic.updatedAt ? new Date(topic.updatedAt).toLocaleString("ru") : "ещё не обновлялся"}</time><small>{JSON.stringify(topic.metadata)}</small></div>}
    <details><summary>Преобразование значения</summary><div className="converter-grid">
      {binding.valueType === "boolean" && <><label>Значение true<input value={converter.trueValue ?? "1"} onChange={e => updateConverter({ trueValue: e.target.value })} /></label><label>Значение false<input value={converter.falseValue ?? "0"} onChange={e => updateConverter({ falseValue: e.target.value })} /></label></>}
      {binding.valueType === "number" && <><label>Scale<input type="number" step="any" value={converter.scale ?? 1} onChange={e => updateConverter({ scale: Number(e.target.value) })} /></label><label>Offset<input type="number" step="any" value={converter.offset ?? 0} onChange={e => updateConverter({ offset: Number(e.target.value) })} /></label><label>Min<input type="number" step="any" value={converter.min ?? ""} onChange={e => updateConverter({ min: optionalNumber(e.target.value) })} /></label><label>Max<input type="number" step="any" value={converter.max ?? ""} onChange={e => updateConverter({ max: optionalNumber(e.target.value) })} /></label></>}
      {binding.valueType === "enum" && <label className="wide">Enum JSON<input value={JSON.stringify(converter.enum ?? {})} onChange={e => { try { updateConverter({ enum: JSON.parse(e.target.value) }); } catch { /* allow correction without replacing last valid value */ } }} /></label>}
      <label className="check"><input type="checkbox" checked={converter.invert ?? false} onChange={e => updateConverter({ invert: e.target.checked })} /> Инвертировать</label>
    </div></details>
  </div>;
}

function MqttPage({ topics, status, config }: { topics: MqttTopicInfo[]; status: any; config: any }) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => topics.filter(topic => topic.topic.toLowerCase().includes(filter.toLowerCase())), [topics, filter]);
  return <><PageHeader eyebrow="Источник данных" title="MQTT-топики" description="Каталог предназначен для выбора ссылок и не создаёт Matter-устройства автоматически." />
    <div className="stats"><Stat label="Broker" value={status?.mqtt.url ?? config?.mqtt.url ?? "—"} /><Stat label="Состояние" value={status?.mqtt.connected ? "Подключён" : "Недоступен"} good={status?.mqtt.connected} /><Stat label="Controls" value={String(topics.length)} /></div>
    <div className="panel"><div className="panel-toolbar"><input className="search" placeholder="Фильтр по MQTT-топику" value={filter} onChange={e => setFilter(e.target.value)} /></div>
      <div className="topic-list">{visible.map(topic => <div className="topic-row" key={topic.topic}><div><strong className="mono">{topic.topic}</strong><small>{String(topic.metadata.title ?? topic.metadata.type ?? "WB control")}</small></div><code>{topic.value ?? "—"}</code><span>{topic.error ? <span className="pill warn">{topic.error}</span> : <span className="pill ok">OK</span>}</span><time>{topic.updatedAt ? new Date(topic.updatedAt).toLocaleTimeString("ru") : "—"}</time></div>)}</div>
    </div></>;
}

function CommissioningPage({ data, onOpen, onReset }: { data: any; onOpen(): void; onReset(): void }) {
  const [qr, setQr] = useState("");
  useEffect(() => { if (data?.qrPairingCode) void QRCode.toDataURL(data.qrPairingCode, { width: 260, margin: 1 }).then(setQr); }, [data?.qrPairingCode]);
  return <><PageHeader eyebrow="Matter fabric" title="Подключение Matter" description="Добавьте bridge по Ethernet/mDNS в Apple Home, Google Home или Home Assistant." />
    <div className="commissioning-grid"><section className="panel pairing-card"><div className={`big-status ${data?.commissioned ? "connected" : ""}`}>{data?.commissioned ? "✓" : "◇"}</div><h2>{data?.commissioned ? "Bridge подключён" : "Готов к подключению"}</h2><p>{data?.commissioned ? `Активных fabrics: ${data.fabrics}` : "Отсканируйте код в приложении Matter-контроллера."}</p>{qr && !data?.commissioned && <img src={qr} alt="Matter QR code" />}<strong className="manual-code">{data?.manualPairingCode ?? "Код появится после запуска Matter"}</strong></section>
      <section className="panel instructions"><h3>Как подключить</h3><ol><li>Убедитесь, что телефон и WB 8 находятся в одной локальной сети.</li><li>Откройте добавление Matter-устройства в контроллере.</li><li>Отсканируйте QR либо введите manual code.</li><li>Дождитесь появления созданных endpoints.</li></ol><button className="button ghost" onClick={onOpen}>Открыть pairing window</button><hr /><h3>Сброс fabrics</h3><p>Конфигурация устройств и endpoint registry сохранятся.</p><button className="button danger-button" onClick={onReset}>Сбросить Matter</button></section></div>
  </>;
}

function PageHeader({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: React.ReactNode }) { return <header className="page-header"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div>{children}</header>; }
function Nav({ active, icon, onClick, children }: { active: boolean; icon: string; onClick(): void; children: React.ReactNode }) { return <button className={active ? "active" : ""} onClick={onClick}><span>{icon}</span>{children}</button>; }
function StatusDot({ ok, label }: { ok: boolean; label: string }) { return <div><i className={ok ? "ok" : ""} />{label}</div>; }
function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) { return <div className="stat"><small>{label}</small><strong className={good ? "good" : ""}>{value}</strong></div>; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
function optionalNumber(value: string) { return value === "" ? undefined : Number(value); }
function iconFor(type: MatterDeviceType) { return type.includes("light") ? "☼" : type.includes("sensor") ? "◉" : type === "heating_thermostat" ? "♨" : type === "window_covering" ? "▥" : "⌁"; }
function deviceHealth(device: MatterDeviceConfig, topics: MqttTopicInfo[]) { const byName = new Map(topics.map(topic => [topic.topic, topic])); const values = Object.values(device.attributes).map(binding => byName.get(binding.stateTopic)); return values.length && values.every(topic => topic?.value !== undefined && !topic.error) ? { ok: true, label: "MQTT OK" } : { ok: false, label: "Нет данных" }; }
function isReadonly(topic: MqttTopicInfo) { return topic.metadata.readonly === true || topic.metadata.readonly === "1"; }

function defaultBinding(definition: AttributeDefinition): AttributeBinding {
  let enumMap: Record<string, string | number | boolean> | undefined;
  if (definition.key === "systemMode") enumMap = { "0": 0, "1": 4 };
  if (definition.key === "operationalStatus") enumMap = { "0": "stopped", "1": "opening", "2": "closing" };
  return {
    stateTopic: "", commandTopic: definition.writable ? "/on" : undefined, valueType: definition.valueType,
    converter: { unit: definition.defaultUnit, min: definition.min, max: definition.max, scale: 1, offset: 0, ...(enumMap ? { enum: enumMap } : {}) },
  };
}

function newDevice(type: MatterDeviceType): EditableDevice {
  const template = templateFor(type);
  return {
    name: "", room: "", type,
    attributes: Object.fromEntries(template.attributes.filter(attribute => attribute.required).map(attribute => [attribute.key, defaultBinding(attribute)])),
  };
}
