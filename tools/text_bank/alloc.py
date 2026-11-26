"""Batch 1 targets for text items (formats 1 text, 2 business case, 3 decision scenario, 12 situational judgement).
Scaled from the approved per-exam counts (blueprint rev 28) to about 50 items per sub-exam.
Formats 4-8 are code-generated (OMS-MND-261126-17); 9 memory, 10 speed, 11 creativity need timed screens (later)."""
import json, math, sys
FAM = {'لغوي':'verbal','رياضي / عددي':'numerical','منطقي':'logical','تحليلي ونقدي':'analytical','قرار وحكم':'decision',
       'إبداع':'creativity','مرونة وتخطيط':'flexibility'}
TEXT_FORMATS = {1, 2, 3, 12}
BAND = {'Manager':(4,6), 'Senior Manager':(5,8), 'C-Level':(7,10)}
EXAM = {('Manager','MindProof'):'manager-reasoning-score', ('Manager','Cognitive'):'manager-cognitive-assessment',
        ('Senior Manager','MindProof'):'senior-manager-reasoning-score', ('Senior Manager','Cognitive'):'senior-manager-cognitive-assessment',
        ('C-Level','MindProof'):'c-level-reasoning-score', ('C-Level','Cognitive'):'c-level-cognitive-assessment'}
def targets(alloc, per_sub=50):
    out = {}
    for (lvl, sub), exam in EXAM.items():
        cells = {k: v for k, v in alloc[f'{lvl}|{sub}']['cells'].items() if int(k.split('|')[1]) in TEXT_FORMATS}
        tot = sum(cells.values())
        raw = {k: v * per_sub / tot for k, v in cells.items()}
        got = {k: math.floor(x) for k, x in raw.items()}
        for k in sorted(raw, key=lambda k: raw[k] - got[k], reverse=True)[:per_sub - sum(got.values())]:
            got[k] += 1
        out[exam] = {'level': lvl, 'sub': sub, 'band': BAND[lvl],
                     'cells': {f"{FAM[k.split('|')[0]]}|{k.split('|')[1]}": n for k, n in got.items()}}
    return out
if __name__ == '__main__':
    t = targets(json.load(open(sys.argv[1])))
    json.dump(t, open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)
    for e, v in t.items(): print(e, sum(v['cells'].values()), v['cells'])
