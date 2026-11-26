#!/usr/bin/env python3
"""OMS-MND-261126-17 MindProof visual question bank generator (formats 4 to 8).

Every item is built from a rule, and its answer is computed by code, then re-checked
by an independent verifier (verify.py). Output: draft items (status "draft"), one JSONL
file per level. No database writes.

Formats:
  4 matrix      3x3 visual matrix, last cell missing (rules: progression, distribution, row constant)
  5 spatial     polyomino rotation (which option is the same shape turned) / mirror image
  6 odd         odd one out (attributes) / odd rotation (four rotations and one mirror)
  7 chart       bar, line and dashboard charts with computed questions
  8 heatmap     table of values with one cell that breaks its row pattern

Usage: python3 vbank.py OUT_DIR [--seed N] [--scale K]
"""
import hashlib, json, math, os, random, sys

LEVEL_BAND = {"junior": (1, 3), "university": (3, 5), "manager": (4, 6), "senior-manager": (5, 8), "c-level": (7, 10)}
EXAM_ID = {
    ("junior", "mrs"): "junior-reasoning-score", ("junior", "ca"): "junior-cognitive-assessment",
    ("university", "mrs"): "university-iq-preparation", ("university", "ca"): "university-cognitive-skills",
    ("manager", "mrs"): "manager-reasoning-score", ("manager", "ca"): "manager-cognitive-assessment",
    ("senior-manager", "mrs"): "senior-manager-reasoning-score", ("senior-manager", "ca"): "senior-manager-cognitive-assessment",
    ("c-level", "mrs"): "c-level-reasoning-score", ("c-level", "ca"): "c-level-cognitive-assessment",
}
LETTERS = "ABCDEFGH"

# ------------------------------------------------------------------ shapes (format 4 and 6)
SHAPES = ["circle", "triangle", "square", "pentagon", "hexagon", "star"]
SHAPE_AR = {"circle": "دائرة", "triangle": "مثلث", "square": "مربع", "pentagon": "خماسي", "hexagon": "سداسي", "star": "نجمة"}
FILLS = ["#ffffff", "#9aa3ad", "#1f2a37"]          # white, gray, black (ordered light to dark)
FILL_EN = ["white", "gray", "black"]; FILL_AR = ["أبيض", "رمادي", "أسود"]
SIZES = [0.55, 0.78, 1.0]                            # small, medium, large (ordered)
SIZE_EN = ["small", "medium", "large"]; SIZE_AR = ["صغير", "متوسط", "كبير"]
COUNTS = [1, 2, 3, 4]
LINES = [None, 0, 45, 90, 135]                       # inner line angle; None = no line
ATTR_VALUES = {"shape": list(range(6)), "fill": [0, 1, 2], "size": [0, 1, 2], "count": [0, 1, 2, 3], "line": [1, 2, 3, 4]}
ORDERED = {"fill", "size", "count", "line"}           # attributes that can progress
ATTR_EN = {"shape": "shape", "fill": "shading", "size": "size", "count": "number of shapes", "line": "angle of the line"}
ATTR_AR = {"shape": "نوع الشكل", "fill": "لون التظليل", "size": "حجم الشكل", "count": "عدد الأشكال", "line": "زاوية الخط"}


def poly_points(kind, r):
    if kind == "star":
        pts = []
        for i in range(10):
            a = -math.pi / 2 + i * math.pi / 5
            rr = r if i % 2 == 0 else r * 0.45
            pts.append((rr * math.cos(a), rr * math.sin(a)))
        return pts
    n = {"triangle": 3, "square": 4, "pentagon": 5, "hexagon": 6}[kind]
    off = -math.pi / 2 if kind != "square" else -math.pi / 4
    return [(r * math.cos(off + 2 * math.pi * i / n), r * math.sin(off + 2 * math.pi * i / n)) for i in range(n)]


def shape_svg(kind, cx, cy, r, fill):
    if kind == "circle":
        return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}" stroke="#1f2a37" stroke-width="2"/>'
    pts = " ".join(f"{cx + x:.1f},{cy + y:.1f}" for x, y in poly_points(kind, r))
    return f'<polygon points="{pts}" fill="{fill}" stroke="#1f2a37" stroke-width="2" stroke-linejoin="round"/>'


LAYOUT = {1: [(50, 50)], 2: [(30, 50), (70, 50)], 3: [(50, 30), (30, 68), (70, 68)], 4: [(30, 30), (70, 30), (30, 70), (70, 70)]}


def cell_svg(c, ox=0, oy=0):
    """c = dict(shape, fill, size, count, line) of value indexes; draws a 100x100 cell at (ox, oy)."""
    out = []
    line = LINES[c["line"]] if "line" in c else None
    if line is not None:
        a = math.radians(line)
        dx, dy = 46 * math.cos(a), -46 * math.sin(a)
        out.append(f'<line x1="{ox + 50 - dx:.1f}" y1="{oy + 50 - dy:.1f}" x2="{ox + 50 + dx:.1f}" y2="{oy + 50 + dy:.1f}" stroke="#c0841a" stroke-width="3"/>')
    n = COUNTS[c["count"]]
    base = 30 if n == 1 else 15
    r = base * SIZES[c["size"]]
    for (x, y) in LAYOUT[n]:
        out.append(shape_svg(SHAPES[c["shape"]], ox + x, oy + y, r, FILLS[c["fill"]]))
    return "".join(out)


