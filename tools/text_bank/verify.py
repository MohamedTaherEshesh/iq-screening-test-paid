"""Checks a text-bank batch: schema, targets, difficulty band, 4 distinct options in EN and AR, Arabic script,
unique ids and ideas, balanced answer positions, numeric answers recomputed from `check`, and (optional) a blind
second solve file {id: answer_index} that must agree with the key."""
import json, re, sys, glob, collections, os
AR = re.compile(r'[؀-ۿ]')
NUM = re.compile(r'-?\d[\d,]*\.?\d*')
def num(s):
    m = NUM.findall(s.replace('٬', ','))
    return float(m[0].replace(',', '')) if m else None
def main(folder, solve=None):
    T = json.load(open(os.path.join(folder, '..', 'targets.json')))
    items, errs = [], []
    for f in sorted(glob.glob(os.path.join(folder, '*.json'))):
        items += json.load(open(f))
    ids, ideas = set(), set()
    cnt = collections.Counter(); pos = collections.Counter()
    for it in items:
        i = it.get('id', '?'); e = lambda m: errs.append(f'{i}: {m}')
        for k in ('id','exam','family','format','difficulty','idea','prompt_en','options_en','prompt_ar','options_ar','answer','explain_en','explain_ar'):
            if k not in it: e('missing ' + k)
        if errs and errs[-1].startswith(f'{i}: missing'): continue
        t = T.get(it['exam'])
        if not t: e('unknown exam'); continue
        lo, hi = t['band']
        if not (lo <= it['difficulty'] <= hi): e(f'difficulty {it["difficulty"]} outside {lo}-{hi}')
        cell = f"{it['family']}|{it['format']}"
        if cell not in t['cells']: e('family/format not allowed: ' + cell)
        cnt[(it['exam'], cell)] += 1; pos[(it['exam'], it['answer'])] += 1
        if i in ids: e('duplicate id')
        ids.add(i)
        if it['idea'] in ideas: e('duplicate idea ' + it['idea'])
        ideas.add(it['idea'])
        for lang in ('en', 'ar'):
            o = it['options_' + lang]
            if len(o) != 4: e(f'{lang} needs 4 options')
            if len({x.strip().lower() for x in o}) != len(o): e(f'{lang} options not distinct')
            if not all(isinstance(x, str) and x.strip() for x in o): e(f'{lang} empty option')
        if not AR.search(it['prompt_ar']) or not all(AR.search(x) or NUM.fullmatch(x.strip()) or re.fullmatch(r'[\d%.,\s\-+$A-Za-z/]+', x) for x in it['options_ar']): e('Arabic text missing')
        if AR.search(it['prompt_en']): e('Arabic in English prompt')
        if it['answer'] not in (0, 1, 2, 3): e('answer must be 0-3')
        if len(it['prompt_en']) < 40: e('prompt too short')
        if 'check' in it:
            want = eval(it['check'], {'__builtins__': {}}, {'round': round, 'abs': abs, 'min': min, 'max': max, 'sum': sum})
            got = num(it['options_en'][it['answer']])
            if got is None or abs(got - want) > 1e-6 * max(1, abs(want)) and abs(got - round(want, 2)) > 0.005:
                e(f'check {want} != keyed option {it["options_en"][it["answer"]]}')
            others = [num(x) for k, x in enumerate(it['options_en']) if k != it['answer']]
            if any(x is not None and abs(x - want) < 1e-9 for x in others): e('a distractor equals the computed answer')
            if num(it['options_ar'][it['answer']]) not in (None, got): e('AR keyed number differs from EN')
    for ex, t in T.items():
        for cell, n in t['cells'].items():
            if cnt[(ex, cell)] != n: errs.append(f'{ex} {cell}: {cnt[(ex, cell)]} of {n}')
        p = [pos[(ex, k)] for k in range(4)]
        if sum(p) and max(p) - min(p) > max(4, sum(p) // 6): errs.append(f'{ex}: answer positions unbalanced {p}')
    agree = None
    if solve:
        s = json.load(open(solve))
        miss = [i['id'] for i in items if s.get(i['id']) != i['answer']]
        agree = (len(items) - len(miss), len(items))
        for m in miss: errs.append(f'{m}: blind solve {s.get(m)} != key')
    print(json.dumps({'items': len(items), 'per_exam': collections.Counter(i['exam'] for i in items), 'blind_agree': agree}, ensure_ascii=False))
    for x in errs: print('FAIL', x)
    print('PASS' if not errs else f'{len(errs)} problems')
    return not errs
if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None) else 1)
