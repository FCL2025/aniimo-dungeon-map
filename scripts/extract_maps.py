"""Read Aniimo's local manifest and export selected map textures. Never writes to the game."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import struct

import UnityPy

ROOT = Path(__file__).resolve().parents[1]
GAME = Path(r"F:\Pawprint\Aniimo\game")
PREFIX = "Assets/Res/XGUI/Panel/MapRes/Texture/"


class Reader:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def take(self, size):
        if self.pos + size > len(self.data):
            raise ValueError(f"Truncated manifest at {self.pos}")
        result = self.data[self.pos:self.pos + size]
        self.pos += size
        return result

    def num(self, fmt):
        return struct.unpack("<" + fmt, self.take(struct.calcsize("<" + fmt)))[0]

    def string(self, fmt="H"):
        return self.take(self.num(fmt)).decode("utf-8")

    def ids(self):
        return [self.num("i") for _ in range(self.num("H"))]


def read_manifest(game=GAME, version="3595896"):
    package = game / "Aniimo_Data/cvs/res/uab/win/DefaultPackage"
    source = package / f"ManifestFiles/PackageManifest_DefaultPackage_{version}.bytes"
    raw = source.read_bytes()
    r = Reader(raw)
    if r.take(4) != b"OOY\0" or r.string() != "1.4.17":
        raise ValueError("Unsupported manifest format")
    flags = [r.num("B") for _ in range(3)]
    style, name, actual_version = r.num("i"), r.string(), r.string()
    if flags != [0, 0, 1] or style != 4 or actual_version != version:
        raise ValueError("Unexpected Aniimo manifest header")
    # This game's compact format differs from upstream YooAsset 1.4.17.
    assets = []
    for _ in range(r.num("i")):
        assets.append(dict(path=r.string(), bundle_id=r.num("i"),
                           dependencies=r.ids(), metadata=r.num("I")))
    bundles = []
    for _ in range(r.num("i")):
        bundle = dict(name=r.string("B"), hash=r.take(16).hex(),
                      crc=r.num("I"), size=r.num("I"), references=r.ids())
        h = bundle["hash"]
        bundle["file"] = str(package / "CacheBundleFiles" / h[:2] / h / "cdata.uab")
        bundles.append(bundle)
    if r.pos != len(raw):
        raise ValueError(f"Unexpected trailing bytes: {len(raw) - r.pos}")
    for a in assets:
        if not all(0 <= i < len(bundles) for i in [a["bundle_id"], *a["dependencies"]]):
            raise ValueError("Invalid bundle reference")
    return assets, bundles, dict(version=actual_version, source=str(source),
                                sha256=hashlib.sha256(raw).hexdigest(),
                                asset_count=len(assets), bundle_count=len(bundles))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", type=Path, default=GAME)
    parser.add_argument("--version", default="3595896")
    parser.add_argument("--groups", nargs="+", default=["3004", "3004_1", "3004_2"])
    parser.add_argument("--output", type=Path, default=ROOT / "exports/grab-eggs")
    parser.add_argument("--catalog-only", action="store_true")
    parser.add_argument("--append", action="store_true", help="Add groups to an export from the same source manifest")
    args = parser.parse_args()
    output = args.output.resolve()
    if output == args.game.resolve() or args.game.resolve() in output.parents:
        raise ValueError("Output must be outside the game directory")
    assets, bundles, meta = read_manifest(args.game, args.version)
    output.mkdir(parents=True, exist_ok=True)
    catalog = [a for a in assets if a["path"].startswith(PREFIX)]
    (output / "map-catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Map groups:", Counter(a["path"][len(PREFIX):].split('/')[0] for a in catalog), flush=True)
    if args.catalog_only:
        return
    chosen = [a for a in catalog if a["path"][len(PREFIX):].split('/')[0] in args.groups]
    if not chosen:
        raise ValueError("No assets match requested groups")
    grouped = defaultdict(list)
    for a in chosen:
        grouped[a["bundle_id"]].append(a)
    result = dict(created_at=datetime.now(timezone.utc).isoformat(), source=meta,
                  tool_versions={"UnityPy": UnityPy.__version__}, groups=args.groups,
                  note="Resource IDs are not difficulty labels; source files are read-only.", assets=[])
    if args.append and (output / 'manifest.json').exists():
        previous=json.loads((output / 'manifest.json').read_text(encoding='utf-8'))
        if previous['source']['sha256'] != meta['sha256']:
            raise ValueError('Cannot append resources from a different source manifest')
        replacing={a['path'] for a in chosen}
        result['assets']=[a for a in previous['assets'] if a['resource_path'] not in replacing]
        result['groups']=sorted(set(previous['groups']) | set(args.groups))
    for bid, entries in sorted(grouped.items()):
        bundle = bundles[bid]
        print(f"Reading {bundle['name']}: {len(entries)} selected assets", flush=True)
        env = None
        bundle_error = None
        try:
            source = Path(bundle["file"])
            if source.stat().st_size != bundle["size"]:
                raise ValueError("Bundle size differs from manifest")
            env = UnityPy.load(str(source))
            textures = {}
            for obj in env.objects:
                if obj.type.name == "Texture2D":
                    textures.setdefault(obj.peek_name(), []).append(obj)
        except Exception as exc:
            bundle_error = f"{type(exc).__name__}: {exc}"
        for a in entries:
            record = dict(resource_path=a["path"], source_bundle=bundle,
                          dependencies=[bundles[i] for i in a["dependencies"]])
            try:
                if bundle_error:
                    raise ValueError(bundle_error)
                relative = Path(a["path"][len(PREFIX):])
                if relative.is_absolute() or '..' in relative.parts:
                    raise ValueError("Unsafe resource path")
                candidates = textures.get(relative.stem, [])
                if len(candidates) == 1:
                    obj = candidates[0]
                else:
                    obj = env.container[a["path"]]
                data = obj.parse_as_object()
                img = data.image
                target = output / "tiles" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                img.save(target)
                record.update(status="ok", output=str(target.relative_to(output)).replace('\\', '/'),
                              width=img.width, height=img.height, mode=img.mode,
                              object_type=obj.type.name, path_id=obj.path_id,
                              texture_format=getattr(data, 'm_TextureFormat', None),
                              sha256=hashlib.sha256(target.read_bytes()).hexdigest())
            except Exception as exc:
                record.update(status="failed", error=f"{type(exc).__name__}: {exc}")
            result["assets"].append(record)
        result["summary"] = dict(Counter(a["status"] for a in result["assets"]))
        (output / "manifest.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Progress:", result["summary"], flush=True)
        if env is not None:
            del env
    print("Finished:", output, result["summary"], flush=True)


if __name__ == "__main__":
    main()
