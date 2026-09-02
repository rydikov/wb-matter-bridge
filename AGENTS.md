# AGENTS.md — контекст проекта WB Matter Bridge

Этот файл — основной контекст для агентов, работающих с репозиторием. Перед изменениями сверяйтесь с описанными здесь решениями и инвариантами.

## Назначение

`wb-matter-bridge` — локальный Matter Bridge для Wiren Board 8. Пользователь вручную создаёт Matter-устройства в русскоязычном Web UI и связывает их атрибуты с MQTT controls Wiren Board.

MQTT discovery используется только как каталог `/devices/#` и подсказка для выбора топиков. Обнаруженный MQTT control никогда не должен автоматически создавать Matter endpoint.

## Технологии и целевая среда

- Node.js 24 LTS, TypeScript, ESM.
- `matter.js` (`@matter/main`, `@matter/nodejs`) для bridge node и endpoints.
- `mqtt` для MQTT 3.1.1/5 клиента.
- Fastify для REST, SSE и production static UI.
- React + Vite для UI.
- Ajv и общая JSON Schema для backend/frontend.
- Vitest для тестов.
- Цель: Wiren Board 8, `linux/arm64`, Docker, `network_mode: host`.
- Matter работает по Ethernet/mDNS, без BLE; UDP-порт Matter — `5540`.
- Production Web UI и API работают на `8787`.
- Vite development UI работает на `5173` и проксирует только `/api/v1` на `127.0.0.1:8787`. Не расширять proxy до `/api`: это перехватит frontend-модуль `/api.ts`.
- `npm run dev` явно разрешает Origin `http://localhost:5173` и `http://127.0.0.1:5173` через `WB_ALLOWED_ORIGINS`; production по умолчанию остаётся строго same-origin.
- MQTT broker по умолчанию — `mqtt://wb.local:1883`.

## Команды

```sh
npm install

# Терминал 1: backend/API/Matter на 8787, данные в ./data
npm run dev

# Терминал 2: Vite UI на 5173
npm run dev:web

npm run typecheck
npm test
npm run build
npm start
docker compose config --quiet
```

Production `npm start` ожидает собранный `dist/`. Docker использует Node 24 и непривилегированного пользователя `node`.

## Важные файлы

- `src/shared/types.ts` — общая модель конфигурации, devices, bindings, registry и API DTO.
- `src/shared/deviceTemplates.ts` — разрешённые формы устройств и атрибутов.
- `src/shared/configSchema.ts` — JSON Schema конфигурации.
- `src/server/validation.ts` — семантическая валидация форм и MQTT bindings.
- `src/server/configStore.ts` — `/data/config.json`, runtime registry и атомарная запись отдельных файлов.
- `src/server/draftManager.ts` — draft CRUD, ревизии, diff и endpoint allocation.
- `src/server/mqttService.ts` — MQTT connection, WB topic catalog, metadata и команды.
- `src/server/matterService.ts` — динамические Matter endpoints и MQTT↔Matter синхронизация.
- `src/server/matterBootstrap.ts` — конфигурация Node.js adapter до загрузки Matter API. Здесь `@matter/main` должен импортироваться динамически только после установки `defaultStoragePath`; статический импорт приводит к `NodeJsAlreadyInitializedError`.
- `src/server/api.ts` — Fastify REST/SSE и static UI.
- `src/web/App.tsx` — русскоязычный UI.
- `examples/config.json` — начальная конфигурация для Docker.
- `scripts/create-smoke-data.mjs` — генерация runtime-smoke конфигурации со всеми формами.

## Модель конфигурации и хранение

Применённая конфигурация хранится в `/data/config.json`:

- `mqtt` — connection settings; редактируются только через JSON и отображаются в UI read-only;
- `bridge` — имя, Matter port, UI port и listen address;
- `devices[]` — только явно созданные пользователем устройства;
- `revision` — ревизия применённой конфигурации.

