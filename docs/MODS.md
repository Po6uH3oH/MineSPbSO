# Аудит предварительной сборки

Исходник: `research/mods-original.txt`, 183 строки, включая Minecraft, NeoForge и вложенные библиотеки. Это не 183 независимых JAR. Полная сборка пока **не одобрена**. Машиночитаемые результаты: `mod-inventory.json`, `modrinth-candidates.json`, `mod-jar-metadata.json`.

Проверены реальные JAR (SHA-256 есть в отчёте):

| Компонент | Подтверждённые метаданные | Вывод |
|---|---|---|
| Joy of Painting 2.0.1 | Minecraft `[1.21.1]`, NeoForge `[21.1.242,)` | 21.1.256 попадает в диапазон; нужен игровой тест |
| Etched 5.1.0 | Minecraft `[1.21.1]`, NeoForge `[21.1.0,)` | Метаданные допускают базу |
| Immersive Melodies 0.8.2 | Minecraft `[1.21,1.22)` | Метаданные допускают базу |
| Simple Voice Chat 2.6.27 | Minecraft `[1.21,1.21.1]`, NeoForge `[21.0.0-beta,)` | Для голоса нужен клиент и сервер; UDP отдельно |
| Emotecraft 2.4.12 | playeranimator `[2.0.0,)`; внутри player-animation 2.0.1 и bendy-lib 5.1 | Не считать вложенные библиотеки недостающими отдельными JAR |
| CustomSkinLoader 15.1 | Universal bootstrap, NeoForge locator services и вложенный Common.jar | Один `fabric.mod.json` не означает Fabric-only; только клиент |
| No Chat Restrictions 1.21.11-v1.0.3 | Minecraft `[1.21,1.21.11]`, каталог включает 1.21.1 | Номер в имени не доказывает несовместимость; только клиент |
| FTB Teams 2101.1.11 | architectury ≥13.0.8, ftblibrary ≥2101.1.30 | Изучен точный локальный JAR |
| FTB Chunks 2101.1.22 | ftblibrary ≥2101.1.34, ftbteams ≥2101.1.9 | Изучен точный локальный JAR |
| FTB Quests 2101.1.36 | ftblibrary ≥2101.1.36, ftbteams ≥2101.1.9 | Изучен точный локальный JAR |

FTB Library 2101.1.37 пока не получен. FTB-артефакты в Modrinth по исследованным slug отсутствуют; три точных JAR найдены в уже установленных локальных модпаках и прочитаны без изменения этих модпаков. Это не предоставляет право перепубликации. В FTB TOML указано All Rights Reserved: перед выпуском использовать разрешённый каталог/официальные условия, не копировать JAR на свой CDN автоматически.

BetterEnd/BetterNether по исследованным основным Modrinth-проектам не предоставили NeoForge 1.21.1 в отфильтрованном каталоге. Возможны другие порты/проекты — нельзя объявлять совместимыми или автоматически исключать до установления точного происхождения. Sodium/Iris имеют подходящие версии с иным форматом номера, первоначальный автоматический exact-match их не выбрал. LMFT требует исправленного slug `lmft` и отдельного аудита. Остальные строки остаются неподтверждёнными.

## FTB и фракции

FTB Teams намеренно используется FTB Chunks и FTB Quests для командных прав/прогресса: https://github.com/FTBTeam/FTB-Teams . Одна команда на цвет объединила бы эти состояния. Поэтому фракции сохраняются в accounts, а мод добавляет серверный цветной префикс в имя/Tab, не вызывает FTB API и не меняет команды/приваты. Проверка с двумя настоящими игроками ещё обязательна.

## Данные пользователей

Обновление меняет только управляемый каталог `game/mods` и создаёт отсутствующие `config/*`; все прочие каталоги сохраняются независимо от имени. Первичная конфигурация CustomSkinLoader создаётся отдельно, существующий несовпадающий источник не перезаписывается.

Исследованы фактические классы скачанных версий через `javap`:

| Данные | Расположение / правило |
|---|---|
| Joy of Painting экспорт | `paintings/` относительно game directory (`CommandExport.doExport`) |
| Immersive Melodies сервер | каталог измерения `data/melodies/`; SavedData `immersive_melodies` и `immersive_melodies_settings` (`ServerMelodyManager`) |
| Etched cache | `game/etched-sounds/`, в том числе `cache.json` (`SoundCache`); мод также создаёт системные временные файлы |
| Emotecraft экспорт | `game/emotes/` (`ExportMenu`); сохранить весь каталог и конфигурации |
| Voice Chat записи | `voicechat_recordings/`, путь настраивается клиентом (`AudioRecorder`/`ClientConfig`) |
| CustomSkinLoader | `game/CustomSkinLoader/`, включая LocalSkin и cache; это отдельный каталог от config |
| Vanilla / прочие моды | весь `game/` кроме управляемых mods: options.txt, screenshots, saves, resourcepacks, maps, config и неизвестные каталоги сохраняются |

Для сервера резервировать целиком мир со всеми измерениями, playerdata, данными FTB и `community-kit-claims`, а также config/defaultconfigs. Точный список всех дополнительных модовых хранилищ ещё не подтверждён, поэтому backup только «известных файлов» неприемлем.

## Скины

По исходникам CustomSkinAPI ветки 15-develop проверены `root + username + '.json'`, `textures.default/slim` и `root + 'textures/' + hash`. Сервис отдаёт этот протокол, повторно кодирует проверенный PNG, сохраняет неизменяемые texture URL. Без скина ответ пустой — fallback на стандартный скин Minecraft. Профиль `no-store`, текстуры immutable. CSL имеет собственный HTTP-кеш (в изученном коде 90 секунд), поэтому мгновенную смену во всех открытых клиентах не обещаем; контрольный сценарий — переподключение/перезапуск после истечения кеша. Отображение у двух игроков ещё не проверено.

Источники: https://github.com/xfl03/MCCustomSkinLoader/tree/15-develop/Common/src/main/java/customskinloader ; https://dev.modrepo.de/minecraft/voicechat/wiki/server_config ; точные project/version URL, licenses, SHA-512 и SHA-256 в JSON-отчёте. Скачанные чужие JAR остаются в игнорируемой `.local`, не включены в установщик.
