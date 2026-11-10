"""Measure the M-map panel's screen layers from real initial-fog captures. No game access.

The fog texture, fog grid, base maps and door icons come from game files. What
remains is shared by every dungeon and is measured once here: the panel's
vignette and fixed UI, the fog tint, the dark backdrop, the reveal softness and
the player arrow. Each capture is checked leave-one-out against a synthesized view.
"""
import hashlib
import json
import math

import numpy as np
from PIL import Image

from fog_view import FOG, ROOT, SCREEN, Renderer, camera, map_record, premultiplied

FIXTURES = ROOT/'exports/recognition-fixtures'
# 1920x1080 captures taken right after entering, at the default farthest zoom.
# 20036 and 20039 include a window border (1924x1082) and are left out.
CAPTURES = {20031: 'real-20031-initial.png', 20032: 'real-20032-initial.png', 20033: 'real-20033-initial.png',
            20034: 'real-20034-initial.png', 20035: 'real-20035-initial.png', 20037: 'real-20037-initial.png',
            20038: 'real-20038-initial.png', 20040: 'real-20040-sparse.png', 20061: 'real-20061-initial.png'}
TINT_BOX = (slice(100, 500), slice(700, 1200))  # bright fog clear of UI, vignette and cursor
INITIAL_REVEAL = dict(sigma=24.0, low=.04, high=.69)
BORDER = 2
YY, XX = np.mgrid[0:SCREEN[1], 0:SCREEN[0]]


def distance(point):
    return np.hypot(XX-point[0], YY-point[1])


def content_shift(frame, view, alpha, pin):
    """Where the real camera put the map: players stand a few pixels off the pin."""
    r, m = 80, 7
    x0, y0 = int(pin[0])-r, max(int(pin[1])-r, m)
    x1, y1 = int(pin[0])+r, min(int(pin[1])+r, SCREEN[1]-m)
    d = distance(pin)[y0:y1, x0:x1]
    mask = (d > 38) & (d < 78) & (alpha[y0:y1, x0:x1, 0] > .99)
    ref = view[y0:y1, x0:x1][mask]
    ssd = np.array([[((frame[y0+dy:y1+dy, x0+dx:x1+dx][mask]-ref)**2).mean() for dx in range(-m, m+1)]
                    for dy in range(-m, m+1)])
    iy, ix = np.unravel_index(ssd.argmin(), ssd.shape)

    def vertex(a, b, c):
        return .5*(a-c)/(a-2*b+c) if 0 < ix < 2*m and 0 < iy < 2*m and a-2*b+c > 0 else 0
    return (ix-m+vertex(*ssd[iy, ix-1:ix+2]) if 0 < ix < 2*m else ix-m,
            iy-m+vertex(*ssd[iy-1:iy+2, ix]) if 0 < iy < 2*m else iy-m)


class Capture:
    def __init__(self, renderer, mid, name):
        self.mid, self.name = mid, name
        path = FIXTURES/name
        image = Image.open(path).convert('RGB')
        if image.size != SCREEN:
            raise ValueError(f'{name}: expected {SCREEN}, got {image.size}')
        self.sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        self.frame = np.asarray(image, dtype=np.float32)
        self.record, self.geometry = map_record(mid)
        size = self.record['size']
        s, ox, oy = camera(self.geometry['entrance'], size)
        view, alpha = renderer.map_layer(mid, s, ox, oy, (0, 0, 0))
        dx, dy = content_shift(self.frame, view, alpha, (ox+self.geometry['entrance'][0]*s, oy+self.geometry['entrance'][1]*s))
        self.shift, self.camera = (dx, dy), (s, ox+dx, oy+dy)
        s, ox, oy = self.camera
        self.premultiplied, self.map_alpha = renderer.map_layer(mid, s, ox, oy, (0, 0, 0))
        self.fog = renderer.fog_layer(size, s, ox, oy)
        self.pin = (ox+self.geometry['entrance'][0]*s, oy+self.geometry['entrance'][1]*s)
        self.exit = (ox+self.geometry['exit'][0]*s, oy+self.geometry['exit'][1]*s)
        self.fog_only = (distance(self.pin) > 150) & (distance(self.exit) > 50)
        self.ring = (distance(self.pin) > 55) & (distance(self.pin) < 160)


