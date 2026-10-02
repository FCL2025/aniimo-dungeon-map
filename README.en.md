# Aniimo Dungeon Map

[繁體中文](README.md) | **English**

A Windows map companion for Aniimo's Egg Scramble mode. Covers 7 dungeons on Nightmare and Chaos, with chest and egg-nest markers, manual map selection, automatic recognition, player tracking, and a transparent map overlay.

**[Download the latest EXE](https://github.com/FCL2025/aniimo-dungeon-map/releases/latest/download/AniimoDungeonMap.exe)** · [Release notes and ZIP download](https://github.com/FCL2025/aniimo-dungeon-map/releases/latest)

## Feature preview

**1. Support for 13 languages**

![Sidebar language menu with English, Traditional Chinese, Japanese, and other supported languages](docs/images/languages.webp)

**2. Example: compare the full map with the game**

![The main window shows the complete dungeon alongside the explored area in the game](docs/images/map-example.webp)

**3. Map overlay in the game**

![A transparent map in the lower-left corner shows terrain, chests, and egg nests](docs/images/in-game-overlay.webp)

**4. Choose an exit from the overlay**

![Choose the exit direction directly in the overlay to select the current dungeon](docs/images/overlay-exit-selection.webp)

Screenshots 2 and 3 show an older interface. Buttons and messages may differ in the latest version.

## Getting started

1. Download and run `AniimoDungeonMap.exe`; no installation is needed. If using the ZIP, extract it first. Select **English** from the language menu at the top of the sidebar.
2. Press **M** in the game and find the exit relative to the entrance. Click **Choose exit** in the app. If multiple maps share a direction, compare their previews; use **Show all maps** if unsure.
3. Choose the difficulty and visible markers in the sidebar. Click **Overlay** to show the transparent map over the game.
4. For the next run, click **Reselect** on the overlay to choose another map without returning to the main window.

Recognition is off by default. To select a map automatically, turn on **Recognize** and keep the game's M-map fully zoomed out. Toggle recognition off and on for a new run. Opening manual selection turns recognition off.

To track your position, select a map, turn on **Track**, then close the game's M-map and return to gameplay.

## Common controls

| Control | Action |
| --- | --- |
| **F1** | Hide or show the overlay |
| Mouse wheel / drag the map | Zoom / pan |
| Drag the move handle at the top of the overlay | Reposition the overlay |
| **Overlay size** / **Reset size** | Resize the overlay / restore its default size |
| **× / Esc** in the exit picker | Cancel selection and restore the previous map |
| Language menu at the top of the sidebar | Change the language in both windows |

For two-player chest routes, enable **Show suggested route**, use the same **Show inferred room markers** setting, and choose separate routes, 1 and 2. Open only your numbered chests. Orange dashed paths require a key; gold chests are not assigned to either route.

## Before you play

- Supports Windows 10/11 x64; recognition and tracking require Windows 10 version 1903 or later. Install [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) if it is missing.
- Use windowed or borderless mode. Press **Alt** first if the game locks the cursor. You can minimize the main window while the overlay is open.
- Close the old version before updating. Map, language, route, and other settings are retained for the same Windows account.
- Markers indicate possible spawns, not guaranteed ones. Opened chests are not recorded automatically. Fog can affect recognition and tracking; floor detection is not supported.

For more controls, open **Help** at the bottom of the sidebar.

Open **Gold loot priority** above the marker filters to view the original game icons for 24 gold treasures and compare their weight, sale price, and value per weight. Items rank by sale price ÷ weight, with shared ranks for equal values. Item names use the game's translations for the selected language.
