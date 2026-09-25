"""Assemble exported map tiles; infer grid direction from edge continuity."""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat


def font(size):
    return ImageFont.truetype("C:/Windows/Fonts/msjh.ttc", size)


def coordinate(key, swap, sx, sy):
    x, y = key
    if swap:
        x, y = y, x
    return x * sx, y * sy


def edge_score(tiles):
    total = count = 0
    for (x, y), im in tiles.items():
        w, h = im.size
        for neighbor, box1, box2 in [((x + 1, y), (w-1, 0, w, h), (0, 0, 1, h)),
                                     ((x, y + 1), (0, h-1, w, h), (0, 0, w, 1))]:
            if neighbor not in tiles:
                continue
            a, b = im.crop(box1), tiles[neighbor].crop(box2)
            # Ignore completely transparent seam pixels, but include alpha edges.
            mask = ImageChops.lighter(a.getchannel('A'), b.getchannel('A')).point(lambda v: 255 if v else 0)
            stat = ImageStat.Stat(ImageChops.difference(a, b), mask)
            if stat.count[0]:
                total += sum(stat.sum)
                count += stat.count[0] * 4
    return total / count if count else None


def assemble(source):
    root = Path(source).resolve()
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    groups = defaultdict(list)
    for a in manifest['assets']:
        if a['status'] != 'ok':
            continue
        p = Path(a['output'])
        # Everything preceding final x/y identifies a distinct layer/sub-layer.
        label, x, y = p.stem.rsplit('_', 2)
        groups[label].append((int(x), int(y), root / p))
    output = root / 'preview'
    output.mkdir(exist_ok=True)
    summaries = []
    thumbs = []
    for label, files in sorted(groups.items()):
        tiles = {(x, y): Image.open(p).convert('RGBA') for x, y, p in files}
        if len(tiles) != len(files) or len({im.size for im in tiles.values()}) != 1:
            raise ValueError(f'Inconsistent tiles: {label}')
        variants = []
        for swap in [False, True]:
            for sx in [1, -1]:
                for sy in [-1, 1]:
                    candidate = {coordinate(k, swap, sx, sy): v for k, v in tiles.items()}
                    variants.append((edge_score(candidate), swap, sx, sy))
        variants.sort(key=lambda v: float('inf') if v[0] is None else v[0])
        # Verified against the supplied dungeon reference: indices increase right/down.
        # Sparse/transparent layers can produce a misleading zero-error alternative.
        swap, sx, sy = False, 1, 1
        score = edge_score(tiles)
        placed = {coordinate(k, swap, sx, sy): v for k, v in tiles.items()}
        minx, maxx = min(x for x, y in placed), max(x for x, y in placed)
        miny, maxy = min(y for x, y in placed), max(y for x, y in placed)
        w, h = next(iter(tiles.values())).size
        canvas = Image.new('RGBA', ((maxx-minx+1)*w, (maxy-miny+1)*h))
        for (x, y), im in placed.items():
            canvas.paste(im, ((x-minx)*w, (y-miny)*h))
        canvas.save(output / f'{label}.png')
        bbox = canvas.getchannel('A').getbbox()
        cropped = canvas.crop(bbox) if bbox else canvas.copy()
        cropped.save(output / f'{label}_cropped.png')
        small = cropped.copy()
        small.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        bg = Image.new('RGB', small.size, '#101214')
        bg.paste(small, mask=small.getchannel('A'))
        bg.save(output / f'{label}_preview.jpg', quality=94)
        thumbs.append((label, bg))
        summary = dict(label=label, tiles=len(files), full_size=canvas.size, content_bbox=bbox,
                       tile_origin=[minx,miny], tile_size=[w,h],
                       swap_axes=swap, x_direction=sx, y_direction=sy, seam_error=score,
                       orientation_candidates=variants, png=f'preview/{label}.png',
                       cropped=f'preview/{label}_cropped.png', preview=f'preview/{label}_preview.jpg')
        summaries.append(summary)
        # A labeled tile grid is useful for checking missing pieces and original IDs.
        cw, ch = 128, 150
        grid = Image.new('RGB', ((maxx-minx+1)*cw, (maxy-miny+1)*ch), '#202428')
        gd = ImageDraw.Draw(grid)
        for (x,y),im in placed.items():
            thumb=im.copy();thumb.thumbnail((cw-4,cw-4), Image.Resampling.LANCZOS)
            px,py=(x-minx)*cw,(y-miny)*ch
            grid.paste(thumb,(px+2,py+2),thumb.getchannel('A'))
            gd.text((px+4,py+128),f'{x},{y}',font=font(13),fill='white')
        grid.save(output/f'{label}_tiles.jpg',quality=90)
        print(label, len(files), canvas.size, 'grid',swap,sx,sy,'seam',score, flush=True)
    cellw, cellh, cols = 360, 310, min(4, len(thumbs))
    sheet = Image.new('RGB', (cols*cellw, math.ceil(len(thumbs)/cols)*cellh), '#15191c')
    draw = ImageDraw.Draw(sheet)
    for i,(label,im) in enumerate(thumbs):
        im=im.copy();im.thumbnail((cellw-16,cellh-46), Image.Resampling.LANCZOS)
        x,y=(i%cols)*cellw,(i//cols)*cellh
        sheet.paste(im,(x+(cellw-im.width)//2,y+8+(cellh-46-im.height)//2))
        draw.text((x+10,y+cellh-32),label.replace('UI_Img_Map_', '').replace('Layer_','L '),font=font(17),fill='white')
    sheet.save(output/'overview.jpg',quality=94)
    (output/'assembly.json').write_text(json.dumps(summaries,ensure_ascii=False,indent=2),encoding='utf-8')
    # Keep original layers, and provide a clearly labeled composited view for comparison.
    by_label={s['label']:s for s in summaries}
    composites=[]
    for s in summaries:
        if not s['label'].startswith('UI_Img_Map_2'):
            continue
        map_id=s['label'].split('_')[-1]
        layers=[v for v in summaries if v['label'].startswith(f'UI_Img_Map_Layer_{map_id}_')]
        if not layers:
            continue
        combined=Image.open(root/s['png']).convert('RGBA')
        for layer in sorted(layers,key=lambda v:v['label']):
            image=Image.open(root/layer['png']).convert('RGBA')
            x=(layer['tile_origin'][0]-s['tile_origin'][0])*s['tile_size'][0]
            y=(layer['tile_origin'][1]-s['tile_origin'][1])*s['tile_size'][1]
            combined.alpha_composite(image,(x,y))
        name=f'UI_Img_Map_{map_id}_combined'
        combined.save(output/f'{name}.png')
        bbox=combined.getchannel('A').getbbox()
        crop=combined.crop(bbox) if bbox else combined.copy()
        crop.save(output/f'{name}_cropped.png')
        crop.thumbnail((1600,1600),Image.Resampling.LANCZOS)
        bg=Image.new('RGB',crop.size,'#101214');bg.paste(crop,mask=crop.getchannel('A'))
        bg.save(output/f'{name}_preview.jpg',quality=94)
        composites.append(dict(map_id=map_id,base=s['png'],layers=[l['png'] for l in layers],
                               output=f'preview/{name}.png',
                               note='Alpha overlay of original map layers at original tile coordinates; for visual comparison, not a difficulty or traversability claim.'))
    (output/'composites.json').write_text(json.dumps(composites,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    assemble(parser.parse_args().source)
