<p align="center">
  <img src="apps/web/public/icons/blockcolc-512.png" width="128" height="128" alt="Blockcolc icon">
</p>

# Blockcolc / 方块钟

[简体中文](README.md) · [English](README.en.md)

Blockcolc is a local-first focus timer that turns time spent into a block-built world.
Report progress on subtasks to build a project, or complete focus rounds to grow a habit.

## Features

- Single and multi-round focus, end-time plans and a minimal clock, sharing one timer and immersive interface.
- Multiple projects, daily goals, optional automatic continuation, focus integrity protection and system notifications.
- Daily timelines, a heatmap, task time allocation, completed buildings, subtask breakdowns and local achievements.
- JSON export and restore, automatic merged backups and separate rollback points for destructive operations.
- Litematic import, interactive previews and a unified blueprint library. Minecraft Java Edition 26.3 resource packs support models,
  textures, tinting, animation and supported static special blocks; unsupported content has explicit fallbacks.
- Valley, floating island, ocean island and Mosaic Coast environments, with day/night lighting, weather and scenery.
- Deterministic local weather by default; optional real weather falls back without blocking offline focus.
- Simplified Chinese / English, pixel / system fonts, optional quick notes and recorded nature sounds.

The core needs no account or server. Android is the primary platform; the Web app shares its React interface and business logic.
Public builds do not contain the private friend-server synchronization module.

## Install and run

Download Android packages from [Releases](https://github.com/Dieight/blockcolc/releases).
Local development requires Node.js 20.19 or newer; Android builds also require JDK 21 and the Android SDK.

```powershell
npm install
npm run dev -w @blockcolc/web
```

Build the Web app with `npm run build -w @blockcolc/web`.
For Android debugging, run `npm run android:sync -w @blockcolc/android`, then
`npm run android:assemble -w @blockcolc/android`.
See the [verification and delivery policy](docs/TESTING.md) for signed builds; debug APKs are not release candidates.

Change the app language in **Settings → App language**. The two choices always read **简体中文 / English**.
Language and font changes apply immediately; your project names, imported blueprint names and notes are not translated.

## Data and attribution

Projects and imported resources stay on the device by default. Public builds do not upload tasks or statistics.
Enabling real weather requests location and weather as described in Settings, without uploading task content.
Imported content is validated locally. Supported block entities are shown statically; Blockcolc does not simulate Minecraft gameplay.

Minecraft is a trademark of Mojang Studios. This project is not affiliated with Mojang Studios or Microsoft and does not bundle
unauthorized original Minecraft textures, fonts, sounds or models. Existing backup formats and database identifiers remain
compatible across the project rename.

## Technology and sources

The project source is licensed under [Apache-2.0](LICENSE). Dependencies retain their own licenses.

| Technology | Use | Upstream |
| --- | --- | --- |
| TypeScript, React | Shared business logic and Android/Web interface | [TypeScript](https://github.com/microsoft/TypeScript), [React](https://github.com/facebook/react) |
| Three.js / WebGL | Block world, instancing, lighting and weather | [Three.js](https://github.com/mrdoob/three.js) |
| Capacitor, Java | Android host, notifications, lifecycle, location, audio and files | [Capacitor](https://github.com/ionic-team/capacitor), [Android](https://developer.android.com/) |
| IndexedDB | Local tasks, resources and recovery snapshots | [MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) |
| SunCalc 2.0.2 | Solar/lunar positions, moon phase and illuminated-limb angle | [SunCalc](https://github.com/mourner/suncalc), [BSD-2-Clause license](apps/web/public/licenses/suncalc.txt) |
| lunar-typescript 1.8.6 | Offline lunar-calendar holiday dates | [lunar-typescript](https://github.com/6tail/lunar-typescript), [MIT license](apps/web/public/licenses/lunar-typescript/LICENSE.txt) |
| fflate | Local ZIP/GZIP decoding for resource packs and Litematic | [fflate](https://github.com/101arrowz/fflate) |
| Lucide | Interface icons | [Lucide](https://github.com/lucide-icons/lucide) |
| Vite, Vitest, Playwright | Building, unit tests and browser interaction tests | [Vite](https://github.com/vitejs/vite), [Vitest](https://github.com/vitest-dev/vitest), [Playwright](https://github.com/microsoft/playwright) |

Optional real weather uses the [QWeather API](https://dev.qweather.com/en/docs/).
World generation is implemented in this project, with Minecraft block forms and environments as references; it is not the Minecraft generator.
Imported packs and blueprints remain subject to their authors' licenses.
See [design sources](docs/assets/design-sources.md), [supplemental blueprints](docs/assets/local-blueprints.md) and
[recorded audio sources and processing](docs/assets/ambient-audio.md).
SunCalc's copyright notice and full license ship with the app and have their own About link; they are separate from Blockcolc's license.

## Project documents

- [Product behavior](BLOCKCOLC.md)
- [Current work](docs/TODO.md)
- [Architecture](ARCHITECTURE.md) and [design](DESIGN.md)
- [Verification and delivery](docs/TESTING.md)
- [Workspace maintenance](docs/WORKSPACE-MAINTENANCE.md)
- [Version records](docs/versions/README.md)

Some internal documents follow the existing local Git exclusions. If a checkout does not include them,
use the AGENTS, product files, test tools and version records distributed with that checkout.
