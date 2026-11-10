# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Windows companion map tool for the game Aniimo's "搶蛋大作戰" (Grab Eggs) mode: a Rust + Tauri 2 desktop app (Windows x64 only) that shows dungeon maps with chest/egg/boss markers, recognizes the current map from screen capture, tracks the player, and draws a transparent overlay on top of the game. There is also an offline static viewer and a separate native Android app (`mobile/android`, Java, its own version numbering).

READMEs and `docs/` are written in Traditional Chinese. `README.md` is the player guide, `app/README.md` is the developer build/release guide, and `docs/*.md` hold per-feature design and verification notes, usually titled with the version that introduced the feature. Many of them record the real tests that were run.

## Commands

Run everything from the repo root in PowerShell. Python is always invoked through `.venv` with `-X utf8`, because the repo path and the output are non-ASCII.

```powershell
# One-time setup
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Full local build: stage frontend -> cargo build --release --locked -> optional signing -> dist/AniimoDungeonMap-<ver>-windows-x64-portable/
.\scripts\build_portable.ps1          # add -Zip ONLY when a ZIP is explicitly wanted

# Stage only the generated frontend (app/frontend) without compiling Rust
.\.venv\Scripts\python.exe -X utf8 scripts\prepare_portable.py

# Rebuild the offline viewer at exports/grab-eggs-data/ (data.js + copies of scripts/data_viewer/*)
.\.venv\Scripts\python.exe -X utf8 scripts\build_viewer.py
```

Tests:

```powershell
node --test scripts/tests/*.test.cjs                      # JS unit tests (Node 24 built-in runner, no npm)
node --test scripts/tests/manual-map.test.cjs             # one file
node --test --test-name-pattern "rebuilt 20031" scripts/tests/manual-map.test.cjs   # one test

.\.venv\Scripts\python.exe -X utf8 scripts\tests\routes.test.py   # Python tests are unittest files, run directly
# also: chest-policy.test.py, loot-capacity.test.py, release-integrity.test.py

cd app\src-tauri; cargo test --release --locked            # Rust unit tests (#[cfg(test)] in most modules)
```

