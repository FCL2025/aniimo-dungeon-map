"""Export the PvE Nightmare/Chaos map list from the local game resource."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from pmdata import DEFAULT_ARCHIVE, MEMBER, PMData


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'exports/grab-eggs-data/map-pool.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=Path(DEFAULT_ARCHIVE))
    parser.add_argument('--output', type=Path, default=OUTPUT)
    args = parser.parse_args()
    pm = PMData(args.archive)
    rows = pm.root['rob_egg_born_data'][3005]['DungeonList']
    entries = {str(d): list(rows[d].values()) for d in (5, 6)}
    map_ids = sorted({mid for values in entries.values() for mid in values})
    assert map_ids and all(mid in pm.root['scene_data'] for mid in map_ids)
    assert entries['5'] == entries['6']
    with zipfile.ZipFile(args.archive) as archive:
        sha256 = hashlib.sha256(archive.read(MEMBER)).hexdigest()
    result = dict(sourceTable='rob_egg_born_data[3005].DungeonList',
                  pmdataSha256=sha256, entries=entries, mapIds=map_ids)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'PvE Nightmare/Chaos map pool: {len(map_ids)} unique maps, {len(entries["5"])} entries each')


if __name__ == '__main__':
    main()