def svg_wrap(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'


def single_cell_svg(c):
    return svg_wrap(100, 100, '<rect x="1" y="1" width="98" height="98" fill="#fff" stroke="#cfd6de" stroke-width="2" rx="6"/>' + cell_svg(c))


def matrix_svg(grid):
    body = ['<rect x="0" y="0" width="306" height="306" fill="#f6f7f9" rx="8"/>']
    for i in range(3):
        for j in range(3):
            ox, oy = 3 + j * 100 + j * 0, 3 + i * 100
            body.append(f'<rect x="{ox + 2}" y="{oy + 2}" width="96" height="96" fill="#fff" stroke="#cfd6de" stroke-width="2" rx="6"/>')
            if i == 2 and j == 2:
                body.append(f'<text x="{ox + 50}" y="{oy + 64}" font-size="44" font-family="Arial" font-weight="700" text-anchor="middle" fill="#c0841a">?</text>')
            else:
                body.append(cell_svg(grid[i][j], ox, oy))
    return svg_wrap(306, 306, "".join(body))


# ------------------------------------------------------------------ format 4: matrices
MATRIX_CFG = {
    # level: (number of rules, kinds allowed, min distribution rules, options)
    "junior": dict(n_rules=(1, 1), kinds=["progression", "row_constant"], min_dist=0, options=4),
    "university": dict(n_rules=(2, 2), kinds=["progression", "distribution", "row_constant"], min_dist=0, options=6),
    "manager": dict(n_rules=(2, 3), kinds=["progression", "distribution"], min_dist=1, options=6),
    "senior-manager": dict(n_rules=(3, 3), kinds=["progression", "distribution"], min_dist=1, options=8),
    "c-level": dict(n_rules=(4, 5), kinds=["progression", "distribution"], min_dist=2, options=8),
}


def matrix_difficulty(rules, options):
    d = 1.0
    for attr, kind in rules.items():
        d += {"progression": 1.2, "distribution": 1.6, "row_constant": 1.0}[kind]
        if attr == "line": d += 0.4
    if options >= 8: d += 0.7
    elif options >= 6: d += 0.3
    return round(min(d, 10.0), 1)


def build_matrix(rng, level):
    cfg = MATRIX_CFG[level]
    n = rng.randint(*cfg["n_rules"])
    attrs = ["shape", "fill", "size", "count", "line"]
    rng.shuffle(attrs)
    chosen = attrs[:n]
    rules = {}
    for a in chosen:
        kinds = [k for k in cfg["kinds"] if not (k == "progression" and a not in ORDERED)]
        rules[a] = rng.choice(kinds)
    if sum(1 for k in rules.values() if k == "distribution") < cfg["min_dist"]:
        for a in list(rules)[:cfg["min_dist"]]:
            rules[a] = "distribution"
    grid = [[{} for _ in range(3)] for _ in range(3)]
    for a in ["shape", "fill", "size", "count", "line"]:
        vals = ATTR_VALUES[a]
        kind = rules.get(a)
        if kind is None:
            v = rng.choice(vals)
            if a == "line" and rng.random() < 0.6:
                v = None
            for i in range(3):
                for j in range(3):
                    if v is not None: grid[i][j][a] = v
            continue
        if kind == "progression":
            step = rng.choice([1, -1])
            for i in range(3):
                lo, hi = (vals[0], vals[-1] - 2) if step == 1 else (vals[0] + 2, vals[-1])
                start = rng.randint(lo, hi)
                for j in range(3):
                    grid[i][j][a] = start + step * j
        elif kind == "distribution":
            three = rng.sample(vals, 3)
            shift = rng.choice([1, 2])
            for i in range(3):
                for j in range(3):
                    grid[i][j][a] = three[(j + shift * i) % 3]
        else:  # row_constant
            three = rng.sample(vals, 3)
            for i in range(3):
                for j in range(3):
                    grid[i][j][a] = three[i]
    answer = dict(grid[2][2])
    # distractors: change one attribute; first the rule attributes (harder), copy-neighbour trap
    opts = [answer]
    keys = set(answer)
    traps = [dict(grid[2][1]), dict(grid[1][2])]
    for t in traps:
        if t != answer and t not in opts and len(opts) < cfg["options"]:
            opts.append(t)
    tries = 0
    while len(opts) < cfg["options"] and tries < 200:
        tries += 1
        a = rng.choice(list(rules) if rng.random() < 0.75 else sorted(keys))
        d = dict(answer)
        choices = [v for v in ATTR_VALUES[a] if v != answer.get(a)]
        d[a] = rng.choice(choices)
        if a == "line" and "line" not in answer:
            continue
        if d not in opts:
            opts.append(d)
    if len(opts) < cfg["options"]:
        return None
    order = list(range(len(opts))); rng.shuffle(order)
    options = [opts[k] for k in order]
    ans_idx = order.index(0)
    diff = matrix_difficulty(rules, cfg["options"])
    lo, hi = LEVEL_BAND[level]
    if not (lo <= diff <= hi):
        return None
    exp_en, exp_ar = [], []
    for a, k in rules.items():
        if k == "progression":
            exp_en.append(f"The {ATTR_EN[a]} changes by one step from left to right in every row.")
            exp_ar.append(f"{ATTR_AR[a]} يتغير بدرجة واحدة من اليسار لليمين في كل صف.")
        elif k == "distribution":
            exp_en.append(f"Each row contains the same three values of {ATTR_EN[a]}, each once.")
            exp_ar.append(f"كل صف فيه نفس القيم الثلاث لـ{ATTR_AR[a]}، كل قيمة مرة واحدة.")
        else:
            exp_en.append(f"The {ATTR_EN[a]} stays the same within each row and changes between rows.")
            exp_ar.append(f"{ATTR_AR[a]} ثابت داخل كل صف ويتغير من صف لصف.")
    return {
        "format": 4, "format_name": "visual_matrix", "type": "mrs",
        "domain": {"junior": "Abstract Patterns", "university": "Abstract Reasoning", "manager": "Visual & Abstract Reasoning",
                   "senior-manager": "Abstract & Systems Patterns", "c-level": "Systems Thinking"}[level],
        "subdomain": "Matrix: " + ", ".join(f"{a} {k}" for a, k in rules.items()),
        "difficulty": diff,
        "stem_en": "Which option completes the pattern?", "stem_ar": "أي اختيار يكمل النمط؟",
        "stem_svg": matrix_svg(grid),
        "options": [{"svg": single_cell_svg(o)} for o in options],
        "answer_index": ans_idx,
        "explanation_en": " ".join(exp_en), "explanation_ar": " ".join(exp_ar),
        "data": {"grid": grid, "options": options, "rules": rules},
        "key": ("matrix", json.dumps(grid, sort_keys=True)),
    }


# ------------------------------------------------------------------ polyominoes (format 5 and 6)
def norm(cells):
    mx = min(x for x, y in cells); my = min(y for x, y in cells)
    return tuple(sorted((x - mx, y - my) for x, y in cells))


def rot(cells):            # 90 degrees clockwise on screen (y grows down)
    return norm([(-y, x) for x, y in cells])


def hflip(cells):          # mirror placed on the right side
    return norm([(-x, y) for x, y in cells])


def vflip(cells):
    return norm([(x, -y) for x, y in cells])


def rotations(cells):
    out = [norm(cells)]
    for _ in range(3): out.append(rot(out[-1]))
    return out


def canon(cells):
    return min(rotations(cells))


def random_poly(rng, n):
    cells = {(0, 0)}
    while len(cells) < n:
        x, y = rng.choice(sorted(cells))
        dx, dy = rng.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
        cells.add((x + dx, y + dy))
    return norm(cells)


def chiral(p):
    rs = rotations(p)
    return len(set(rs)) == 4 and hflip(p) not in rs


def poly_svg(cells, unit=18, pad=8, box=None):
    w = max(x for x, y in cells) + 1; h = max(y for x, y in cells) + 1
    size = box or (max(w, h) * unit + 2 * pad)
    ox = (size - w * unit) / 2; oy = (size - h * unit) / 2
    body = [f'<rect x="1" y="1" width="{size - 2}" height="{size - 2}" fill="#fff" stroke="#cfd6de" stroke-width="2" rx="6"/>']
    for x, y in cells:
        body.append(f'<rect x="{ox + x * unit:.1f}" y="{oy + y * unit:.1f}" width="{unit}" height="{unit}" fill="#1f3a5f" stroke="#fff" stroke-width="1.5"/>')
    return svg_wrap(size, size, "".join(body))


def poly_difficulty(n, options, kind):
    base = {"rotation": 0.6 * n + 0.2, "mirror": 0.45 * n, "odd_rotation": 0.6 * n}[kind]
    if options >= 6: base += 0.4
    return round(min(base, 10), 1)


def build_rotation(rng, level):
    n = {"university": rng.randint(5, 7), "manager": rng.randint(7, 8)}[level]
    options_n = 4 if level == "university" else 6
    p = random_poly(rng, n)
    if not chiral(p): return None
    k = rng.randint(1, 3)
    target = rotations(p)[k]
    mirrors = rotations(hflip(p))
    rng.shuffle(mirrors)
    opts = [target]
    for m in mirrors:
        if m not in opts and len(opts) < options_n: opts.append(m)
    # extra distractors at 6 options: mirror of a different random rotation already used; add near-miss shapes
    tries = 0
    while len(opts) < options_n and tries < 50:
        tries += 1
        q = list(p); i = rng.randrange(len(q)); q.pop(i)
        x, y = rng.choice(q); dx, dy = rng.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
        if (x + dx, y + dy) in q: continue
        q = norm(q + [(x + dx, y + dy)])
        if canon(q) == canon(p): continue
        if canon(q) != canon(p) and q not in opts: opts.append(rotations(q)[rng.randint(0, 3)])
    if len(opts) < options_n: return None
    order = list(range(len(opts))); rng.shuffle(order)
    options = [opts[i] for i in order]
    diff = poly_difficulty(n, options_n, "rotation")
    lo, hi = LEVEL_BAND[level]
    if not lo <= diff <= hi: return None
    box = max(max(max(x for x, y in o), max(y for x, y in o)) + 1 for o in options + [p]) * 18 + 16
    return {
        "format": 5, "format_name": "spatial_rotation", "type": "mrs",
        "domain": "Spatial Reasoning" if level == "university" else "Visual & Abstract Reasoning",
        "subdomain": f"2D rotation, {n} squares",
        "difficulty": diff,
        "stem_en": "Which option is the same shape only turned (rotated), not flipped?",
        "stem_ar": "أي اختيار هو نفس الشكل بعد تدويره فقط، من غير قلبه؟",
        "stem_svg": poly_svg(p, box=box),
        "options": [{"svg": poly_svg(o, box=box)} for o in options],
        "answer_index": order.index(0),
        "explanation_en": f"The correct option is the shape turned {90 * k} degrees clockwise. The other options are its mirror image (turned or not) or a different shape.",
        "explanation_ar": f"الاختيار الصحيح هو الشكل بعد تدويره {90 * k} درجة مع عقارب الساعة. باقي الاختيارات صورته في المرآة (مدورة أو لا) أو شكل مختلف.",
        "data": {"shape": p, "options": options, "rotation_k": k},
        "key": ("rot", str(canon(p)), k),
    }


def build_mirror(rng, level="junior"):
    n = rng.randint(4, 6)
    p = random_poly(rng, n)
    if not chiral(p): return None
    ans = hflip(p)
    cands = [p, rotations(p)[1], rotations(p)[2], rotations(p)[3]]
    rng.shuffle(cands)
    opts = [ans]
    for c in cands:
        if c != ans and c != vflip(p) and c not in opts and len(opts) < 4: opts.append(c)
    if len(opts) < 4: return None
    order = list(range(4)); rng.shuffle(order)
    options = [opts[i] for i in order]
    diff = poly_difficulty(n, 4, "mirror")
    if not 1 <= diff <= 3: return None
    box = max(max(max(x for x, y in o), max(y for x, y in o)) + 1 for o in options + [p]) * 18 + 16
    mirror = '<line x1="{0}" y1="4" x2="{0}" y2="{1}" stroke="#c0841a" stroke-width="4" stroke-dasharray="6 4"/>'.format(box + 10, box - 4)
    stem = svg_wrap(box + 20, box, poly_svg(p, box=box)[poly_svg(p, box=box).index(">") + 1:-6] + mirror)
    return {
        "format": 5, "format_name": "spatial_mirror", "type": "mrs",
        "domain": "Spatial Reasoning", "subdomain": f"mirror image, {n} squares", "difficulty": diff,
        "stem_en": "The dashed line is a mirror. Which option shows the shape as it appears in the mirror?",
        "stem_ar": "الخط المتقطع مرآة. أي اختيار يوضح الشكل زي ما هيظهر في المرآة؟",
        "stem_svg": stem,
        "options": [{"svg": poly_svg(o, box=box)} for o in options],
        "answer_index": order.index(0),
        "explanation_en": "In a mirror on the right, left and right swap but top and bottom stay the same.",
        "explanation_ar": "في المرآة اللي على اليمين، اليمين والشمال بيتبدلوا لكن الفوق والتحت بيفضلوا زي ما هم.",
        "data": {"shape": p, "options": options},
        "key": ("mir", str(p)),
    }


def build_odd_rotation(rng, level="university"):
    n = rng.randint(6, 7)
    p = random_poly(rng, n)
    if not chiral(p): return None
    rs = rotations(p); rng.shuffle(rs)
    same = rs[:4]
    odd = rotations(hflip(p))[rng.randint(0, 3)]
    opts = [odd] + same
    order = list(range(5)); rng.shuffle(order)
    options = [opts[i] for i in order]
    diff = poly_difficulty(n, 5, "odd_rotation")
    if not 3 <= diff <= 5: return None
    box = max(max(max(x for x, y in o), max(y for x, y in o)) + 1 for o in options) * 18 + 16
    return {
        "format": 6, "format_name": "odd_rotation", "type": "ca",
        "domain": "Visual-Spatial Perception", "subdomain": f"odd rotation, {n} squares", "difficulty": diff,
        "stem_en": "Four of these shapes are the same shape turned. Which one is different?",
        "stem_ar": "أربعة من الأشكال دي هي نفس الشكل بعد تدويره. أنهي شكل مختلف؟",
        "stem_svg": None,
        "options": [{"svg": poly_svg(o, box=box)} for o in options],
        "answer_index": order.index(0),
        "explanation_en": "The different shape is the mirror image; no rotation can turn it into the others.",
        "explanation_ar": "الشكل المختلف هو صورة الشكل في المرآة، ومفيش تدوير يخليه زي الباقيين.",
        "data": {"options": options},
        "key": ("oddrot", str(canon(p)), str(odd)),
    }


def build_odd_attr(rng, level="junior"):
    key_attr = rng.choice(["shape", "fill", "count"])
    figs = []
    shared = rng.choice(ATTR_VALUES[key_attr])
    odd_val = rng.choice([v for v in ATTR_VALUES[key_attr] if v != shared])
    for i in range(5):
        f = {}
        for a in ["shape", "fill", "size", "count"]:
            f[a] = rng.choice(ATTR_VALUES[a][:3]) if a == "count" else rng.choice(ATTR_VALUES[a])
        f[key_attr] = odd_val if i == 0 else shared
        figs.append(f)
    # reject if another attribute also splits 4 to 1 (ambiguous)
    for a in ["shape", "fill", "size", "count"]:
        if a == key_attr: continue
        vals = [f[a] for f in figs]
        for v in set(vals):
            if vals.count(v) == 4: return None
    if len({json.dumps(f, sort_keys=True) for f in figs}) < 5: return None
    order = list(range(5)); rng.shuffle(order)
    options = [figs[i] for i in order]
    diff = {"shape": 1.5, "fill": 1.8, "count": 2.4}[key_attr]
    return {
        "format": 6, "format_name": "odd_one_out", "type": "ca",
        "domain": "Visual Perception", "subdomain": f"odd one out by {key_attr}", "difficulty": diff,
        "stem_en": "Which figure is different from the others?", "stem_ar": "أنهي شكل مختلف عن الباقيين؟",
        "stem_svg": None,
        "options": [{"svg": single_cell_svg(o)} for o in options],
        "answer_index": order.index(0),
        "explanation_en": f"Four figures share the same {ATTR_EN[key_attr]}; the different one does not.",
        "explanation_ar": f"أربعة أشكال ليهم نفس {ATTR_AR[key_attr]}، والشكل المختلف لأ.",
        "data": {"options": options, "key_attr": key_attr},
        "key": ("odd", json.dumps(figs, sort_keys=True)),
    }


# ------------------------------------------------------------------ format 7: charts
MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"]
MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس"]
QUARTERS_EN = ["Q1-25", "Q2-25", "Q3-25", "Q4-25", "Q1-26", "Q2-26"]
QUARTERS_AR = ["ر1-25", "ر2-25", "ر3-25", "ر4-25", "ر1-26", "ر2-26"]
REGIONS_EN = ["North", "South", "East", "West", "Central"]
REGIONS_AR = ["الشمال", "الجنوب", "الشرق", "الغرب", "الوسط"]
SECTORS = [("sales", "المبيعات"), ("orders", "الطلبات"), ("new customers", "العملاء الجدد"), ("tickets closed", "التذاكر المغلقة"), ("shipments", "الشحنات")]


def bar_svg(labels, values, title, rtl=False, unit=""):
    W, H, L, B = 420, 260, 36, 40
    mx = max(values) * 1.15
    n = len(values); bw = (W - L - 20) / n
    body = [f'<rect width="{W}" height="{H}" fill="#fff"/>', f'<text x="{W / 2}" y="18" font-size="13" font-family="Arial" text-anchor="middle" fill="#1f2a37" font-weight="700">{title}</text>']
    body.append(f'<line x1="{L}" y1="{H - B}" x2="{W - 10}" y2="{H - B}" stroke="#8a94a0"/>')
    idx = list(range(n))[::-1] if rtl else list(range(n))
    for pos, i in enumerate(idx):
        v = values[i]; h = (H - B - 30) * v / mx
        x = L + pos * bw + bw * 0.18; y = H - B - h
        body.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw * 0.64:.1f}" height="{h:.1f}" fill="#1f3a5f" rx="2"/>')
        body.append(f'<text x="{x + bw * 0.32:.1f}" y="{y - 5:.1f}" font-size="12" font-family="Arial" text-anchor="middle" fill="#1f2a37" style="direction:ltr;unicode-bidi:bidi-override">{v}{unit}</text>')
        body.append(f'<text x="{x + bw * 0.32:.1f}" y="{H - B + 17:.1f}" font-size="12" font-family="Arial" text-anchor="middle" fill="#46505c">{labels[i]}</text>')
    return svg_wrap(W, H, "".join(body))


