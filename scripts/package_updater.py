"""Stage signed NSIS and portable artifacts for one GitHub Release."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'app/src-tauri/tauri.conf.json').read_text(encoding='utf8'))['version']
TAG = f'v{VERSION}'
DIST = ROOT / 'dist'
URL_BASE = f'https://github.com/FCL2025/aniimo-dungeon-map/releases/download/{TAG}'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--notes', default='', help='Brief notes shown in the in-app update prompt')
args = parser.parse_args()

nsis = ROOT / 'app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis'
installers = list(nsis.glob(f'*{VERSION}*-setup.exe'))
if len(installers) != 1:
    raise SystemExit(f'Expected one NSIS installer for {VERSION}, found {len(installers)} in {nsis}')
installer = installers[0]
signature = installer.with_name(installer.name + '.sig')
if not signature.is_file():
    raise SystemExit(f'Missing updater signature: {signature}')

portable_name = f'AniimoDungeonMap-{VERSION}-windows-x64-portable'
portable_exe = DIST / portable_name / 'AniimoDungeonMap.exe'
portable_zip = DIST / f'{portable_name}.zip'
if not portable_exe.is_file() or not portable_zip.is_file():
    raise SystemExit('Build the portable EXE and ZIP before packaging the updater')

output = DIST / f'github-release-{TAG}'
output.mkdir(parents=True, exist_ok=True)
files = {
    'AniimoDungeonMap-Setup.exe': installer,
    'AniimoDungeonMap-Setup.exe.sig': signature,
    'AniimoDungeonMap.exe': portable_exe,
    portable_zip.name: portable_zip,
    'README.zh-TW.txt': DIST / portable_name / '使用說明.txt',
    'THIRD_PARTY_NOTICES.txt': DIST / portable_name / 'THIRD_PARTY_NOTICES.txt',
}
expected = set(files) | {'latest.json', 'SHA256SUMS.txt'}
unexpected = {path.name for path in output.iterdir()} - expected
if unexpected:
    raise SystemExit(f'Unexpected files in release folder: {sorted(unexpected)}')
for name, source in files.items():
    if not source.is_file():
        raise SystemExit(f'Missing release asset: {source}')
    shutil.copyfile(source, output / name)

manifest = {
    'version': VERSION,
    'notes': args.notes,
    'platforms': {
        'windows-x86_64': {
            'url': f'{URL_BASE}/AniimoDungeonMap-Setup.exe',
            'signature': signature.read_text(encoding='utf8').strip(),
        },
    },
}
(output / 'latest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
checksums = ''.join(
    f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n'
    for path in sorted((output / name for name in expected - {'SHA256SUMS.txt'}))
)
(output / 'SHA256SUMS.txt').write_text(checksums, encoding='utf8')
print(f'Staged {TAG} in {output}')
