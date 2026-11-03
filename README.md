# MineSPbSO 0.2.1

Лаунчер сообщества для Windows x64. Устанавливает Minecraft Java 1.21.1, Java 21, NeoForge 21.1.256 и проверенную сборку. Кнопка «Играть» подключает к тестовому серверу с ником подтверждённого аккаунта.

Перед обновлением с 0.1.5 владелец переводит Minecraft и сервисы на [защищённый вход и синхронизацию вайт-листа](docs/PROTECTED-SERVER.md). Выпуск включает серверный JAR и установщик с клиентским модом.

Владельцу и игрокам — [запуск раздачи, установка и проверка на втором ПК](docs/TESTERS.md). Тестовый адрес Minecraft — `10.99.52.8:48905`, BlueMap — порт 8100, аккаунты и подписанный выпуск — HTTPS на порту 3443.

ChatGPT Codex and Po6uH3oH project.
## Сборка из исходников

Node.js 24 и pnpm указанной в `package.json` версии нужны разработчику, а не игроку. Из корня проекта:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm test
corepack pnpm build
node node_modules/tsx/dist/cli.mjs scripts/ui-smoke.ts
node node_modules/electron-builder/cli.js --win nsis --x64 --publish never
node scripts/verify-release.mjs
```

Если Corepack отсутствует, установите его либо pnpm версии из `packageManager`. Для запуска разработки после сборки: `corepack pnpm dev`. Настройки сервиса находятся в `.env.local`, лаунчера — в `config/launcher.local.json` (пример рядом). Установщик использует config/launcher.tester.json с публичными ключами тестовой сети, а при его отсутствии — launcher.example.json.

Итоги: [проверки и ограничения](docs/VERIFICATION.md), [план](docs/PLAN.md), [архитектура](docs/ARCHITECTURE.md).
С версии 0.2.1 сервер виден в списке Minecraft после отключения. [Обновления лаунчера, подготовка канала и проверка Defender](docs/LAUNCHER-UPDATES.md).


[Общий запуск Windows и панель аккаунтов владельца](docs/OWNER.md)