def line_svg(labels, series, names, title, rtl=False):
    W, H, L, B = 460, 280, 40, 50
    allv = [v for s in series for v in s]; mx = max(allv) * 1.15; mn = 0
    n = len(labels); step = (W - L - 30) / (n - 1)
    colors = ["#1f3a5f", "#c0841a"]
    body = [f'<rect width="{W}" height="{H}" fill="#fff"/>', f'<text x="{W / 2}" y="18" font-size="13" font-family="Arial" text-anchor="middle" fill="#1f2a37" font-weight="700">{title}</text>']
    body.append(f'<line x1="{L}" y1="{H - B}" x2="{W - 10}" y2="{H - B}" stroke="#8a94a0"/>')
    order = list(range(n))[::-1] if rtl else list(range(n))
    def px(i): return L + 10 + order.index(i) * step
    def py(v): return H - B - (H - B - 40) * (v - mn) / (mx - mn)
    for si, s in enumerate(series):
        pts = " ".join(f"{px(i):.1f},{py(v):.1f}" for i, v in enumerate(s))
        body.append(f'<polyline points="{pts}" fill="none" stroke="{colors[si]}" stroke-width="3"/>')
        for i, v in enumerate(s):
            body.append(f'<circle cx="{px(i):.1f}" cy="{py(v):.1f}" r="4" fill="{colors[si]}"/>')
            dy = -9 if si == 0 else 17
            body.append(f'<text x="{px(i):.1f}" y="{py(v) + dy:.1f}" font-size="11" font-family="Arial" text-anchor="middle" fill="{colors[si]}" stroke="#fff" stroke-width="3" paint-order="stroke" style="direction:ltr;unicode-bidi:bidi-override">{v}</text>')
    for i, lab in enumerate(labels):
        body.append(f'<text x="{px(i):.1f}" y="{H - B + 17}" font-size="12" font-family="Arial" text-anchor="middle" fill="#46505c">{lab}</text>')
    for si, nm in enumerate(names):
        x = L + 10 + si * 150
        body.append(f'<rect x="{x}" y="{H - 18}" width="14" height="4" fill="{colors[si]}"/><text x="{x + 20}" y="{H - 12}" font-size="12" font-family="Arial" fill="#1f2a37">{nm}</text>')
    return svg_wrap(W, H, "".join(body))


