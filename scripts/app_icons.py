"""Package the original Collector's Edition egg icon for Windows and the viewer."""
from pathlib import Path
import shutil

from PIL import Image


ICON_DIR = Path(__file__).resolve().parents[1] / 'app/src-tauri/icons'


def stage_app_icons(output):
    # icon.png is the original transparent game texture; preserve its pixels.
    with Image.open(ICON_DIR / 'icon.png') as icon:
        icon.save(ICON_DIR / 'icon.ico', sizes=[(size, size) for size in
                  (16, 24, 32, 48, 64, 128, 256)])
    shutil.copyfile(ICON_DIR / 'icon.png', output / 'favicon.png')
    shutil.copyfile(ICON_DIR / 'icon.ico', output / 'favicon.ico')
