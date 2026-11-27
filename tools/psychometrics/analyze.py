"""OMS-MND-261126-22 classical item and test analysis for MindProof exams (read-only, standard library only).

Input: CSV from export.sql (one row per candidate x question). Output: Markdown report + JSON, per exam.
Per item: N, difficulty (p), corrected item-rest point-biserial, omit rate, median visible seconds,
rapid-response share (< RAPID seconds), flags. Per test: N, mean, SD, KR-20, SEM.
Fairness: Mantel-Haenszel DIF (ETS delta, A/B/C) by gender (male vs female; 'undisclosed' excluded)
and by language (en vs ar), matched on rest score. Results with too few candidates are marked, not hidden.
References: Crocker & Algina (1986) item analysis; Kuder & Richardson (1937) KR-20;
Holland & Thayer (1988) Mantel-Haenszel DIF; ETS delta classification (Zieky, 1993).
Usage: python3 analyze.py responses.csv --out report  (writes report.md and report.json)
"""
import csv, json, math, statistics, sys, argparse
from collections import defaultdict

RAPID = 3.0          # seconds; responses faster than this are flagged as possible rapid guessing
MIN_N_ITEM = 30      # below this, item statistics are marked provisional
MIN_N_DIF = 100      # minimum candidates per group for DIF to be reported as reliable

def load(path):
    rows = list(csv.DictReader(open(path, newline='', encoding='utf-8')))
    exams = defaultdict(lambda: {'cand': {}, 'items': {}})
    for r in rows:
        e = exams[r['exam_tag']]
        c = e['cand'].setdefault(r['session_id'], {'gender': r.get('gender') or 'undisclosed', 'language': r.get('language') or '', 'resp': {}})
        key = f"{r['item_code']}@v{r.get('item_version') or 1}"
        e['items'].setdefault(key, [])
        corr = r.get('correct', '')
        c['resp'][key] = {'x': None if corr == '' else int(corr), 't': float(r['visible_seconds']) if r.get('visible_seconds') not in (None, '') else None,
                          'ft': float(r['seconds_to_first_answer']) if r.get('seconds_to_first_answer') not in (None, '') else None}
    return exams

def pearson(a, b):
    n = len(a)
    if n < 3: return None
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a); vb = sum((y - mb) ** 2 for y in b)
    if va == 0 or vb == 0: return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)

def mh_dif(cands, key, grp_of, ref, foc):
    """Mantel-Haenszel common odds ratio matched on rest score; returns (delta, n_ref, n_foc, class)."""
    strata = defaultdict(lambda: [0, 0, 0, 0])  # A ref-right, B ref-wrong, C foc-right, D foc-wrong
    nr = nf = 0
    for c in cands:
        g = grp_of(c)
        if g not in (ref, foc) or key not in c['resp']: continue
        x = c['resp'][key]['x'] or 0
        rest = c['score'] - x
        s = strata[rest]
        if g == ref: nr += 1; s[0 if x else 1] += 1
        else: nf += 1; s[2 if x else 3] += 1
    num = den = 0.0
    for a, b, cc, d in strata.values():
        t = a + b + cc + d
        if t < 2: continue
        num += a * d / t; den += b * cc / t
    if num == 0 or den == 0: return None, nr, nf, 'n/a'
    delta = -2.35 * math.log(num / den)
    ad = abs(delta)
    cls = 'A' if ad < 1.0 else ('B' if ad < 1.5 else 'C')
    return round(delta, 2), nr, nf, cls