def fmt_pct(x):
    return f"{x:.1f}%" if abs(x - round(x)) > 1e-9 else f"{int(round(x))}%"


def num_options(rng, correct, wrongs, k, fmt):
    vals = [correct]
    for w in wrongs:
        if all(abs(w - v) > 0.05 for v in vals): vals.append(w)
    tries = 0
    while len(vals) < k and tries < 100:
        tries += 1
        w = round(correct + rng.choice([-1, 1]) * rng.choice([1, 1.5, 2, 3, 4, 5]) * max(1, abs(correct) * 0.06), 1)
        if all(abs(w - v) > 0.05 for v in vals): vals.append(w)
    vals = vals[:k]
    order = list(range(len(vals))); rng.shuffle(order)
    opts = [vals[i] for i in order]
    return [{"text_en": fmt(v), "text_ar": fmt(v)} for v in opts], order.index(0), opts


def build_bar(rng, level="manager"):
    n = rng.randint(5, 6)
    vals = [rng.randrange(40, 200) for _ in range(n)]
    sec_en, sec_ar = rng.choice(SECTORS)
    labels_en, labels_ar = MONTHS_EN[:n], MONTHS_AR[:n]
    q = rng.choice(["max_increase", "share", "pct_change"])
    total = sum(vals)
    if q == "max_increase":
        inc = [vals[i] - vals[i - 1] for i in range(1, n)]
        best = max(inc)
        if inc.count(best) > 1 or best <= 0: return None
        ans = inc.index(best) + 1
        top = vals.index(max(vals))
        pct = [(vals[i] - vals[i - 1]) / vals[i - 1] for i in range(1, n)]
        top_pct = pct.index(max(pct)) + 1
        cands = [ans]
        for c in [top, top_pct] + list(range(1, n)):
            if c not in cands and c != 0: cands.append(c)
        cands = cands[:4]
        order = list(range(4)); rng.shuffle(order)
        opts = [cands[i] for i in order]
        options = [{"text_en": labels_en[i], "text_ar": labels_ar[i]} for i in opts]
        ai = order.index(0); diff = 4.4
        stem_en = f"Which month had the largest increase in {sec_en} compared with the month before?"
        stem_ar = f"أي شهر سجل أكبر زيادة في {sec_ar} مقارنة بالشهر اللي قبله؟"
        exp_en = f"{labels_en[ans]}: {vals[ans]} - {vals[ans - 1]} = {best}, the largest monthly increase."
        exp_ar = f"{labels_ar[ans]}: {vals[ans]} - {vals[ans - 1]} = {best}، وهي أكبر زيادة شهرية."
        data = {"q": q, "values": vals, "answer": ans}
    elif q == "share":
        i = rng.randrange(n)
        correct = round(100 * vals[i] / total)
        wrongs = [round(100 * vals[i] / (total - vals[i])), round(100 * vals[i] / max(vals)), correct + 5]
        options, ai, raw = num_options(rng, correct, wrongs, 4, lambda v: f"{int(round(v))}%")
        if len({o["text_en"] for o in options}) < 4: return None
        diff = 4.8
        stem_en = f"Approximately what share of the total {sec_en} for the whole period came in {labels_en[i]}?"
        stem_ar = f"تقريبًا كام نسبة {sec_ar} في {labels_ar[i]} من إجمالي الفترة كلها؟"
        exp_en = f"{vals[i]} / {total} = {100 * vals[i] / total:.1f}%, about {correct}%."
        exp_ar = f"{vals[i]} / {total} = {100 * vals[i] / total:.1f}%، يعني حوالي {correct}%."
        data = {"q": q, "values": vals, "i": i, "answer": correct}
    else:
        a, b = sorted(rng.sample(range(n), 2))
        correct = round(100 * (vals[b] - vals[a]) / vals[a], 1)
        wrongs = [round(100 * (vals[b] - vals[a]) / vals[b], 1), -correct, round(vals[b] - vals[a], 1)]
        options, ai, raw = num_options(rng, correct, wrongs, 4, lambda v: (("+" if v > 0 else "") + fmt_pct(v)))
        if len({o["text_en"] for o in options}) < 4: return None
        diff = 5.4
        stem_en = f"By what percentage did {sec_en} change from {labels_en[a]} to {labels_en[b]}?"
        stem_ar = f"بكام في المية اتغيرت {sec_ar} من {labels_ar[a]} لـ {labels_ar[b]}؟"
        exp_en = f"({vals[b]} - {vals[a]}) / {vals[a]} x 100 = {correct}%. The base is the starting month."
        exp_ar = f"({vals[b]} - {vals[a]}) / {vals[a]} x 100 = {correct}%. الأساس هو شهر البداية."
        data = {"q": q, "values": vals, "a": a, "b": b, "answer": correct}
    return {
        "format": 7, "format_name": "bar_chart", "type": "ca",
        "domain": "Visual & Chart Reading", "subdomain": f"bar chart, {q}", "difficulty": diff,
        "stem_en": stem_en, "stem_ar": stem_ar,
        "stem_svg_en": bar_svg(labels_en, vals, sec_en.capitalize() + " by month"),
        "stem_svg_ar": bar_svg(labels_ar, vals, sec_ar + " حسب الشهر", rtl=True),
        "options": options, "answer_index": ai,
        "explanation_en": exp_en, "explanation_ar": exp_ar, "data": data,
        "key": ("bar", q, json.dumps(data, sort_keys=True)),
    }


