# WB Matter Bridge

Matter Bridge для Wiren Board 8. Устройства создаются вручную в web-интерфейсе, а каждый Matter-атрибут связывается со своим MQTT state topic и, при необходимости, command topic.

MQTT discovery служит только каталогом: наличие control в `/devices/#` не создаёт endpoint автоматически.

## Запуск на Wiren Board 8

Требуются Docker и Compose. Matter использует IPv6, multicast DNS и UDP, поэтому контейнер запускается в host network без BLE и без privileged-режима.

```sh
mkdir -p data
cp examples/config.json data/config.json
chown -R 1000:1000 data
docker compose up -d --build
```

Откройте `http://<адрес-WB>:8787`. Для первой настройки Matter перейдите в «Подключение Matter» и отсканируйте QR-код в Apple Home, Google Home или Home Assistant.

Сервис создаёт в примонтированном каталоге:

- `data/config.json` — настройки MQTT, ревизия и применённые устройства;
- `data/runtime/endpoint-registry.json` — постоянные endpoint ID и tombstones;
- `data/runtime/matter/` — Matter fabrics, ключи и commissioning state.

Не монтируйте только `config.json`: атомарное сохранение требует доступа на запись ко всему каталогу `data`.

## Модель binding

Пример управляемого атрибута:

```json
{
  "stateTopic": "/devices/wb-mr6c_1/controls/K1",
  "commandTopic": "/devices/wb-mr6c_1/controls/K1/on",
  "valueType": "boolean",
  "converter": {
    "trueValue": "1",
    "falseValue": "0",
    "invert": false
  }
}
```

Команда Matter публикуется с QoS 1 и `retain=false`. Атрибут считается подтверждённым только после сообщения в `stateTopic`.

Поддерживаются on/off, dimmable и RGB/CCT lights, outlet/relay, temperature/humidity/occupancy/contact sensors, composed environment sensor, heating thermostat и window covering.

## Конфигурация MQTT

Параметры broker редактируются только в `data/config.json` и применяются после перезапуска контейнера:

```json
{
  "url": "mqtts://broker.example:8883",
  "clientId": "wb-matter-bridge",
  "username": "bridge",
  "password": "secret",
  "caFile": "/data/certs/ca.pem",
  "certFile": "/data/certs/client.pem",
  "keyFile": "/data/certs/client.key",
  "rejectUnauthorized": true
}
```

UI не возвращает пароль через API. Ограничьте права `config.json`, так как пароль хранится в нём без шифрования.

## Разработка

```sh
npm install
# Терминал 1: API и Matter на 8787
npm run dev
# Терминал 2: Vite UI на 5173 с proxy к API
npm run dev:web
```

В development-режиме UI открывается на `http://localhost:5173`, а production UI и API — на `8787`. Команда `npm run dev` использует локальный каталог `./data`.

Проверки:

```sh
npm run typecheck
npm test
npm run build
```

REST API имеет префикс `/api/v1`. Основные endpoints: `/devices`, `/mqtt/topics`, `/config/validate`, `/config/apply`, `/matter/commissioning`, `/events`. JSON Schema доступна по `/api/v1/schema/config`, формы типов — по `/api/v1/device-types`.

## Ограничения v1

- Целевая платформа — WB 8 (`linux/arm64`).
- UI рассчитан на доверенную локальную сеть и не имеет встроенной авторизации.
- Используется тестовый Matter Vendor ID; продукт не сертифицирован CSA.
- После commissioning второй fabric следует добавлять через уже подключённый Matter-контроллер.