Native and end-to-end tests run against a **built EXE**. Opening `app/frontend/index.html` by itself does not exercise IPC, the overlay window, or native capture.
- `node scripts/tests/<name>-native.cjs [EXE]` and `release-smoke.cjs`. The EXE argument defaults to `dist/AniimoDungeonMap-<version>-windows-x64-portable/AniimoDungeonMap.exe`. These scripts launch the EXE with `--hidden`, point `ANIIMO_TEST_DATA_DIR` at a temp profile, and connect over CDP through `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. Both overrides only take effect together with `--hidden` (see `main.rs`). They never touch the user's real settings or the game. Results are written under `dist/`.
- `scripts/tests/*-browser.js` files are snippets you pipe into `agent-browser eval --stdin` on a page that is already open. The header comment of each file names the page it expects.
- `recognition-lock-native.cjs <EXE> <report>` is the recognition regression. It uses the fixture images in `exports/recognition-fixtures/`.
- Without agent-browser, `scripts/build_fog_references.cjs` shows the pattern for running a browser snippet headless: it serves the repo on 127.0.0.1 and drives Edge/Chrome over CDP.

Release and mobile:
- `.\scripts\build_release.ps1` requires `ANIIMO_SIGNING_THUMBPRINT` or `-AllowUnsignedRelease`. It runs a Defender scan and `package_release.py`, and outputs `dist/github-release-v<ver>/`.
- A version bump must change `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`, **and** the root package entry in `app/src-tauri/Cargo.lock`. The build uses `--locked`, so it fails if the lock file is out of date.
- `.\scripts\build_mobile.ps1 [-SdkPath ...]` builds the Android app. It needs Android SDK 36 and an ASCII `-BuildRoot`. Gradle test workers break on this repo's Unicode path, so output defaults to `%LOCALAPPDATA%\AniimoDungeonMap\android-build`.

## Architecture

### Data pipeline: game files → `exports/` → generated frontend

1. **Extraction (needs the game installed; read-only).** `extract_*.py`, `parse_dungeon_data.py`, `pmdata.py` (a decoder for the game's pooled data tables) and `luajit_constants.py` read the game installation using UnityPy. The game now lives at `F:\Pawprint\Aniimo\game` (newest manifests and Lua patches under `Aniimo_Data\cvs\res\...\patchv2`); older scripts such as `extract_maps.py` and `pmdata.DEFAULT_ARCHIVE` still default to the former `F:\Steam\steamapps\common\Aniimo` path, so pass the new path explicitly. These scripts never write to the game. Resource version provenance is recorded in `exports/grab-eggs-data/source.json` and `exports/pvp-map/map.json`.
2. **Audited exports (committed).** `exports/grab-eggs-data/` holds map JSON, the map pool, marker icons, difficulty and display policy. `exports/grab-eggs-dungeons/preview/` holds the map images and `exports/pvp-map/` the PvP data. `app/loot-ranking.json`, `app/loot-icons/` and `app/fog-references.json` are committed snapshots as well.
   **Initial-fog views are synthesized, not captured** (`docs/迷霧合成.md`): `extract_map_fog.py` (game, read-only) exports the M-map fog texture and fog grid to `exports/map-fog/`; `calibrate_fog_view.py` measured the shared screen layers once from the real captures; `build_fog_views.py --fixtures` renders `exports/recognition-fixtures/synthetic-<ID>-initial.png` for every pool map (needs numpy). `app/fog-references.json` is rebuilt from those views with `prepare_portable.py` → `node scripts/build_fog_references.cjs` → `package_fog_references.py`. Do not ask the user for in-game screenshots to add a dungeon's fog reference.
3. **Build (no game access).** `prepare_portable.py` deletes `app/frontend/` and regenerates it (that directory is gitignored), along with `app/asset-manifest.json`. Tauri embeds `app/frontend` into the EXE (`frontendDist: "../frontend"`). `prepare_mobile.py` does the same job for the Android assets.

`prepare_portable.py` has several properties to keep in mind when editing the frontend:
- **The HTML is assembled with string `.replace()`.** `scripts/data_viewer/index.html` is the base page shared with the offline viewer. The script splices in `app/help.html`, `manual-map.html`, `recognition.html` and `update.html`, extra buttons, and `<script>` tags, and derives both `index.html` (main window) and `overlay.html` from it. If you change markup that one of those replace calls matches (for example `<div class="tools">`, `<aside>`, or the `<script src="...">` sequences), the replacement no-ops silently. Check the generated `app/frontend/*.html` after any change like that.
- **Files reach the frontend only through explicit whitelists.** A new `app/*.js` or `.css` file must be added to the copy list in `prepare_portable.py`, to the script tags it injects, and, for worker dependencies, to `importScripts` in `recognition-worker.js` or `tracking-worker.js`.
- **`build_routes.py`, `build_i18n.py`, `build_loot_ranking.py` and `build_shop_advice.py` are build-time validators as well as generators.** They assert data invariants and fail the build when one breaks.

### Desktop runtime

**Two webview windows.** `main` loads `index.html` and `map-overlay` loads `overlay.html`. Both run the same `scripts/data_viewer/viewer.js` canvas renderer, which reads the generated `window.DUNGEON_DATA`. `viewer.js` exposes `window.getGameMode`, `getPveMap`, `getRouteSnapshot` and similar hooks.
- The main window adds `desktop.js`, `tracking.js`, `recognition.js` and `update.js`, and it owns all capture, recognition and tracking.
- The overlay loads `overlay.js` instead and only renders.
- Main pushes state to the overlay with Tauri events (`map-view-state` and `map-overlay-size-request`). The overlay sends `map-overlay-*` events back to main. The overlay asks main to apply a manual map choice and waits for the result.

**Rust backend (`app/src-tauri/src`).**
- `main.rs` registers the commands. It also pins the WebView2 profile to `%LOCALAPPDATA%\local.aniimo.dungeonmap\WebView2`, so settings survive version updates and moving the EXE.
- `profile.rs` performs a one-time import of localStorage from older portable folders.
- `capture.rs` captures only the Unity surface of `Aniimo.exe` through `windows-capture`, with no memory reads and no input injection. Requests for frames come from JS (`capture_frame`).
- `overlay.rs` keeps the overlay window following the game window and registers the global **F1** hotkey that hides it.
- `updater.rs` checks GitHub Releases. There is no installer; users replace the EXE themselves.
- The CSP in `tauri.conf.json` forbids inline scripts and allows `wasm-unsafe-eval` for OpenCV.js (`app/vendor/opencv.js`, version pinned in `vendor/source.json`).

**Map recognition.** `recognition.js` is the main-thread controller. It sends frames to `recognition-worker.js`, which loads OpenCV plus the `recognition-*.js` modules.
- ORB features are matched against references for the 12 PvE maps. `recognition-search.js` defines the search priority.
- `recognition-portals.js` detects door icons, `recognition-fog.js` compares against the initial-fog references, and `recognition-screen.js` handles screen and minimap geometry.
- Fast path (0.2.51, `docs/辨識加速.md`): the entrance→exit door vector, normalized by UI scale, identifies the dungeon (pool vectors are ≥103 px apart at 1080p; a unit test enforces the margin). In the initial view the player's arrow hides the front door, so each map's vector is applied from the side door instead and only predictions landing in revealed terrain are kept. One small ORB window around the start room is then matched to that map's fog reference. Full-frame ORB and `MapSearch` run only when this fails; sparse (initial) frames skip the exhaustive search. The worker reports ready before loading full-map references, which load in the background after 8 s idle.
- `recognition-core.js` `Evidence` separates a *preview* (the current top candidate, which can still change) from a *lock*. A lock requires terrain plus portal confirmation, and once set it cannot be overridden by later or higher-scoring candidates.
- The worker is released after a lock.
- Manual selection lives in `manual-map-core.js` (pure logic: groups maps into 8 directions by the entrance→exit vector, ±8° tolerance) and `manual-map.js` (UI shared by main and overlay).

**Player tracking.** `tracking.js` owns native capture for both features. It works with `tracking-worker.js`, `tracking-core.js` and `tracking-flow.js` (Lucas–Kanade optical flow between frames that already matched the base map). Tracking does not model floors, and it deliberately does not extrapolate the player position during occlusion.

**Pure modules shared with Node.** `recognition-core`, `-fog`, `-portals`, `-screen` and `-search`, `manual-map-core`, `tracking-core` and `tracking-flow` follow the pattern `if (module.exports) … else root.X = api`. Browser code and `*.test.cjs` tests import the same files, so keep logic you want to unit-test in these modules, free of DOM and Tauri dependencies.

**Code style.** There is no bundler, transpiler, npm or linter. Scripts are plain IIFEs that begin with `'use strict'`, many written in a dense near-minified style. Follow the style of whichever file you edit.

### i18n and settings

- `app/locales/<lang>.json` contains 13 languages; `bindings.json` maps static DOM text to keys. `build_i18n.py` requires every locale to have the same keys and parameters, so a new UI string must be added to all 13 files or the build fails.
- Use `I18n.msg(key, params)` and `I18n.bind(node, message)`. Messages can nest as parameters, and translations only set text or attributes, never HTML. Status logic compares `dataset.statusKey`, never translated text.
- Lookup falls back to English, then Traditional Chinese.
- Settings live in localStorage under versioned keys (`aniimo-dungeon-preferences-v1`, `aniimo-capture-regions-v1`, `aniimo-language-v1`, `aniimo-overlay-size-v1`, and so on). Do not rename these keys; persistence across releases depends on them.

## Project conventions

- Normal builds never read game files. Only the `extract_*` scripts do, and they are read-only.
- `dist/` (gitignored) holds local builds, release folders and verification JSON. Build ZIPs only when asked. `scripts/prune_releases.ps1` (dry run unless `-Apply`) keeps the latest release plus the two before it.
- Current scope is 12 PvE dungeons (the Nightmare and Chaos map pool: 20031–20040, 20061 and 20062) and 6 PvP regions (41003–41008). Unit tests assert exact map IDs and directions, so a map-pool change requires updating those tests.
- Marker positions are candidate spawn points rather than guaranteed spawns. User-facing text and docs consistently avoid overstating certainty, such as claiming verified drop rates or that SmartScreen warnings are solved. Keep that tone.