def build_line(rng, level="senior-manager"):
    n = 6
    rev = [rng.randrange(300, 900) for _ in range(n)]
    cost = [int(r * rng.uniform(0.55, 0.92)) for r in rev]
    prof = [r - c for r, c in zip(rev, cost)]
    margin = [p / r for p, r in zip(prof, rev)]
    q = rng.choice(["best_margin", "profit_growth", "cost_faster"])
    names_en, names_ar = ["Revenue", "Cost"], ["الإيرادات", "التكاليف"]
    if q == "best_margin":
        best = max(margin); ans = margin.index(best)
        if sum(1 for m in margin if abs(m - best) < 0.005) > 1: return None
        trap = prof.index(max(prof))
        if trap == ans: return None
        cands = [ans, trap, rev.index(max(rev))] + list(range(n))
        uniq = []
        for c in cands:
            if c not in uniq: uniq.append(c)
        cands = uniq[:4]
        order = list(range(4)); rng.shuffle(order); opts = [cands[i] for i in order]
        options = [{"text_en": QUARTERS_EN[i], "text_ar": QUARTERS_AR[i]} for i in opts]
        ai = order.index(0); diff = 6.4
        stem_en = "In which quarter was the profit margin (profit as a share of revenue) highest?"
        stem_ar = "في أنهي ربع كان هامش الربح (الربح كنسبة من الإيرادات) الأعلى؟"
        exp_en = f"{QUARTERS_EN[ans]}: ({rev[ans]} - {cost[ans]}) / {rev[ans]} = {100 * best:.1f}%. The highest profit in money ({QUARTERS_EN[trap]}) is not the highest margin."
        exp_ar = f"{QUARTERS_AR[ans]}: ({rev[ans]} - {cost[ans]}) / {rev[ans]} = {100 * best:.1f}%. أعلى ربح بالفلوس ({QUARTERS_AR[trap]}) مش هو أعلى هامش."
        data = {"q": q, "rev": rev, "cost": cost, "answer": ans}
    elif q == "profit_growth":
        a, b = sorted(rng.sample(range(n), 2))
        if prof[a] <= 0: return None
        correct = round(100 * (prof[b] - prof[a]) / prof[a], 1)
        wrongs = [round(100 * (rev[b] - rev[a]) / rev[a], 1), round(100 * (prof[b] - prof[a]) / prof[b], 1) if prof[b] else correct + 7, -correct]
        options, ai, raw = num_options(rng, correct, wrongs, 5, lambda v: (("+" if v > 0 else "") + fmt_pct(v)))
        if len({o["text_en"] for o in options}) < 5: return None
        diff = 6.8
        stem_en = f"By what percentage did profit (revenue minus cost) change from {QUARTERS_EN[a]} to {QUARTERS_EN[b]}?"
        stem_ar = f"بكام في المية اتغير الربح (الإيرادات ناقص التكاليف) من {QUARTERS_AR[a]} لـ {QUARTERS_AR[b]}؟"
        exp_en = f"Profit {QUARTERS_EN[a]} = {prof[a]}, {QUARTERS_EN[b]} = {prof[b]}; ({prof[b]} - {prof[a]}) / {prof[a]} x 100 = {correct}%."
        exp_ar = f"الربح {QUARTERS_AR[a]} = {prof[a]}، {QUARTERS_AR[b]} = {prof[b]}؛ ({prof[b]} - {prof[a]}) / {prof[a]} x 100 = {correct}%."
        data = {"q": q, "rev": rev, "cost": cost, "a": a, "b": b, "answer": correct}
    else:
        cnt = sum(1 for i in range(1, n) if (cost[i] - cost[i - 1]) / cost[i - 1] > (rev[i] - rev[i - 1]) / rev[i - 1])
        cands = [cnt] + [c for c in [cnt - 1, cnt + 1, cnt + 2, cnt - 2, cnt + 3] if 0 <= c <= 5]
        cands = cands[:5]
        if len(cands) < 4: return None
        order = list(range(len(cands))); rng.shuffle(order); opts = [cands[i] for i in order]
        options = [{"text_en": str(v), "text_ar": str(v)} for v in opts]
        ai = order.index(0); diff = 7.2
        stem_en = "Compared with the quarter before, in how many quarters did cost grow faster (in %) than revenue?"
        stem_ar = "مقارنة بالربع اللي قبله، في كام ربع زادت التكاليف بنسبة أسرع من الإيرادات؟"
        exp_en = f"Compare the % change of cost and revenue each quarter from {QUARTERS_EN[1]} to {QUARTERS_EN[-1]}; cost grew faster in {cnt} quarter(s)."
        exp_ar = f"قارن نسبة تغير التكاليف والإيرادات كل ربع من {QUARTERS_AR[1]} لـ {QUARTERS_AR[-1]}؛ التكاليف زادت أسرع في {cnt} ربع."
        data = {"q": q, "rev": rev, "cost": cost, "answer": cnt}
    return {
        "format": 7, "format_name": "line_chart", "type": "ca",
        "domain": "Visual & Dashboard Reading", "subdomain": f"two-series line chart, {q}", "difficulty": diff,
        "stem_en": stem_en, "stem_ar": stem_ar,
        "stem_svg_en": line_svg(QUARTERS_EN, [rev, cost], names_en, "Revenue and cost by quarter"),
        "stem_svg_ar": line_svg(QUARTERS_AR, [rev, cost], names_ar, "الإيرادات والتكاليف حسب الربع", rtl=True),
        "options": options, "answer_index": ai,
        "explanation_en": exp_en, "explanation_ar": exp_ar, "data": data,
        "key": ("line", q, json.dumps(data, sort_keys=True)),
    }


