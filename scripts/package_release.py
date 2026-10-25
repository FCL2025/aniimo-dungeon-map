"""Stage only the portable Windows assets for one GitHub Release."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'app/src-tauri/tauri.conf.json').read_text(encoding='utf8'))['version']
DIST = ROOT / 'dist'
PORTABLE = f'AniimoDungeonMap-{VERSION}-windows-x64-portable'
SOURCE = DIST / PORTABLE
OUTPUT = DIST / f'github-release-v{VERSION}'
FILES = {
    'AniimoDungeonMap.exe': SOURCE / 'AniimoDungeonMap.exe',
    f'{PORTABLE}.zip': DIST / f'{PORTABLE}.zip',
    'README.zh-TW.txt': SOURCE / '使用說明.txt',
    'THIRD_PARTY_NOTICES.txt': SOURCE / 'THIRD_PARTY_NOTICES.txt',
}

OUTPUT.mkdir(parents=True, exist_ok=True)
expected = set(FILES) | {'SHA256SUMS.txt'}
unexpected = {path.name for path in OUTPUT.iterdir()} - expected
if unexpected:
    raise SystemExit(f'Unexpected files in portable release folder: {sorted(unexpected)}')
for name, source in FILES.items():
    if not source.is_file():
        raise SystemExit(f'Missing portable release asset: {source}')
    shutil.copyfile(source, OUTPUT / name)

checksums = ''.join(
    f'{hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest()}  {name}\n'
    for name in sorted(FILES)
)
(OUTPUT / 'SHA256SUMS.txt').write_text(checksums, encoding='utf8')
print(f'Staged portable v{VERSION} in {OUTPUT}')
