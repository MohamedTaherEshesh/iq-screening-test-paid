#!/usr/bin/env python3
"""OMS-MND-261126-17 independent verifier for the visual bank.

Re-derives every answer from the item's data without using the generator code, and checks:
one and only one correct option, distinct options, difficulty inside the level band,
both languages present. Exit code 1 if any item fails.

Usage: python3 verify.py DIR
"""
import glob, json, os, sys

BAND = {"junior": (1, 3), "university": (3, 5), "manager": (4, 6), "senior-manager": (5, 8), "c-level": (7, 10)}


def n(cells):
    cells = [tuple(c) for c in cells]
    mx = min(x for x, y in cells); my = min(y for x, y in cells)
    return tuple(sorted((x - mx, y - my) for x, y in cells))


def turn(c):
    return n([(-y, x) for x, y in c])


def all_turns(c):
    out = [n(c)]
    for _ in range(3): out.append(turn(out[-1]))
    return set(out)


def flip_lr(c):
    return n([(-x, y) for x, y in c])


def infer_cell(grid, attr):
    """Infer grid[2][2][attr] from the other 8 cells using only rows 1 and 2 as evidence."""
    rows = [[grid[i][j].get(attr) for j in range(3)] for i in range(3)]
    r0, r1, r2 = rows
    if r0[0] is None:
        return None
    if r0[0] == r0[1] == r0[2] and r1[0] == r1[1] == r1[2]:
        if r0[0] == r1[0]:
            return r2[0]                       # constant everywhere (or row constant); third row is its own value
        return r2[0]                           # row constant
    d0, d1 = r0[1] - r0[0], r1[1] - r1[0]
    if r0[2] - r0[1] == d0 and r1[2] - r1[1] == d1 and d0 == d1 and d0 != 0:
        return r2[1] + d0                      # progression
    if sorted(r0) == sorted(r1) and len(set(r0)) == 3:
        missing = set(r0) - {r2[0], r2[1]}
        if len(missing) == 1:
            return missing.pop()               # distribution of three
    raise ValueError(f"no rule found for {attr}: {rows}")


def check_matrix(it):
    g = it["data"]["grid"]; opts = it["data"]["options"]
    want = {}
    for a in ["shape", "fill", "size", "count", "line"]:
        v = infer_cell(g, a)
        if v is not None: want[a] = v
    hits = [i for i, o in enumerate(opts) if o == want]
    assert hits == [it["answer_index"]], f"matrix answer {hits} vs {it['answer_index']}"
    assert len({json.dumps(o, sort_keys=True) for o in opts}) == len(opts), "duplicate options"


def check_rotation(it):
    p = it["data"]["shape"]; opts = it["data"]["options"]
    rots = all_turns(p)
    hits = [i for i, o in enumerate(opts) if n(o) in rots]
    assert hits == [it["answer_index"]], f"rotation answer {hits}"


def check_mirror(it):
    p = it["data"]["shape"]; opts = it["data"]["options"]
    want = flip_lr(p)
    hits = [i for i, o in enumerate(opts) if n(o) == want]
    assert hits == [it["answer_index"]], f"mirror answer {hits}"
    vflipped = n([(x, -y) for x, y in p])
    assert not any(n(o) == vflipped for o in opts), "a vertical flip is also a valid mirror"


def check_odd_rotation(it):
    opts = it["data"]["options"]
    groups = {}
    for i, o in enumerate(opts):
        groups.setdefault(min(all_turns(o)), []).append(i)
    singles = [v[0] for v in groups.values() if len(v) == 1]
    assert len(groups) == 2 and singles == [it["answer_index"]], f"odd rotation groups {groups}"


def check_odd_attr(it):
    opts = it["data"]["options"]
    splits = []
    for a in ["shape", "fill", "size", "count"]:
        vals = [o[a] for o in opts]
        for v in set(vals):
            if vals.count(v) == 4:
                odd = [i for i, x in enumerate(vals) if x != v]
                splits.append((a, odd[0]))
    assert len(splits) == 1 and splits[0][1] == it["answer_index"], f"odd attr splits {splits}"


def opt_value(it, i):
    return it["options"][i]["text_en"]