def dash_svg(regions, rev, margin, growth, rtl=False, ar=False):
    W, H = 640, 250
    t = (["الإيرادات (مليون)", "هامش التشغيل %", "نمو سنوي %"] if ar else ["Revenue (million)", "Operating margin %", "Annual growth %"])
    body = [f'<rect width="{W}" height="{H}" fill="#f6f7f9" rx="8"/>']
    panels = [(rev, ""), ([int(m) for m in margin], "%"), ([int(g) for g in growth], "%")]
    for pi, (vals, unit) in enumerate(panels):
        ox = 10 + pi * 210
        body.append(f'<rect x="{ox}" y="10" width="200" height="232" fill="#fff" stroke="#dde3ea" rx="6"/>')
        body.append(f'<text x="{ox + 100}" y="30" font-size="12" font-family="Arial" text-anchor="middle" font-weight="700" fill="#1f2a37">{t[pi]}</text>')
        hi = max(max(vals), 1) * 1.2; lo = min(0, min(vals)) * 1.2; n = len(vals); bw = 180 / n
        top, bot = 50, 205
        def yv(v): return top + (bot - top) * (hi - v) / (hi - lo)
        y0 = yv(0)
        body.append(f'<line x1="{ox + 8}" y1="{y0:.1f}" x2="{ox + 192}" y2="{y0:.1f}" stroke="#8a94a0"/>')
        order = list(range(n))[::-1] if rtl else list(range(n))
        for pos, i in enumerate(order):
            v = vals[i]; x = ox + 10 + pos * bw + bw * 0.15
            y1, y2 = (yv(v), y0) if v >= 0 else (y0, yv(v))
            body.append(f'<rect x="{x:.1f}" y="{y1:.1f}" width="{bw * 0.7:.1f}" height="{max(y2 - y1, 1):.1f}" fill="{["#1f3a5f", "#2f7d6d", "#c0841a"][pi]}" rx="2"/>')
            ty = y1 - 4 if v >= 0 else y2 + 12
            body.append(f'<text x="{x + bw * 0.35:.1f}" y="{ty:.1f}" font-size="11" font-family="Arial" text-anchor="middle" fill="#1f2a37" style="direction:ltr;unicode-bidi:bidi-override">{v}{unit}</text>')
            body.append(f'<text x="{x + bw * 0.35:.1f}" y="232" font-size="11" font-family="Arial" text-anchor="middle" fill="#46505c">{regions[i]}</text>')
    return svg_wrap(W, H, "".join(body))


