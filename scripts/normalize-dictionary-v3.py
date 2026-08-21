#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
FILES = [ROOT / f"data/sambal-tina-v3-{idx:02d}.js" for idx in range(1, 9)]
BASE64_RUN = re.compile(r"[A-Za-z0-9+/=]{100,}")

for path in FILES:
    if not path.is_file():
        print(f"missing dictionary fragment: {path.relative_to(ROOT)}", file=sys.stderr)
        sys.exit(1)

    text = path.read_text(encoding="utf-8")
    segments = BASE64_RUN.findall(text)
    if not segments:
        print(f"no dictionary payload segments found: {path.relative_to(ROOT)}", file=sys.stderr)
        sys.exit(1)

    payload = "".join(segments)
    path.write_text(
        'window.SAMBAL_TINA_DATA=(window.SAMBAL_TINA_DATA||"")+"' + payload + '";\n',
        encoding="utf-8",
    )
    print(f"normalized {path.name}: {len(segments)} segment(s), {len(payload)} payload chars")
