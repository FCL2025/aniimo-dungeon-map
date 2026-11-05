"""Stage only the portable Windows assets for one GitHub Release."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

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

def verify_portable(source: Path, archive: Path) -> None:
    """Reject changed-after-checksum files and ZIPs from an older build."""
    names = {'AniimoDungeonMap.exe', '使用說明.txt', 'THIRD_PARTY_NOTICES.txt'}
    checksums = {}
    for line in (source / 'SHA256SUMS.txt').read_text(encoding='utf-8-sig').splitlines():
        digest, name = line.split('  ', 1)
        if name not in names or name in checksums:
            raise ValueError(f'Unexpected or duplicate checksum entry: {name}')
        checksums[name] = digest
    if set(checksums) != names:
        raise ValueError('Incomplete portable checksum inventory')
    for name, digest in checksums.items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Portable file changed after checksums were generated: {name}')
    names.add('SHA256SUMS.txt')
    with zipfile.ZipFile(archive) as package:
        expected = {f'{source.name}/{name}' for name in names}
        if len(package.namelist()) != len(expected) or set(package.namelist()) != expected:
            raise ValueError('Unexpected ZIP inventory')
        for name in names:
            # Reading verifies member CRC; byte comparison includes the EXE signature.
            if package.read(f'{source.name}/{name}') != (source / name).read_bytes():
                raise ValueError(f'ZIP differs from the portable folder: {name}')


def main() -> None:
    for source in FILES.values():
        if not source.is_file():
            raise SystemExit(f'Missing portable release asset: {source}')
    verify_portable(SOURCE, DIST / f'{PORTABLE}.zip')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    expected = set(FILES) | {'SHA256SUMS.txt'}
    unexpected = {path.name for path in OUTPUT.iterdir()} - expected
    if unexpected:
        raise SystemExit(f'Unexpected files in portable release folder: {sorted(unexpected)}')
    for name, source in FILES.items():
        shutil.copyfile(source, OUTPUT / name)
    checksums = ''.join(
        f'{hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest()}  {name}\n'
        for name in sorted(FILES)
    )
    (OUTPUT / 'SHA256SUMS.txt').write_text(checksums, encoding='utf8')
    print(f'Staged portable v{VERSION} in {OUTPUT}')


if __name__ == '__main__':
    main()