def build_dashboard(rng, level="c-level", qset=("top_profit",)):
    n = 4
    rev = [rng.randrange(40, 160) for _ in range(n)]
    margin = [rng.randrange(6, 30) for _ in range(n)]
    growth = [rng.randrange(-4, 25) for _ in range(n)]
    q = rng.choice(list(qset))
    prof = [r * m / 100 for r, m in zip(rev, margin)]
    REN, RAR = REGIONS_EN[:n], REGIONS_AR[:n]
    if q == "top_profit":
        best = max(prof); ans = prof.index(best)
        if sum(1 for p in prof if abs(p - best) < 0.6) > 1: return None
        if ans == rev.index(max(rev)) or ans == margin.index(max(margin)): return None
        order = list(range(4)); rng.shuffle(order)
        options = [{"text_en": REN[i], "text_ar": RAR[i]} for i in order]
        ai = order.index(ans); diff = 7.6; typ = "ca"; dom = "Visual & Dashboard Insight"
        stem_en = "Which region generates the highest operating profit in money?"
        stem_ar = "أنهي منطقة بتحقق أعلى ربح تشغيلي بالفلوس؟"
        exp_en = "Profit = revenue x margin: " + ", ".join(f"{REN[i]} {rev[i]} x {margin[i]}% = {prof[i]:.1f}" for i in range(n)) + ". Neither the largest revenue nor the highest margin alone decides it."
        exp_ar = "الربح = الإيرادات × الهامش: " + "، ".join(f"{RAR[i]} {rev[i]} × {margin[i]}% = {prof[i]:.1f}" for i in range(n)) + ". لا أكبر إيرادات ولا أعلى هامش لوحده هو اللي بيحدد."
    elif q == "projection":
        fut = [r * (1 + g / 100) ** 2 for r, g in zip(rev, growth)]
        best = max(fut); ans = fut.index(best)
        if sum(1 for f in fut if abs(f - best) < 0.8) > 1: return None
        if ans == rev.index(max(rev)): return None
        order = list(range(4)); rng.shuffle(order)
        options = [{"text_en": REN[i], "text_ar": RAR[i]} for i in order]
        ai = order.index(ans); diff = 8.4; typ = "mrs"; dom = "Financial Indicators Reasoning"
        stem_en = "If each region keeps its annual growth rate for two more years, which region will have the highest revenue?"
        stem_ar = "لو كل منطقة حافظت على معدل نموها السنوي لمدة سنتين كمان، أنهي منطقة هيكون عندها أعلى إيرادات؟"
        exp_en = "Revenue in 2 years = revenue x (1 + growth)^2: " + ", ".join(f"{REN[i]} {fut[i]:.1f}" for i in range(n)) + ". Today's leader is not the leader in two years."
        exp_ar = "الإيرادات بعد سنتين = الإيرادات × (1 + النمو)^2: " + "، ".join(f"{RAR[i]} {fut[i]:.1f}" for i in range(n)) + ". المتصدر النهارده مش هو المتصدر بعد سنتين."
    else:  # weighted margin
        correct = round(100 * sum(prof) / sum(rev), 1)
        simple = round(sum(margin) / n, 1)
        if abs(correct - simple) < 1.0: return None
        options, ai, raw = num_options(rng, correct, [simple, round(max(margin) - min(margin), 1), round(correct + 2.5, 1)], 5, fmt_pct)
        if len({o["text_en"] for o in options}) < 5: return None
        diff = 8.0; typ = "mrs"; dom = "Financial Indicators Reasoning"
        stem_en = "What is the company's overall operating margin across the four regions?"
        stem_ar = "إيه هامش التشغيل الإجمالي للشركة في المناطق الأربعة؟"
        exp_en = f"Total profit {sum(prof):.1f} / total revenue {sum(rev)} = {correct}%. The simple average of the margins ({simple}%) ignores region size."
        exp_ar = f"إجمالي الربح {sum(prof):.1f} / إجمالي الإيرادات {sum(rev)} = {correct}%. المتوسط البسيط للهوامش ({simple}%) بيتجاهل حجم كل منطقة."
    data = {"q": q, "rev": rev, "margin": margin, "growth": growth}
    return {
        "format": 7, "format_name": "dashboard", "type": typ, "domain": dom,
        "subdomain": f"executive dashboard, {q}", "difficulty": diff,
        "stem_en": stem_en, "stem_ar": stem_ar,
        "stem_svg_en": dash_svg(REN, rev, margin, growth),
        "stem_svg_ar": dash_svg(RAR, rev, margin, growth, rtl=True, ar=True),
        "options": options, "answer_index": ai,
        "explanation_en": exp_en, "explanation_ar": exp_ar, "data": data,
        "key": ("dash", q, json.dumps(data, sort_keys=True)),
    }


# ------------------------------------------------------------------ format 8: heat map
def heat_svg(grid, rows, cols, title, rtl=False):
    R, C = len(grid), len(grid[0]); cw, ch, L, T = 70, 34, 90, 40
    W, H = L + C * cw + 10, T + R * ch + 10
    lo = min(min(r) for r in grid); hi = max(max(r) for r in grid)
    body = [f'<rect width="{W}" height="{H}" fill="#fff"/>', f'<text x="{W / 2}" y="20" font-size="13" font-family="Arial" text-anchor="middle" font-weight="700" fill="#1f2a37">{title}</text>']
    order = list(range(C))[::-1] if rtl else list(range(C))
    for pos, j in enumerate(order):
        body.append(f'<text x="{L + pos * cw + cw / 2}" y="{T - 6}" font-size="12" font-family="Arial" text-anchor="middle" fill="#46505c">{cols[j]}</text>')
    for i in range(R):
        body.append(f'<text x="{L - 8}" y="{T + i * ch + ch / 2 + 4}" font-size="12" font-family="Arial" text-anchor="end" fill="#46505c">{rows[i]}</text>')
        for pos, j in enumerate(order):
            t = (grid[i][j] - lo) / (hi - lo or 1)
            col = f"rgb({int(255 - 150 * t)},{int(245 - 120 * t)},{int(235 - 60 * t)})"
            body.append(f'<rect x="{L + pos * cw}" y="{T + i * ch}" width="{cw - 2}" height="{ch - 2}" fill="{col}" rx="3"/>')
            body.append(f'<text x="{L + pos * cw + cw / 2 - 1}" y="{T + i * ch + ch / 2 + 4}" font-size="12" font-family="Arial" text-anchor="middle" fill="#1f2a37" style="direction:ltr;unicode-bidi:bidi-override">{grid[i][j]}</text>')
    return svg_wrap(W, H, "".join(body))