def check_chart(it):
    d = it["data"]; q = d["q"]
    if it["format_name"] == "bar_chart":
        v = d["values"]
        if q == "max_increase":
            inc = [v[i] - v[i - 1] for i in range(1, len(v))]
            assert inc.count(max(inc)) == 1
            months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"]
            assert opt_value(it, it["answer_index"]) == months[inc.index(max(inc)) + 1]
        elif q == "share":
            want = f"{round(100 * v[d['i']] / sum(v))}%"
            assert opt_value(it, it["answer_index"]) == want, (opt_value(it, it["answer_index"]), want)
        else:
            x = round(100 * (v[d["b"]] - v[d["a"]]) / v[d["a"]], 1)
            s = (f"{x:.1f}%" if abs(x - round(x)) > 1e-9 else f"{int(round(x))}%")
            assert opt_value(it, it["answer_index"]) == ("+" if x > 0 else "") + s
    elif it["format_name"] == "line_chart":
        rev, cost = d["rev"], d["cost"]
        if q == "best_margin":
            m = [(r - c) / r for r, c in zip(rev, cost)]
            assert opt_value(it, it["answer_index"]) == ["Q1-25", "Q2-25", "Q3-25", "Q4-25", "Q1-26", "Q2-26"][m.index(max(m))]
        elif q == "profit_growth":
            p = [r - c for r, c in zip(rev, cost)]
            x = round(100 * (p[d["b"]] - p[d["a"]]) / p[d["a"]], 1)
            s = (f"{x:.1f}%" if abs(x - round(x)) > 1e-9 else f"{int(round(x))}%")
            assert opt_value(it, it["answer_index"]) == ("+" if x > 0 else "") + s
        else:
            cnt = sum(1 for i in range(1, len(rev)) if (cost[i] - cost[i - 1]) / cost[i - 1] > (rev[i] - rev[i - 1]) / rev[i - 1])
            assert opt_value(it, it["answer_index"]) == str(cnt)
    else:  # dashboard
        rev, mar, gr = d["rev"], d["margin"], d["growth"]
        regions = ["North", "South", "East", "West", "Central"]
        if q == "top_profit":
            p = [r * m for r, m in zip(rev, mar)]
            assert opt_value(it, it["answer_index"]) == regions[p.index(max(p))]
        elif q == "projection":
            f = [r * (1 + g / 100) ** 2 for r, g in zip(rev, gr)]
            assert opt_value(it, it["answer_index"]) == regions[f.index(max(f))]
        else:
            x = round(100 * sum(r * m / 100 for r, m in zip(rev, mar)) / sum(rev), 1)
            s = (f"{x:.1f}%" if abs(x - round(x)) > 1e-9 else f"{int(round(x))}%")
            assert opt_value(it, it["answer_index"]) == s


def check_heat(it):
    g = it["data"]["grid"]
    found = []
    for i, row in enumerate(g):
        for j in range(len(row)):
            pts = [(k, row[k]) for k in range(len(row)) if k != j]
            (x0, y0), (x1, y1) = pts[0], pts[1]
            s = (y1 - y0) / (x1 - x0)
            if all(abs(y - (y0 + s * (x - x0))) < 1e-9 for x, y in pts) and abs(row[j] - (y0 + s * (j - x0))) > 1e-9:
                found.append((i, j))
    assert len(found) == 1, f"heat anomalies {found}"
    r, c = found[0]
    rows = ["Branch A", "Branch B", "Branch C", "Branch D", "Branch E"]; cols = ["W1", "W2", "W3", "W4", "W5"]
    assert opt_value(it, it["answer_index"]) == f"{rows[r]}, {cols[c]}"


CHECKS = {"visual_matrix": check_matrix, "spatial_rotation": check_rotation, "spatial_mirror": check_mirror,
          "odd_rotation": check_odd_rotation, "odd_one_out": check_odd_attr, "bar_chart": check_chart,
          "line_chart": check_chart, "dashboard": check_chart, "heatmap_anomaly": check_heat}


def main():
    d = sys.argv[1]; total = 0; bad = 0; ids = set()
    for path in sorted(glob.glob(os.path.join(d, "*.jsonl"))):
        for line in open(path, encoding="utf-8"):
            it = json.loads(line); total += 1
            try:
                assert it["id"] not in ids, "duplicate id"; ids.add(it["id"])
                lo, hi = BAND[it["level"]]
                assert lo <= it["difficulty"] <= hi, f"difficulty {it['difficulty']} outside {lo}-{hi}"
                assert it["stem_en"] and it["stem_ar"] and it["explanation_en"] and it["explanation_ar"], "missing language"
                assert 0 <= it["answer_index"] < len(it["options"]) and len(it["options"]) >= 4, "options"
                keys = [o.get("svg") or o.get("text_en") for o in it["options"]]
                assert len(set(keys)) == len(keys), "duplicate option rendering"
                CHECKS[it["format_name"]](it)
            except AssertionError as e:
                bad += 1
                print(f"FAIL {it.get('id')}: {e}")
            except Exception as e:  # noqa: BLE001
                bad += 1
                print(f"ERROR {it.get('id')}: {type(e).__name__} {e}")
    print(f"verified {total} items, {total - bad} passed, {bad} failed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