def screen_layers(captures):
    ratio = np.stack([np.where(c.fog_only[..., None], c.frame/np.maximum(c.fog, 1), np.nan) for c in captures])
    m = np.nanmedian(ratio, 0)
    tint = np.nanmedian(m[TINT_BOX].reshape(-1, 3), 0)
    vignette = m/tint
    missing = np.isnan(vignette).any(2)
    vignette[missing] = 1
    multiply = np.clip(vignette, 0, 1)
    excess = np.stack([np.where(c.fog_only[..., None], c.frame-multiply*tint*c.fog, np.nan) for c in captures])
    add = np.where((vignette > 1.02).any(2, keepdims=True), np.clip(np.nanmedian(excess, 0), 0, None), 0)
    add[missing] = 0
    add = np.nan_to_num(add)
    # Most captures carry the capture tool's 1-pixel window border plus a dark
    # line inside it; the game frame has neither, so repeat the interior there.
    for layer in (multiply, add):
        layer[:, :BORDER], layer[:, -BORDER:] = layer[:, BORDER:BORDER+1], layer[:, -BORDER-1:-BORDER]
        layer[:BORDER], layer[-BORDER:] = layer[BORDER:BORDER+1], layer[-BORDER-1:-BORDER]
    return tint, multiply, add, int(missing.sum())


def fit_backdrop(captures, multiply, add):
    samples = []
    for c in captures:
        d = distance(c.pin)
        hole = (c.map_alpha[..., 0] < .01) & (d > 40) & (d < 80)
        samples.append(((c.frame-add)/np.maximum(multiply, 1e-3))[hole])
    return np.median(np.concatenate(samples), 0)


def reveal_loss(renderer, captures, layers, params, centres):
    tint, multiply, add, backdrop = layers
    total = 0
    for c, centre in zip(captures, centres):
        s, ox, oy = c.camera
        alpha = renderer.reveal(centre, c.record['size'], s, ox, oy, **params)
        view = c.premultiplied+backdrop*(1-c.map_alpha)
        predicted = multiply*(alpha*view+(1-alpha)*tint*c.fog)+add
        total += float(((predicted-c.frame)[c.ring]**2).mean())
    return total/len(captures)


def player_cells(renderer, captures, layers, params):
    """The reveal is centred on the player's 16-pixel cell; try the pin's cell and its neighbours."""
    unit = renderer.grid['unitPixel']
    offset = [(d-m)/2 for d, m in zip(renderer.desired, captures[0].record['size'])]
    centres = []
    for c in captures:
        cell = [math.floor((c.geometry['entrance'][i]+offset[i])/unit) for i in range(2)]
        options = [[(cell[0]+i+.5)*unit-offset[0], (cell[1]+j+.5)*unit-offset[1]] for j in (-1, 0, 1) for i in (-1, 0, 1)]
        centres.append(min(options, key=lambda o: reveal_loss(renderer, [c], layers, params, [o])))
    return centres


def fit_reveal(renderer, captures, layers, centres):
    params, steps = dict(INITIAL_REVEAL), dict(sigma=4.0, low=.03, high=.06)
    best = reveal_loss(renderer, captures, layers, params, centres)
    for _ in range(6):
        for key in params:
            for sign in (-1, 1):
                trial = dict(params, **{key: params[key]+sign*steps[key]})
                if not (2 < trial['sigma'] < 64 and 0 <= trial['low'] < trial['high'] <= 1):
                    continue
                loss = reveal_loss(renderer, captures, layers, trial, centres)
                if loss < best:
                    params, best = trial, loss
        steps = {k: v/2 for k, v in steps.items()}
    return {k: round(v, 4) for k, v in params.items()}, best


def player_arrow(renderer, captures, layers, params, centres):
    """Matte the arrow against the rendered front door and floor beneath it."""
    tint, multiply, add, backdrop = layers
    r, crops, offsets = 40, [], []
    for c, centre in zip(captures, centres):
        s, ox, oy = c.camera
        alpha = renderer.reveal(centre, c.record['size'], s, ox, oy, **params)
        base = alpha*(c.premultiplied+backdrop*(1-c.map_alpha))+(1-alpha)*tint*c.fog
        renderer.paste(base, renderer.icons['entrance'], *c.pin)
        yellow = (c.frame[..., 0] > 200) & (c.frame[..., 1] > 170) & (c.frame[..., 2] < 120) & (distance(c.pin) < 45)
        if yellow.sum() < 50:
            continue
        cx, cy = int(round(XX[yellow].mean())), int(round(YY[yellow].mean()))
        window = (slice(cy-r, cy+r), slice(cx-r, cx+r))
        observed = (c.frame[window]-add[window])/np.maximum(multiply[window], 1e-3)
        crops.append((observed, base[window]))
        offsets.append((cx-c.pin[0], cy-c.pin[1]))
    observed = np.median(np.stack([o for o, _ in crops]), 0)
    under = np.median(np.stack([b for _, b in crops]), 0)
    difference = observed-under
    alpha = np.clip(np.abs(difference).max(2, keepdims=True)/40, 0, 1)
    colour = np.where(alpha > .01, under+difference/np.maximum(alpha, .01), 0)
    sprite = np.concatenate([np.clip(colour, 0, 255), alpha*255], 2)
    offset = np.median(np.array(offsets), 0)
    return Image.fromarray(np.rint(sprite).astype(np.uint8), 'RGBA'), [round(float(v), 2) for v in offset], len(crops)