def build_heatmap(rng, level="senior-manager"):
    R, C = 5, 5
    grid = []
    for i in range(R):
        base = rng.randrange(20, 120); step = rng.choice([-6, -5, -4, -3, 3, 4, 5, 6, 7, 8])
        if base + step * 4 <= 2: step = abs(step)
        grid.append([base + step * j for j in range(C)])
    ai_r, ai_c = rng.randrange(R), rng.randrange(C)
    delta = rng.choice([-1, 1]) * rng.randrange(2, 9)
    grid[ai_r][ai_c] += delta
    if grid[ai_r][ai_c] <= 0: return None
    cols_en = ["W1", "W2", "W3", "W4", "W5"]; cols_ar = ["أ1", "أ2", "أ3", "أ4", "أ5"]
    rows_en = ["Branch A", "Branch B", "Branch C", "Branch D", "Branch E"]; rows_ar = ["فرع أ", "فرع ب", "فرع ج", "فرع د", "فرع هـ"]
    cands = [(ai_r, ai_c)]
    while len(cands) < 5:
        c = (min(R - 1, max(0, ai_r + rng.choice([-1, 0, 1]))), rng.randrange(C))
        if c not in cands: cands.append(c)
    order = list(range(5)); rng.shuffle(order); opts = [cands[i] for i in order]
    options = [{"text_en": f"{rows_en[r]}, {cols_en[c]}", "text_ar": f"{rows_ar[r]}، {cols_ar[c]}"} for r, c in opts]
    expected = grid[ai_r][ai_c] - delta
    return {
        "format": 8, "format_name": "heatmap_anomaly", "type": "ca",
        "domain": "Sustained Attention under Load", "subdomain": "heat map, value breaking its row pattern",
        "difficulty": 6.2,
        "stem_en": "Each branch's weekly values follow a steady pattern, except one value that was entered wrongly. Which one?",
        "stem_ar": "قيم كل فرع الأسبوعية ماشية بنمط ثابت، ما عدا قيمة واحدة اتسجلت غلط. أنهي واحدة؟",
        "stem_svg_en": heat_svg(grid, rows_en, cols_en, "Weekly orders by branch"),
        "stem_svg_ar": heat_svg(grid, rows_ar, cols_ar, "الطلبات الأسبوعية حسب الفرع", rtl=True),
        "options": options, "answer_index": order.index(0),
        "explanation_en": f"{rows_en[ai_r]} grows by a fixed step each week; {cols_en[ai_c]} should be {expected}, not {grid[ai_r][ai_c]}.",
        "explanation_ar": f"{rows_ar[ai_r]} بيزيد بخطوة ثابتة كل أسبوع؛ {cols_ar[ai_c]} المفروض تكون {expected} مش {grid[ai_r][ai_c]}.",
        "data": {"grid": grid, "answer": [ai_r, ai_c], "options": opts},
        "key": ("heat", json.dumps(grid)),
    }


# ------------------------------------------------------------------ plan and run
PLAN = [
    # level, builder, count
    ("junior", lambda r: build_matrix(r, "junior"), 150),
    ("junior", lambda r: build_mirror(r), 100),
    ("junior", lambda r: build_odd_attr(r), 150),
    ("university", lambda r: build_matrix(r, "university"), 150),
    ("university", lambda r: build_rotation(r, "university"), 100),
    ("university", lambda r: build_odd_rotation(r), 100),
    ("manager", lambda r: build_matrix(r, "manager"), 150),
    ("manager", lambda r: build_rotation(r, "manager"), 50),
    ("manager", lambda r: build_bar(r), 150),
    ("senior-manager", lambda r: build_matrix(r, "senior-manager"), 150),
    ("senior-manager", lambda r: build_line(r), 100),
    ("senior-manager", lambda r: build_heatmap(r), 100),
    ("c-level", lambda r: build_dashboard(r, qset=("projection", "weighted_margin")), 150),
    ("c-level", lambda r: build_dashboard(r, qset=("top_profit",)), 150),
]


def main():
    out = sys.argv[1]
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 261126
    scale = float(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 1.0
    rng = random.Random(seed)
    os.makedirs(out, exist_ok=True)
    seen = set(); by_level = {}; counters = {}
    for level, build, count in PLAN:
        target = int(count * scale); made = 0; tries = 0
        while made < target and tries < target * 400:
            tries += 1
            it = build(rng)
            if not it: continue
            k = hashlib.sha1(json.dumps(it.pop("key")).encode()).hexdigest()[:16]
            if k in seen: continue
            seen.add(k)
            counters[(level, it["type"], it["format"])] = counters.get((level, it["type"], it["format"]), 0) + 1
            n = sum(v for (lv, t, f), v in counters.items() if lv == level and t == it["type"])
            item = {
                "id": f"V-{level.upper().replace('-', '')[:3]}-{it['type'].upper()}-{n:05d}",
                "exam_id": EXAM_ID[(level, it["type"])], "exam_type": it["type"].upper(), "level": level,
                "status": "draft", "source": "code-generated v1 (OMS-MND-261126-17)", "fingerprint": k,
                "allowed_levels": [level], "languages": ["en", "ar"],
            }
            item.update(it)
            by_level.setdefault(level, []).append(item)
            made += 1
        if made < target:
            print(f"WARN {level} {build}: made {made}/{target}", file=sys.stderr)
    summary = {}
    for level, items in by_level.items():
        with open(os.path.join(out, f"{level}.jsonl"), "w", encoding="utf-8") as f:
            for it in items: f.write(json.dumps(it, ensure_ascii=False) + "\n")
        for it in items:
            key = f"{it['exam_id']} | format {it['format']} {it['format_name']} | {it['domain']}"
            s = summary.setdefault(key, {"count": 0, "difficulty_min": 10, "difficulty_max": 0, "difficulty_sum": 0})
            s["count"] += 1; s["difficulty_min"] = min(s["difficulty_min"], it["difficulty"]); s["difficulty_max"] = max(s["difficulty_max"], it["difficulty"]); s["difficulty_sum"] += it["difficulty"]
    for s in summary.values():
        s["difficulty_avg"] = round(s.pop("difficulty_sum") / s["count"], 2)
    with open(os.path.join(out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump({"seed": seed, "total": sum(len(v) for v in by_level.values()), "groups": summary}, f, ensure_ascii=False, indent=1)
    print(json.dumps({"total": sum(len(v) for v in by_level.values()), "by_level": {k: len(v) for k, v in by_level.items()}}))


if __name__ == "__main__":
    main()
