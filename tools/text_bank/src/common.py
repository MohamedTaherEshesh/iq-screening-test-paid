"""Builds batch JSON from source rows. In source rows the correct option is always written first;
the builder moves it to a balanced position (seeded), so the stored key is not always the first option."""
import json, os, random
CODE = {'manager-reasoning-score':'MAN-MRS','manager-cognitive-assessment':'MAN-MCA',
        'senior-manager-reasoning-score':'SMG-MRS','senior-manager-cognitive-assessment':'SMG-MCA',
        'c-level-reasoning-score':'CLV-MRS','c-level-cognitive-assessment':'CLV-MCA'}
LEVEL = {'manager':'manager','senior-manager':'senior-manager','c-level':'c-level'}
def build(exam, rows, seed=261127):
    rng = random.Random(seed + sum(map(ord, exam)))
    slots = [k % 4 for k in range(len(rows))]; rng.shuffle(slots)
    out = []
    for n, (r, pos) in enumerate(zip(rows, slots), 1):
        eo, ao = list(r['eo']), list(r['ao'])
        for o in (eo, ao):
            c = o.pop(0); o.insert(pos, c)
        it = {'id': f'T-{CODE[exam]}-{n:04d}', 'exam': exam, 'level': exam.rsplit('-', 2)[0] if 'cognitive' in exam or 'reasoning' in exam else exam,
              'family': r['f'], 'format': r['fmt'], 'difficulty': r['d'], 'idea': r['idea'],
              'prompt_en': r['en'], 'options_en': eo, 'prompt_ar': r['ar'], 'options_ar': ao, 'answer': pos,
              'explain_en': r['xe'], 'explain_ar': r['xa'], 'status': 'draft', 'provenance': 'ai_written_v1 (OMS-MND-261126-23)'}
        it['level'] = exam.replace('-reasoning-score', '').replace('-cognitive-assessment', '')
        if 'check' in r: it['check'] = r['check']
        out.append(it)
    path = os.path.join(os.path.dirname(__file__), '..', 'items', exam + '.json')
    json.dump(out, open(path, 'w'), ensure_ascii=False, indent=1)
    print(exam, len(out))