Matter runtime хранится отдельно:

- `/data/runtime/endpoint-registry.json` — назначения endpoint IDs, следующий ID и tombstones;
- `/data/runtime/matter/` — node identity, ключи, fabrics и commissioning state.

Монтировать нужно весь `/data`, а не один JSON-файл. Пароль MQTT хранится в `config.json`, но API маскирует его.

Каждое устройство содержит постоянный UUID `id`, `endpointId`, имя, помещение, фиксированный Matter `type` и типизированные `attributes`.

Каждый binding содержит:

- обязательный точный `stateTopic` без `#` и `+`;
- обязательный `commandTopic` для writable-атрибутов, отсутствующий для read-only;
- `valueType`: `boolean`, `number`, `enum` или `rgb`;
- опциональные `invert`, `scale`, `offset`, `min`, `max`, `unit`, boolean values и enum map.

## Неприкосновенные инварианты

1. Matter-состояние изменяется только после сообщения в `stateTopic`.
2. Matter-команда публикуется в MQTT с QoS 1 и `retain=false`.
3. Отправка команды сама по себе не подтверждает и не сохраняет новое состояние. До MQTT state confirmation Matter возвращается к последнему подтверждённому значению.
4. При смене `stateTopic` очищаются `seen`, confirmed value и binding error; endpoint становится unreachable до данных из нового топика.
5. Retained MQTT values должны применяться даже если пришли до регистрации Matter bindings. Для этого используется hydration из topic catalog.
6. Потеря MQTT оставляет endpoints в Matter, но выставляет `reachable=false`.
7. Редактирование имени, помещения и bindings сохраняет endpoint ID.
8. Смена Matter-типа tombstone-ит старый endpoint и назначает новый.
9. Удалённые и заменённые endpoint IDs никогда не переиспользуются.
10. Environment sensor резервирует parent endpoint и два постоянных child endpoints.
11. CRUD изменяет только серверный draft. Matter и `/data/config.json` меняются только через `/config/apply` после полной валидации.
12. `draftRevision` защищает от параллельного редактирования draft, `configRevision` — от перезаписи уже применённой конфигурации другой вкладкой.
13. Произвольные Matter clusters и attributes в v1 запрещены.
14. Не передавать внутренний UUID напрямую в Matter `SerialNumber`/`UniqueId`: UUID длиной 36 превышает лимит 32. Serial генерируется `matterSerialNumber()`, а UniqueId генерирует и сохраняет matter.js.

## Поддерживаемые формы Matter

- `on_off_light`: обязательный writable `onOff`.
- `dimmable_light`: `onOff`, `level` 0–100.
- `extended_color_light`: `onOff`, `level` и хотя бы один из `rgb` или `colorTemperature`; WB RGB имеет формат `R;G;B`.
- `on_off_outlet`: writable `onOff`.
- `temperature_sensor`: read-only `temperature`.
- `humidity_sensor`: read-only `humidity` 0–100.
- `occupancy_sensor`: read-only `occupancy`.
- `contact_sensor`: read-only `contact`.
- `environment_sensor`: parent Bridged Node с отдельными Temperature и Humidity child endpoints.
- `heating_thermostat`: `localTemperature`, writable `heatingSetpoint`, writable Off/Heat `systemMode`, опциональный `heatingActive`.
- `window_covering`: `currentPosition`, writable `targetPosition`, опциональный `operationalStatus`; числовая инверсия реализуется через min/max.

Формы и диапазоны определяются только в `deviceTemplates.ts`; при добавлении типа одновременно обновлять templates, schema/types, validation, Matter endpoint factory, state mapping, command observers, UI icon/labels и тесты.

## MQTT conventions Wiren Board