def validate(renderer, captures, params, arrow, arrow_offset):
    """Leave-one-out: rebuild the screen layers without the capture being checked."""
    results = []
    for c in captures:
        others = [o for o in captures if o is not c]
        tint, multiply, add, _ = screen_layers(others)
        backdrop = fit_backdrop(others, multiply, add)
        renderer.calibration = dict(fogTint=tint.tolist(), backdrop=backdrop.tolist(), reveal=params, arrowOffset=arrow_offset)
        renderer.vignette, renderer.ui, renderer.arrow = multiply, add, arrow
        parts = {}
        error = np.abs(np.asarray(renderer.render(c.mid, parts=parts), np.float32)-c.frame).mean(2)
        d, de = distance(parts['entrance']), distance(parts['exit'])
        results.append(dict(id=c.mid, frameMeanAbs=round(float(error.mean()), 3),
                            fogMedianAbs=round(float(np.median(error[(d > 160) & (de > 50)])), 3),
                            revealMeanAbs=round(float(error[(d > 40) & (d < 140)].mean()), 3),
                            revealP95Abs=round(float(np.percentile(error[(d > 40) & (d < 140)], 95)), 3),
                            playerOffsetPixels=[round(v, 2) for v in c.shift]))
        print(results[-1], flush=True)
    return results


def main():
    renderer = Renderer(calibration=False)
    captures = [Capture(renderer, mid, name) for mid, name in CAPTURES.items()]
    for c in captures:
        print(f'{c.mid}: camera shift {c.shift[0]:+.2f}, {c.shift[1]:+.2f} px', flush=True)
    tint, multiply, add, missing = screen_layers(captures)
    backdrop = fit_backdrop(captures, multiply, add)
    layers = (tint, multiply, add, backdrop)
    centres = player_cells(renderer, captures, layers, INITIAL_REVEAL)
    params, loss = fit_reveal(renderer, captures, layers, centres)
    centres = player_cells(renderer, captures, layers, params)
    print('reveal', params, round(loss, 2), flush=True)
    arrow, arrow_offset, arrow_samples = player_arrow(renderer, captures, layers, params, centres)
    validation = validate(renderer, captures, params, premultiplied(arrow), arrow_offset)

    FOG.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.rint(multiply*255).astype(np.uint8)).save(FOG/'screen-vignette.png')
    Image.fromarray(np.rint(np.clip(add, 0, 255)).astype(np.uint8)).save(FOG/'screen-ui.png')
    arrow.save(FOG/'player-arrow.png')
    unit = renderer.grid['unitPixel']
    result = dict(
        screen=list(SCREEN), fogTint=[round(float(v), 5) for v in tint], backdrop=[round(float(v), 2) for v in backdrop],
        reveal=params, revealLoss=round(loss, 3), arrowOffset=arrow_offset, arrowSamples=arrow_samples,
        uncoveredScreenPixels=missing,
        captures=[dict(id=c.mid, file=f'exports/recognition-fixtures/{c.name}', sha256=c.sha256,
                       cameraShift=[round(float(v), 2) for v in c.shift],
                       revealCell=[int((centre[i]+(renderer.desired[i]-c.record['size'][i])/2)//unit) for i in range(2)])
                  for c, centre in zip(captures, centres)],
        validation=dict(method='leave-one-out screen layers; synthesized with the player on the entrance pin', results=validation),
        files={name: hashlib.sha256((FOG/name).read_bytes()).hexdigest()
               for name in ('screen-vignette.png', 'screen-ui.png', 'player-arrow.png')},
        note='Screen layers are 1920x1080 only. Fog, grid, map and door icons come from exports/map-fog/source.json and game exports.')
    (FOG/'view-calibration.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print('Wrote', FOG/'view-calibration.json')


if __name__ == '__main__':
    main()
