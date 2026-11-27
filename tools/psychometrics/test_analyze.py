"""Simulation test for analyze.py: Rasch data with one bad item (reversed), one gender-DIF item, one language-DIF item."""
import csv, math, random, os, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
import analyze
def simulate(path, n=1200, k=30, seed=7):
    rng = random.Random(seed)
    b = [rng.uniform(-1.5, 1.5) for _ in range(k)]
    with open(path, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['session_id','exam_tag','language','gender','position','item_code','item_version','correct','visible_seconds','seconds_to_first_answer','answer_changes'])
        for c in range(n):
            th = rng.gauss(0, 1); g = rng.choice(['male', 'female', 'undisclosed']); lang = rng.choice(['en', 'ar'])
            for i in range(k):
                bi = b[i] + (1.2 if (i == 5 and g == 'female') else 0) + (1.2 if (i == 9 and lang == 'ar') else 0)
                pr = 1 / (1 + math.exp(-(th - bi)))
                x = int(rng.random() < pr)
                if i == 2: x = 1 - x   # miskeyed item
                w.writerow([f's{c}', 'demo-exam', lang, g, i, f'Q{i:02d}', 1, x, round(rng.uniform(10, 90), 1), round(rng.uniform(5, 60), 1), 0])
def test():
    d = tempfile.mkdtemp(); p = os.path.join(d, 'r.csv'); simulate(p)
    res = analyze.main([p, '--out', os.path.join(d, 'rep')])[0]
    items = {i['item']: i for i in res['items']}
    assert res['test']['candidates'] == 1200 and res['test']['items'] == 30
    assert 0.6 < res['test']['kr20'] < 0.95, res['test']['kr20']
    assert any('NEGATIVE' in f for f in items['Q02@v1']['flags']), items['Q02@v1']
    assert items['Q05@v1']['dif_gender']['class'] in ('B', 'C') and items['Q05@v1']['dif_gender']['delta'] < 0, items['Q05@v1']['dif_gender']
    assert items['Q09@v1']['dif_language']['class'] in ('B', 'C') and items['Q09@v1']['dif_language']['delta'] < 0, items['Q09@v1']['dif_language']
    clean = [i for k, i in items.items() if k not in ('Q02@v1', 'Q05@v1', 'Q09@v1')]
    false_c = sum(1 for i in clean if i['dif_gender']['class'] == 'C' or i['dif_language']['class'] == 'C')
    assert false_c <= 1, false_c
    assert os.path.getsize(os.path.join(d, 'rep.md')) > 1000
    print('OMS-MND-261126-22: ALL TESTS PASSED', res['test'], 'false C flags:', false_c)
if __name__ == '__main__':
    test()