- Подписка: `/devices/#`.
- Каталог нормализует controls до `/devices/<device>/controls/<control>`.
- Поддерживаются современный JSON `<control>/meta` и старые `<control>/meta/*`.
- Из metadata сохраняются как минимум raw fields, `readonly`, `error`, title/type.
- Ошибки `r`, `w`, `p` делают соответствующий binding ошибочным/unreachable; пустой error очищает ошибку.
- Топики `<control>/on` не добавляются как отдельные controls каталога.
- UI показывает raw value, metadata, readonly/error и время последнего обновления.

## REST/SSE API

Префикс: `/api/v1`.

- `GET /devices`
- `POST /devices`
- `PUT /devices/:id`
- `DELETE /devices/:id`
- `GET /mqtt/topics`
- `POST /config/validate`
- `POST /config/apply`
- `POST /config/discard`
- `GET /status`
- `GET /health`
- `GET /events`
- `GET /matter/commissioning`
- `POST /matter/commissioning/open`
- `POST /matter/reset`
- `GET /schema/config`
- `GET /device-types`

UI работает без встроенной авторизации только в доверенной локальной сети. CORS не включать. Mutation requests проверяют same-host Origin; сохранять CSP и остальные security headers.

## Commissioning

- Первый fabric получает QR/manual code от persisted Matter node.
- Matter identity и fabrics переживают рестарт благодаря `/data/runtime/matter`.
- Factory reset удаляет fabrics, но не devices и endpoint registry.
- Для уже commissioned node дополнительный fabric открывает commissioning window через существующий Matter-контроллер. Локальный HTTP API не должен обходить fabric-authenticated Administrator Commissioning.
- Используется тестовый Vendor ID; формальная Matter-сертификация не заявляется.

## UI-решения

- Интерфейс русскоязычный.
- Главная страница показывает только явно созданные devices, endpoint, число attributes, MQTT/Matter status и edit/delete.
- Editor строится из выбранного template и предлагает `<stateTopic>/on` для writable binding.
- State topic можно ввести вручную или выбрать через datalist из каталога.
- При смене типа preview явно сообщает об удалении старого и создании нового endpoint.
- Apply сначала показывает точный endpoint diff и требует подтверждения.
- Удаление сначала попадает в draft и требует второго подтверждения при apply.

## Проверки перед завершением изменений

Минимум:

```sh
npm run typecheck
npm test
npm run build
docker compose config --quiet
```

Сейчас имеются unit-тесты converters, RGB/CCT, validation, draft/endpoint registry/config diff и WB MQTT metadata. Runtime smoke ранее успешно создавал все 11 типов и endpoints 2–14, включая environment children.

При изменении Matter-модели дополнительно запускать `scripts/create-smoke-data.mjs` и стартовать собранный backend с отдельным временным `WB_MATTER_DATA`/`WB_MATTER_STORAGE_PATH`.

## Известные ограничения и незавершённая внешняя проверка

- Полный integration test с отдельным Mosquitto ещё не автоматизирован.
- Matter controller tests чтения, команд и subscriptions ещё не автоматизированы.
- Ручные проверки Apple Home, Google Home и Home Assistant должны выполняться в реальной локальной сети WB; Alexa — best effort.
- Dockerfile и Compose валидны, но локальная полная Docker-сборка ранее была остановлена из-за зависания доступа BuildKit к npm registry. Не трактовать это как ошибку TypeScript-сборки: локальные typecheck/test/build проходят.
- Проект v1 предназначен для локального использования без формальной Matter-сертификации.

## Правила внесения изменений

- Не добавлять autodiscovery → auto-create.
- Не менять endpoint IDs механически и не очищать tombstones.
- Не делать optimistic Matter state update после команды.
- Не переносить MQTT-настройки в UI-редактор без отдельного решения по безопасности.
- Не добавлять встроенную авторизацию частично: текущая модель — доверенная LAN; изменение требует отдельного threat/security design.
- Не коммитить `data/`, `dist/`, `node_modules/`, ключи, fabrics, сертификаты или MQTT credentials.
- Любое изменение общей модели должно оставаться типизированным и проходить backend validation до apply.