def analyse_exam(name, e):
    keys = sorted(e['items'])
    cands = list(e['cand'].values())
    for c in cands:
        c['score'] = sum((c['resp'].get(k) or {}).get('x') or 0 for k in keys)
    scores = [c['score'] for c in cands]
    n = len(cands)
    items = []
    pq_sum = 0.0
    for k in keys:
        taken = [c for c in cands if k in c['resp']]
        xs = [(c['resp'][k]['x'] or 0) for c in taken]
        omit = sum(1 for c in taken if c['resp'][k]['x'] is None)
        if not taken: continue
        p = sum(xs) / len(xs)
        pq_sum += p * (1 - p)
        rest = [c['score'] - (c['resp'][k]['x'] or 0) for c in taken]
        rpb = pearson(xs, rest)
        times = [c['resp'][k]['t'] for c in taken if c['resp'][k]['t'] is not None]
        fts = [c['resp'][k]['ft'] for c in taken if c['resp'][k]['ft'] is not None]
        rapid = sum(1 for t in fts if t < RAPID) / len(fts) if fts else None
        flags = []
        if len(taken) < MIN_N_ITEM: flags.append('provisional (small N)')
        if p < 0.20: flags.append('very hard')
        if p > 0.90: flags.append('very easy')
        if rpb is not None and rpb < 0.15: flags.append('low discrimination')
        if rpb is not None and rpb < 0: flags.append('NEGATIVE discrimination: check key')
        if omit / len(taken) > 0.10: flags.append('high omit rate')
        if rapid is not None and rapid > 0.20: flags.append('many rapid answers')
        dg = mh_dif(cands, k, lambda c: c['gender'], 'male', 'female')
        dl = mh_dif(cands, k, lambda c: c['language'], 'en', 'ar')
        for label, (delta, nr, nf, cls) in (('gender', dg), ('language', dl)):
            if cls == 'C': flags.append(f'DIF {label} C' + ('' if min(nr, nf) >= MIN_N_DIF else ' (small groups)'))
        items.append({'item': k, 'n': len(taken), 'p': round(p, 3), 'rpb': None if rpb is None else round(rpb, 3),
                      'omit': round(omit / len(taken), 3), 'median_seconds': round(statistics.median(times), 1) if times else None,
                      'rapid_share': None if rapid is None else round(rapid, 3),
                      'dif_gender': {'delta': dg[0], 'n_male': dg[1], 'n_female': dg[2], 'class': dg[3]},
                      'dif_language': {'delta': dl[0], 'n_en': dl[1], 'n_ar': dl[2], 'class': dl[3]}, 'flags': flags})
    k = len(items)
    var = statistics.pvariance(scores) if n > 1 else 0.0
    kr20 = (k / (k - 1)) * (1 - pq_sum / var) if k > 1 and var > 0 else None
    sd = math.sqrt(var)
    test = {'exam': name, 'candidates': n, 'items': k, 'mean': round(statistics.mean(scores), 2) if scores else None,
            'sd': round(sd, 2), 'kr20': None if kr20 is None else round(kr20, 3),
            'sem': None if kr20 is None else round(sd * math.sqrt(max(0.0, 1 - kr20)), 2),
            'groups': {'gender': {g: sum(1 for c in cands if c['gender'] == g) for g in ('male', 'female', 'undisclosed')},
                       'language': {l: sum(1 for c in cands if c['language'] == l) for l in ('en', 'ar')}},
            'note': None if n >= 200 else 'Fewer than 200 candidates: all statistics are provisional.'}
    return {'test': test, 'items': items}

def markdown(results):
    out = ['# MindProof item and test analysis', '', 'Classical test theory statistics and Mantel-Haenszel DIF (ETS delta: negative = harder for the focal group, female or Arabic; A negligible, B moderate, C large). Read-only output of tools/psychometrics/analyze.py (OMS-MND-261126-22).', '']
    for r in results:
        t = r['test']
        out += [f"## {t['exam']}", '', f"Candidates {t['candidates']} · items {t['items']} · mean {t['mean']} · SD {t['sd']} · KR-20 {t['kr20']} · SEM {t['sem']}", '']
        if t['note']: out += [f"> {t['note']}", '']
        out += [f"Groups: gender {t['groups']['gender']}, language {t['groups']['language']}", '',
                '| Item | N | p | r (item-rest) | Omit | Median s | Rapid | DIF gender | DIF language | Flags |', '|---|---|---|---|---|---|---|---|---|---|']
        for i in r['items']:
            out.append(f"| {i['item']} | {i['n']} | {i['p']} | {i['rpb']} | {i['omit']} | {i['median_seconds']} | {i['rapid_share']} | {i['dif_gender']['class']} ({i['dif_gender']['delta']}) | {i['dif_language']['class']} ({i['dif_language']['delta']}) | {'; '.join(i['flags'])} |")
        out.append('')
    return '\n'.join(out)

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument('csv'); ap.add_argument('--out', default='report')
    a = ap.parse_args(argv)
    res = [analyse_exam(name, e) for name, e in sorted(load(a.csv).items())]
    json.dump(res, open(a.out + '.json', 'w'), indent=1)
    open(a.out + '.md', 'w', encoding='utf-8').write(markdown(res))
    return res

if __name__ == '__main__':
    main()
