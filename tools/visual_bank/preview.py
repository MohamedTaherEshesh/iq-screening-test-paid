#!/usr/bin/env python3
"""Build an HTML preview of the visual bank: N samples per (exam, format), correct answer marked.
Usage: python3 preview.py DIR OUT.html [N] [lang en|ar]"""
import glob, html, json, os, sys

d, out = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 2
lang = sys.argv[4] if len(sys.argv) > 4 else "en"
order = ["c-level", "senior-manager", "manager", "university", "junior"]
groups = {}
for lv in order:
    p = os.path.join(d, f"{lv}.jsonl")
    if not os.path.exists(p): continue
    for line in open(p, encoding="utf-8"):
        it = json.loads(line)
        groups.setdefault((lv, it["exam_id"], it["format_name"]), []).append(it)
rtl = lang == "ar"
parts = [f'<!doctype html><html lang="{lang}" dir="{"rtl" if rtl else "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
         '<title>Visual bank preview</title><style>body{font-family:Arial,sans-serif;background:#eef1f5;margin:0;padding:16px;color:#1f2a37}'
         'h2{margin:28px 0 8px;font-size:18px}.item{background:#fff;border-radius:10px;padding:14px;margin:10px 0;box-shadow:0 1px 3px #0002}'
         '.meta{font-size:12px;color:#5b6673;margin-bottom:6px}.stem{font-weight:700;margin:6px 0 10px}.opts{display:flex;flex-wrap:wrap;gap:8px}'
         '.opt{border:2px solid #dde3ea;border-radius:8px;padding:4px;min-width:60px;text-align:center;font-size:14px}.opt.ok{border-color:#2f7d6d;background:#eaf6f2}'
         '.opt b{display:block;font-size:12px;color:#5b6673}.exp{font-size:13px;color:#2f3b48;margin-top:8px;background:#f6f7f9;padding:8px;border-radius:6px}svg{max-width:100%;height:auto}</style></head><body>',
         f'<h1 style="font-size:20px">MindProof visual bank v1: preview ({lang.upper()})</h1>']
for (lv, ex, fm), items in groups.items():
    parts.append(f"<h2>{html.escape(ex)} · {html.escape(fm)} · {len(items)} items</h2>")
    for it in items[:N]:
        stem_svg = it.get("stem_svg") or it.get(f"stem_svg_{lang}") or ""
        parts.append(f'<div class="item"><div class="meta">{it["id"]} · {html.escape(it["domain"])} · difficulty {it["difficulty"]}</div>')
        parts.append(f'<div class="stem">{html.escape(it["stem_" + lang])}</div>{stem_svg}<div class="opts">')
        for i, o in enumerate(it["options"]):
            body = o.get("svg") or html.escape(o.get("text_" + lang, ""))
            parts.append(f'<div class="opt{" ok" if i == it["answer_index"] else ""}"><b>{"ABCDEFGH"[i]}</b>{body}</div>')
        parts.append(f'</div><div class="exp">{html.escape(it["explanation_" + lang])}</div></div>')
parts.append("</body></html>")
open(out, "w", encoding="utf-8").write("".join(parts))
print(out)
