"""Read gold chest treasure values and official names from local game resources.

No game code is executed. The committed snapshot lets ordinary builds run offline.
"""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import zipfile

from pmdata import DEFAULT_ARCHIVE, MEMBER, PMData

ROOT = Path(__file__).resolve().parent.parent
LANGUAGES = {'zh-CN': 'zh_CN', 'en': 'en', 'ja': 'ja', 'ko': 'ko',
             'zh-TW': 'zh_TW', 'de': 'de_DE', 'fr': 'fr_FR', 'es': 'es_ES',
             'pt': 'pt_PT', 'ru': 'ru_RU', 'id': 'id_ID', 'th': 'th_TH', 'vi': 'vi_VN'}


def extract(archive=DEFAULT_ARCHIVE):
    root = PMData(archive).root
    # Verified gold treasure group used by dungeon chest rewardGroup2.
    chains = [(2004, 6, 15101310), (2011, 5, 15101216), (2011, 6, 15101314)]
    for chest, difficulty, drop in chains:
        assert drop in root['rob_egg_chest_data'][chest]['rewardGroup2'][difficulty].values()
        assert root['drop_data'][drop]['dropType'] == 2
        assert 520005 in root['drop_data'][drop]['dropParam'].values()
    hashes, languages = {}, {}
    with zipfile.ZipFile(archive) as z:
        hashes[MEMBER] = hashlib.sha256(z.read(MEMBER)).hexdigest()
        for code, suffix in LANGUAGES.items():
            index_path = f'xfs/luascripts/Data/I18N/NewTextMap_{suffix}.json'
            blob_path = f'xfs/luascripts/Data/I18N/Compress_{suffix}.bin'
            index, blob = z.read(index_path), z.read(blob_path)
            languages[code] = (json.loads(index), blob)
            hashes[index_path] = hashlib.sha256(index).hexdigest()
            hashes[blob_path] = hashlib.sha256(blob).hexdigest()

    items = []
    for member in root['drop_group_data'][520005].values():
        item_id = member['itemId']
        row = root['item_data'][item_id]
        if row['quality'] != 5:
            continue
        outside_id = root['rob_egg_item_in'][item_id]['outid']
        outside = root['item_data'][outside_id]
        assert row['sellPrice'] == outside['sellPrice'] > 0
        assert row['weight'] > 0
        names = {}
        for code, (index, blob) in languages.items():
            offset, length = index[str(row['itemName'])]
            names[code] = blob[offset:offset + length].decode('utf-8')
            assert names[code].strip()
        items.append(dict(id=item_id, outsideId=outside_id, nameKey=row['itemName'],
                          quality=row['quality'], weight=row['weight'], sellPrice=row['sellPrice'], names=names,
                          icon=f'loot-icons/{row["icon"].lstrip("$")}'))
    items.sort(key=lambda item: (-Fraction(item['sellPrice'], item['weight']), item['id']))
    previous, rank = None, 0
    for position, item in enumerate(items, 1):
        value = Fraction(item['sellPrice'], item['weight'])
        if value != previous:
            rank = position
        item['rank'] = rank
        previous = value
    return dict(source=dict(groupId=520005, quality=5, ranking='sellPrice / weight',
                            rewardChains=[dict(chestId=c, difficulty=d, dropId=r) for c, d, r in chains],
                            memberSha256=hashes), items=items)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', default=DEFAULT_ARCHIVE)
    parser.add_argument('--output', type=Path, default=ROOT / 'app/loot-ranking.json')
    args = parser.parse_args()
    result = extract(args.archive)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(result["items"])} gold treasures in {len(LANGUAGES)} game languages')
