"""Bundle offline translations for both the browser viewer and the Tauri app."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = [('zh-CN', '简体中文'), ('en', 'English'), ('ja', '日本語'), ('ko', '한국어'),
           ('zh-TW', '繁體中文'), ('de', 'Deutsch'), ('fr', 'Français'), ('es', 'Español'),
           ('pt', 'Português'), ('ru', 'Русский'), ('id', 'Indonesia'), ('th', 'ไทย'), ('vi', 'Tiếng Việt')]


def stage_i18n(output):
    messages = {code: json.loads((ROOT / 'app/locales' / f'{code}.json').read_text(encoding='utf8'))
                for code, _ in LOCALES}
    bindings = json.loads((ROOT / 'app/locales/bindings.json').read_text(encoding='utf8'))
    for code, catalog in messages.items():
        if set(catalog) != set(messages['en']):
            raise ValueError(f'{code}: translation keys differ from English')
        for key, value in catalog.items():
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f'{code}/{key}: empty translation')
            if set(re.findall(r'\{\w+\}', value)) != set(re.findall(r'\{\w+\}', messages['en'][key])):
                raise ValueError(f'{code}/{key}: interpolation placeholders differ')
    for _, key, *_ in bindings:
        if key not in messages['en']:
            raise ValueError(f'Unknown static translation: {key}')
    data = dict(locales=[dict(code=code, name=name) for code, name in LOCALES], messages=messages, bindings=bindings)
    (output / 'locales.js').write_text('window.ANIIMO_LOCALES=' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + ';\n', encoding='utf8')
