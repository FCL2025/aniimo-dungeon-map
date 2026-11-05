"""Prevent publishing stale ZIPs or EXEs changed after checksumming/signing."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
import warnings
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from package_release import verify_portable


class ReleaseIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.source = root / 'portable'
        self.source.mkdir()
        self.archive = root / 'portable.zip'
        for name in ('AniimoDungeonMap.exe', '使用說明.txt', 'THIRD_PARTY_NOTICES.txt'):
            (self.source / name).write_bytes(f'fixture: {name}'.encode())
        self.checksums()
        self.zip()

    def checksums(self):
        text = ''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n'
                       for p in self.source.iterdir() if p.name != 'SHA256SUMS.txt')
        (self.source / 'SHA256SUMS.txt').write_text(text, encoding='utf8')

    def zip(self):
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for path in self.source.iterdir():
                archive.write(path, f'{self.source.name}/{path.name}')

    def test_matching_release(self):
        verify_portable(self.source, self.archive)

    def test_executable_modified_after_checksumming(self):
        (self.source / 'AniimoDungeonMap.exe').write_bytes(b'changed after signing')
        with self.assertRaisesRegex(ValueError, 'changed after checksums'):
            verify_portable(self.source, self.archive)

    def test_stale_zip_even_with_current_checksums(self):
        (self.source / 'AniimoDungeonMap.exe').write_bytes(b'new signed executable')
        self.checksums()
        with self.assertRaisesRegex(ValueError, 'ZIP differs'):
            verify_portable(self.source, self.archive)

    def test_unexpected_zip_member(self):
        with zipfile.ZipFile(self.archive, 'a') as archive:
            archive.writestr('../unexpected.exe', b'extra')
        with self.assertRaisesRegex(ValueError, 'ZIP inventory'):
            verify_portable(self.source, self.archive)

    def test_duplicate_zip_member(self):
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.archive, 'a') as archive:
                archive.writestr('portable/AniimoDungeonMap.exe', b'duplicate')
        with self.assertRaisesRegex(ValueError, 'ZIP inventory'):
            verify_portable(self.source, self.archive)

    def test_missing_checksum(self):
        (self.source / 'SHA256SUMS.txt').write_text('', encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            verify_portable(self.source, self.archive)


if __name__ == '__main__':
    unittest.main()
