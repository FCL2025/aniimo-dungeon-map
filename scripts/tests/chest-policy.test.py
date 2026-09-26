"""Check the display policy against independently exported game records."""
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_viewer import SOURCE, display_pins


class ChestPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.maps = [json.loads(p.read_text(encoding='utf8')) for p in (SOURCE / 'maps').glob('*.json')]
        cls.sources = json.loads((SOURCE / 'source-tables.json').read_text(encoding='utf8'))

    def test_all_maps_keep_only_high_tier_chests_and_supported_keys(self):
        self.assertEqual(len(self.maps), 31)
        for record in self.maps:
            original = {p['id']: p for p in record['pins']}
            for pin in display_pins(record['pins']):
                self.assertNotIn(pin['category'], ['pot', 'cache', 'chest', 'key_blue', 'key_purple'])
                self.assertEqual(pin['pixel'], original[pin['id']]['pixel'])
                if pin['category'].startswith('chest_'):
                    self.assertEqual(pin['quality'], 5)
                    self.assertEqual(pin['category'] == 'chest_glass', pin['typeId'] == 2011)
                    self.assertEqual(pin['originalName'], original[pin['id']]['name'])

    def test_20037_key_room_glass_chests_have_single_object_spawners(self):
        record = next(m for m in self.maps if m['id'] == 20037)
        pins = display_pins(record['pins'])
        for room_id, source_id, pixel in [(65, 91320788, [641.2776, 1351.6207]),
                                          (66, 91320829, [430.8108, 1101.4511])]:
            chests = [p for p in pins if p['roomId'] == room_id and p['category'] == 'chest_glass']
            self.assertEqual(len(chests), 1)
            pin = chests[0]
            self.assertEqual(pin['sourceId'], source_id)
            self.assertEqual(pin['pixel'], pixel)
            entity = self.sources['resourceEntities'][str(source_id)]
            self.assertEqual(entity['idInType'], 2011)
            groups = self.sources['spawners'][str(entity['spawnerId'])]['spawnGroups']
            self.assertEqual(len(groups), 1)
            self.assertEqual(list(next(iter(groups.values()))['spawnIds'].values()), [source_id])

    def test_ordinary_glass_chests_belong_to_g6(self):
        chests = [p for m in self.maps for p in display_pins(m['pins'])
                  if p['category'] == 'chest_glass' and p['sandboxConfigType'] == 2]
        self.assertTrue(chests)
        self.assertTrue(all(p['sandboxLevel'] == 6 for p in chests))


if __name__ == '__main__':
    unittest.main()
