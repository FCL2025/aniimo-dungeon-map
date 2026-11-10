"""Render the M-map's initial fog view from exported game assets. No game access.

Back to front, as measured on 1920x1080 captures (docs/迷霧合成.md):
1. The base map over the panel backdrop, inside the revealed fog cells.
2. UI_Img_Map_Fog_Texture times a constant tint everywhere else. The texture
   spans fogGrid.desiredMapSize map pixels centred on the 2048-pixel map image.
3. Front door, player arrow and side door icons.
4. The panel's screen vignette (multiply) and fixed UI (add).
Layers 1-3 come from game files; the vignette, UI, arrow and reveal softness
are measured once by calibrate_fog_view.py and are shared by every map.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

from analyze_portal_geometry import portal_geometry

ROOT = Path(__file__).resolve().parent.parent
FOG = ROOT/'exports/map-fog'
DATA = ROOT/'exports/grab-eggs-data'
PREVIEW = ROOT/'exports/grab-eggs-dungeons/preview'
SCREEN = (1920, 1080)
PIXELS_PER_MAP_PIXEL = .6315787701725338  # farthest zoom at 1080p; same value as app/recognition-fog.js
ICON_PIXELS = 81  # 100-pixel marker icons drawn at 0.81 on a 1080p screen
# Map markers drawn in the initial view when their spot is (partly) revealed.
# Seen in the 20036 capture at reveal alpha ~0.4; boss and egg-nest pins inside
# the 20032 reveal are not drawn by the game at the start.
INITIAL_MARKERS = ('challenge',)
MARKER_MIN_REVEAL = .25


def rgba(path):
    return np.asarray(Image.open(path).convert('RGBA'), dtype=np.float32)


def premultiplied(image, size=None):
    """Area-resample in premultiplied space; returns (colour*alpha, alpha)."""
    image = image.convert('RGBa')
    if size:
        image = image.resize(size, Image.BOX)
    a = np.asarray(image, dtype=np.float32)
    return a[..., :3], a[..., 3:]/255


def map_record(mid):
    record = json.loads((DATA/'maps'/f'{mid}.json').read_text(encoding='utf8'))
    geometry = portal_geometry(record)
    if geometry is None:
        raise ValueError(f'{mid} has no unique entrance/exit pin')
    return record, geometry


def camera(entrance, map_size):
    """Default farthest zoom: a map narrower than the screen is centred; a taller
    one follows the player and stops at the map edge."""
    s = PIXELS_PER_MAP_PIXEL

    def axis(view, size, at):
        span = size*s
        return (view-span)/2 if span <= view else min(0.0, max(view-span, view/2-at*s))
    return s, axis(SCREEN[0], map_size[0], entrance[0]), axis(SCREEN[1], map_size[1], entrance[1])


def bilinear(texture, u, v, wrap):
    """Sample texture at u (columns) x v (rows); pixel centres are integers."""
    h, w = texture.shape[:2]
    u0, v0 = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = (u-u0)[None, :, None], (v-v0)[:, None, None]
    if wrap:
        cols, rows = (u0 % w, (u0+1) % w), (v0 % h, (v0+1) % h)
    else:
        cols, rows = (np.clip(u0, 0, w-1), np.clip(u0+1, 0, w-1)), (np.clip(v0, 0, h-1), np.clip(v0+1, 0, h-1))
    top = texture[rows[0]][:, cols[0]]*(1-fu)+texture[rows[0]][:, cols[1]]*fu
    bottom = texture[rows[1]][:, cols[0]]*(1-fu)+texture[rows[1]][:, cols[1]]*fu
    out = top*(1-fv)+bottom*fv
    if not wrap:
        inside = ((u >= 0) & (u <= w-1))[None, :, None] & ((v >= 0) & (v <= h-1))[:, None, None]
        out = np.where(inside, out, 0)
    return out


def gaussian_matrix(n, sigma):
    x = np.arange(n, dtype=np.float32)
    k = np.exp(-0.5*((x[:, None]-x[None, :])/sigma)**2)
    return k/k.sum(1, keepdims=True)


class Renderer:
    def __init__(self, calibration=True):
        source = json.loads((FOG/'source.json').read_text(encoding='utf8'))
        self.grid = source['fogGrid']
        self.desired = (self.grid['desiredMapSize']['1'], self.grid['desiredMapSize']['2'])
        self.fog = rgba(FOG/f'{source["source"]["texture"]["name"]}.png')[..., :3]
        self.catalog = json.loads((DATA/'marker-icons.json').read_text(encoding='utf8'))
        self.icons = {kind: self.icon(self.catalog['categories'][kind]) for kind in ('entrance', 'exit')}
        self.calibration = None
        if calibration:
            self.calibration = json.loads((FOG/'view-calibration.json').read_text(encoding='utf8'))
            self.vignette = np.asarray(Image.open(FOG/'screen-vignette.png').convert('RGB'), dtype=np.float32)/255
            self.ui = np.asarray(Image.open(FOG/'screen-ui.png').convert('RGB'), dtype=np.float32)
            self.arrow = premultiplied(Image.open(FOG/'player-arrow.png'))

    def icon(self, key):
        return premultiplied(Image.open(DATA/self.catalog['assets'][key]['image']), (ICON_PIXELS, ICON_PIXELS))

    def fog_layer(self, map_size, s, ox, oy):
        th, tw = self.fog.shape[:2]
        u = ((np.arange(SCREEN[0])-ox)/s+(self.desired[0]-map_size[0])/2)*tw/self.desired[0]
        v = ((np.arange(SCREEN[1])-oy)/s+(self.desired[1]-map_size[1])/2)*th/self.desired[1]
        return bilinear(self.fog, u, v, wrap=True)

    def map_layer(self, mid, s, ox, oy, backdrop):
        image = Image.open(PREVIEW/f'UI_Img_Map_{mid}.png').convert('RGBA')
        pad = max((d-m)//2 for d, m in zip(self.desired, image.size))
        canvas = Image.new('RGBA', (image.width+2*pad, image.height+2*pad), (0, 0, 0, 0))
        canvas.paste(image, (pad, pad))
        box = (pad-ox/s, pad-oy/s, pad+(SCREEN[0]-ox)/s, pad+(SCREEN[1]-oy)/s)
        if box[0] < 0 or box[1] < 0 or box[2] > canvas.width or box[3] > canvas.height:
            raise ValueError(f'{mid}: view leaves the padded map')
        colour, alpha = premultiplied(canvas.resize(SCREEN, Image.BOX, box=box).convert('RGBA'))
        return colour+np.asarray(backdrop, np.float32)*(1-alpha), alpha

    def reveal(self, centre, map_size, s, ox, oy, sigma, low, high):
        """Cells within explorePixelRadius of the player's cell, softened like the shader."""
        unit, radius = self.grid['unitPixel'], self.grid['explorePixelRadius']
        offset = [(d-m)/2 for d, m in zip(self.desired, map_size)]
        cell = [math.floor((centre[i]+offset[i])/unit) for i in range(2)]
        half = int((radius+1)*unit+4*sigma)
        origin = [(cell[i]+.5)*unit-offset[i]-half for i in range(2)]  # map px at window index 0
        samples = np.arange(2*half)+.5
        index = [np.floor((origin[i]+samples+offset[i])/unit)-cell[i] for i in range(2)]
        mask = ((index[1][:, None]**2+index[0][None, :]**2) <= radius**2).astype(np.float32)
        blur = gaussian_matrix(2*half, sigma)
        mask = np.clip((blur@mask@blur.T-low)/(high-low), 0, 1)
        mask = mask*mask*(3-2*mask)
        u = (np.arange(SCREEN[0])-ox)/s-origin[0]-.5
        v = (np.arange(SCREEN[1])-oy)/s-origin[1]-.5
        return bilinear(mask[..., None], u, v, wrap=False)

    @staticmethod
    def paste(target, sprite, cx, cy):
        colour, alpha = sprite
        h, w = alpha.shape[:2]
        x0, y0 = round(cx-w/2), round(cy-h/2)
        sx, sy = max(0, -x0), max(0, -y0)
        x1, y1 = min(target.shape[1], x0+w), min(target.shape[0], y0+h)
        if x1 <= x0+sx or y1 <= y0+sy:
            return
        region = target[y0+sy:y1, x0+sx:x1]
        region[:] = colour[sy:y1-y0, sx:x1-x0]+region*(1-alpha[sy:y1-y0, sx:x1-x0])

    def render(self, mid, offset=(0.0, 0.0), parts=None):
        """Synthesize the initial fog view; offset moves the player (screen px) from the entrance pin."""
        c = self.calibration
        record, geometry = map_record(mid)
        size = record['size']
        player = [geometry['entrance'][i]+offset[i]/PIXELS_PER_MAP_PIXEL for i in range(2)]
        s, ox, oy = camera(player, size)
        fog = self.fog_layer(size, s, ox, oy)*np.asarray(c['fogTint'], np.float32)
        view, _ = self.map_layer(mid, s, ox, oy, c['backdrop'])
        alpha = self.reveal(player, size, s, ox, oy, **c['reveal'])
        frame = alpha*view+(1-alpha)*fog
        at = lambda p: (ox+p[0]*s, oy+p[1]*s)
        for pin in record['pins']:
            x, y = map(round, at(pin['pixel']))
            if (pin['category'] in INITIAL_MARKERS and 0 <= x < SCREEN[0] and 0 <= y < SCREEN[1]
                    and alpha[y, x, 0] >= MARKER_MIN_REVEAL):
                self.paste(frame, self.icon(pin['iconKey']), *at(pin['pixel']))
        self.paste(frame, self.icons['entrance'], *at(geometry['entrance']))
        self.paste(frame, self.arrow, *[at(player)[i]+c['arrowOffset'][i] for i in range(2)])
        self.paste(frame, self.icons['exit'], *at(geometry['exit']))
        frame = frame*self.vignette+self.ui
        if parts is not None:
            parts.update(camera=(s, ox, oy), player=player, entrance=at(geometry['entrance']), exit=at(geometry['exit']))
        return Image.fromarray(np.clip(np.rint(frame), 0, 255).astype(np.uint8))
