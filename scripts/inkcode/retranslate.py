#!/usr/bin/env python3
"""
Re-runs the formula translator (formula_tpl.py) on the formulas that extract.py could not translate (data/needs_review.json) and writes the
templates it can now make into data/products.json — no Excel file needed. Products are matched to the review list in order (both were
written in the same loop of extract.py). Formulas that still cannot be translated stay in "สูตรเดิมที่ต้องตรวจ".

  python3 retranslate.py
"""
import json, os, re, collections
import formula_tpl as F

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
products = json.load(open(f'{D}/products.json', encoding='utf-8'))
review = json.load(open(f'{D}/needs_review.json', encoding='utf-8'))
pending = [p for p in products if p.get('สูตรเดิมที่ต้องตรวจ')]
assert len(pending) == len(review), (len(pending), len(review))
LINE = {c: i for i, c in enumerate('JKLM', 1)}
fixed = collections.Counter(); left_total = 0; new_review = []
for p, r in zip(pending, review):
    assert str(p['รหัสเอกสาร']) == str(r['doc']), (p['รหัสเอกสาร'], r['doc'])
    left = []
    for item in r['items']:
        col, f = item.split(': ', 1)
        kind, val = F.convert(f)
        key = f'แบบโค้ดแถว {LINE[col]}'
        if kind == 'tpl' and not p.get(key):
            p[key] = val; fixed[col] += 1
        else: left.append(item)
    if left:
        p['สูตรเดิมที่ต้องตรวจ'] = '\n'.join(left)[:3900]; left_total += len(left)
        new_review.append(dict(row=r['row'], doc=r['doc'], market=r['market'], items=left))
    else: p.pop('สูตรเดิมที่ต้องตรวจ', None)
json.dump(products, open(f'{D}/products.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(new_review, open(f'{D}/needs_review.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
used = collections.Counter(t for p in products for k in ('แบบโค้ดแถว 1', 'แบบโค้ดแถว 2', 'แบบโค้ดแถว 3', 'แบบโค้ดแถว 4') if p.get(k) for t in re.findall(r'\{([^{}]+)\}', p[k]))
json.dump(dict(tokens=used), open(f'{D}/tokens.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('translated now:', sum(fixed.values()), dict(fixed), '| still need review:', left_total, 'formulas in', len(new_review), 'products (was', len(review), ')')
print('new tokens:', sorted(t for t in used if re.match(r'K\d+(YY|Y|MM|DD|MON|MC|M2)', t)))
