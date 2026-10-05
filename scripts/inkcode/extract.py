#!/usr/bin/env python3
"""
Reads the two Excel files (Master Database + Code Pet Food) and writes data/*.json for seedInkCode.ts.
  python3 extract.py "<Master_Database.xlsx>" [password]
The Code Format formulas (dozens of variants) are turned into TEMPLATES such as  "{P} S{YC}{MC}{DC}S{LC}"  that the
FILL() function of DocHUB renders for any production date / line. Formulas that cannot be translated are NOT guessed:
they are listed in "สูตรเดิมที่ต้องตรวจ" and the template is left empty.
"""
import io, json, re, sys, os, collections
import msoffcrypto, openpyxl
from openpyxl.utils import column_index_from_string as ci

path = sys.argv[1]
pw = sys.argv[2] if len(sys.argv) > 2 else None
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(OUT, exist_ok=True)

def load(data_only):
    f = open(path, 'rb')
    if pw:
        of = msoffcrypto.OfficeFile(f); of.load_key(password=pw); b = io.BytesIO(); of.decrypt(b); f = b
    return openpyxl.load_workbook(f, data_only=data_only)

wf = load(False)
wv = load(True)

# ---------------------------------------------------------------- reference tables (sheet "Ref")
R = wv['Ref']
def rowv(r, c1, c2): return [R.cell(r, c).value for c in range(ci(c1), ci(c2) + 1)]
def s(v): return None if v is None else (str(int(v)) if isinstance(v, float) and v == int(v) else str(v))

years = [dict(ปี=s(a), รหัสปี=s(c), รหัสปี2=s(d), ปี_พศ=s(b)) for a, b, c, d in zip(*[rowv(r, 'M', 'S') for r in (2, 3, 4, 5)]) if a is not None]
months = [dict(เดือน=s(a), ตัวอักษร=s(b), ชื่อย่อ=s(c), เลข2หลัก=(s(d).zfill(2) if d is not None else None), อักษร2=s(e)) for a, b, c, d, e in zip(*[rowv(r, 'U', 'AF') for r in (2, 3, 4, 5, 6)]) if a is not None]
days = [dict(วัน=s(a), รหัสวัน=s(b)) for a, b in zip(rowv(8, 'G', 'AK'), rowv(9, 'G', 'AK')) if a is not None]
lines = []
for i in range(ci('G'), ci('BC') + 1):
    name = R.cell(11, i).value
    if name is None: continue
    lines.append(dict(ไลน์=s(name), รหัสไลน์=s(R.cell(12, i).value), รหัสไลน์2=s(R.cell(13, i).value), Plant=s(R.cell(14, i).value), อื่นๆ=s(R.cell(15, i).value)))

cal = []
for r in range(34, 399):
    row = [R.cell(r, c).value for c in range(1, 11)]
    if row[0] is None: continue
    cal.append({'วันที่ผลิต': row[0].strftime('%Y-%m-%d') if hasattr(row[0], 'strftime') else s(row[0]), **{f'K{i}': (v.strftime('%Y-%m-%d') if hasattr(v, 'strftime') else s(v)) for i, v in enumerate(row[1:], 2)}})
shifts = []
for col in (1, 2):
    shifts.append({'กะ': s(R.cell(8, col).value), 'SC2': s(R.cell(9, col).value), 'SC3': s(R.cell(10, col).value), 'SC4': s(R.cell(11, col).value)})

# ---------------------------------------------------------------- Excel formula -> template
def split_amp(f):
    parts, depth, q, cur = [], 0, False, ''
    for ch in f:
        if ch == '"': q = not q
        if not q:
            if ch == '(': depth += 1
            elif ch == ')': depth -= 1
            elif ch == '&' and depth == 0: parts.append(cur); cur = ''; continue
        cur += ch
    parts.append(cur)
    return parts

MONTH_IDX = {2: 'MC', 3: 'MON', 4: 'MM', 5: 'M2'}
LINE_IDX = {2: 'LC', 3: 'LC2', 4: 'PF', 5: 'LX'}
YEAR_IDX = {2: 'YB', 3: 'YC', 4: 'YC2'}
CELL_TOKEN = {'P': 'P', 'F': 'F'}   # product columns we can bring to the worksheet (Short code, doc code)

def norm(p):
    """Normal form of one &-part: no $ / spaces / external-link prefix; row numbers of the production row become #"""
    if p.startswith('"'): return p
    p = re.sub(r'\[\d+\]', '', p.replace('$', ''))
    p = re.sub(r'\s+', '', p)
    rng = []
    def keep(m): rng.append(m.group(1)); return 'Ref!<%d>' % (len(rng) - 1)
    p = re.sub(r'Ref!([A-Z]+\d+:[A-Z]+\d+)', keep, p)
    p = re.sub(r'\b([A-Z]{1,2})\d+\b', lambda m: m.group(1) + '#', p)
    return re.sub(r'<(\d+)>', lambda m: rng[int(m.group(1))], p)

def conv_part(raw):
    p = raw.strip()
    if p.startswith('"') and p.endswith('"') and p.count('"') == 2: return p[1:-1].replace('{', '(').replace('}', ')')
    p2 = norm(p)
    m = re.fullmatch(r'([A-Z]{1,2})#', p2)
    if m: return '{%s}' % CELL_TOKEN[m.group(1)] if m.group(1) in CELL_TOKEN else None
    m = re.fullmatch(r'HLOOKUP\(YEAR\(C#\),Ref!(?:M|N)2:[A-Z]+5,(\d),0\)', p2)
    if m: return '{%s}' % YEAR_IDX[int(m.group(1))] if int(m.group(1)) in YEAR_IDX else None
    m = re.fullmatch(r'HLOOKUP\(MONTH\(C#\),Ref!U2:AF(\d),(\d),0\)', p2)
    if m and int(m.group(2)) <= int(m.group(1)) - 1: return '{%s}' % MONTH_IDX[int(m.group(2))] if int(m.group(2)) in MONTH_IDX else None
    if re.fullmatch(r'HLOOKUP\(DAY\(C#\),Ref!G8:AK9,2,0\)', p2): return '{DC}'
    m = re.fullmatch(r'HLOOKUP\(E#,Ref!G11:[A-Z]+(\d+),(\d),0\)', p2)
    if m and int(m.group(2)) <= int(m.group(1)) - 10 and int(m.group(2)) in LINE_IDX: return '{%s}' % LINE_IDX[int(m.group(2))]
    for sub, tail in (('', ''), ('-1', '-1')):
        m = re.fullmatch(r'IF\((DAY|MONTH)\(C#%s\)<10,"0"&\1\(C#%s\),\1\(C#%s\)\)' % ((re.escape(sub),) * 3), p2)
        if m: return ('{DD%s}' % tail) if m.group(1) == 'DAY' else ('{MM}' if not sub else None)
    m = re.fullmatch(r'VLOOKUP\(C#(-1)?,Ref!A\d+:[A-Z]+\d+,(\d+),0\)', p2)
    if m and int(m.group(2)) <= 10: return '{K%s%s}' % (m.group(2), '-1' if m.group(1) else '')
    m = re.fullmatch(r'(LEFT|RIGHT)\(VLOOKUP\(C#,Ref!A\d+:[A-Z]+\d+,(\d+),0\),(\d+)\)', p2)
    if m and int(m.group(2)) <= 10: return '{K%s%s%s}' % (m.group(2), m.group(1)[0], m.group(3))
    m = re.fullmatch(r'HLOOKUP\(D#,Ref!A8:B11,(\d),0\)', p2)
    if m: return '{SC%s}' % m.group(1)
    if p2 == 'DAY(C#)': return '{D}'
    if p2 == 'MONTH(C#)': return '{Mo}'
    m = re.fullmatch(r'YEAR\(C#\)(\+(\d))?', p2)
    if m: return '{Y%s}' % (('+' + m.group(2)) if m.group(2) else '')
    m = re.fullmatch(r'RIGHT\(YEAR\(C#\)(\+(\d))?,(\d)\)', p2)
    if m:
        n = '+' + m.group(2) if m.group(2) else ''
        k = int(m.group(3))
        return '{Y%s}' % n if k == 4 else '{YY%s}' % n if k == 2 else '{Y1%s}' % n if k == 1 else None
    return None

def convert(f):
    if not (isinstance(f, str) and f.startswith('=')): return ('const', f)
    body = f[1:]
    out = []
    for part in split_amp(body):
        t = conv_part(part)
        if t is None: return ('fail', f)
        out.append(t)
    return ('tpl', ''.join(out))

# ---------------------------------------------------------------- DATABASE
D = wf['3.) DATABASE-ห้ามพิมพ์ลงหน้านี้']
DV = wv['3.) DATABASE-ห้ามพิมพ์ลงหน้านี้']
def cell(ws, r, col): return ws.cell(r, ci(col)).value
def txt(v):
    if v is None: return None
    if isinstance(v, float) and v == int(v): v = int(v)
    if hasattr(v, 'strftime'): v = v.strftime('%Y-%m-%d')
    v = str(v)
    return v if v.strip() != '' else None

products, review = [], []
stats = collections.Counter()
seen = collections.Counter()
for r in range(3, D.max_row + 1):
    f = cell(D, r, 'F')
    if f is None or str(f).strip() == '': continue
    rec = {
        'รหัสเอกสาร': txt(f), 'PKG': txt(cell(DV, r, 'G')), 'Market': txt(cell(DV, r, 'H')), 'ลูกค้า': txt(cell(DV, r, 'I')),
        'รหัสเอกสารระบบ Code': txt(cell(DV, r, 'N')), 'Rev.': txt(cell(DV, r, 'O')), 'Short Product Code': cell(DV, r, 'P') if cell(DV, r, 'P') is None else str(cell(DV, r, 'P')),
        'Product Code (SAP)': txt(cell(DV, r, 'R')), 'Material Packaging#1': txt(cell(DV, r, 'S')), 'Material Packaging#2': txt(cell(DV, r, 'T')), 'Material Packaging#3': txt(cell(DV, r, 'U')),
        'ชนิด': txt(cell(DV, r, 'V')), 'Note': txt(cell(DV, r, 'W')), 'SVT?': txt(cell(DV, r, 'X')),
        'บันทึกประวัติ': ' | '.join(x for x in (txt(cell(DV, r, 'Z')), txt(cell(DV, r, 'AA'))) if x) or None,
        'สถานะ': txt(cell(DV, r, 'AB')), 'สถานะติดตาม': txt(cell(DV, r, 'AC')), 'special': txt(cell(DV, r, 'AD')),
    }
    bad = []
    for i, col in enumerate('JKLM', 1):
        kind, val = convert(cell(D, r, col))
        if kind == 'tpl':
            rec[f'แบบโค้ดแถว {i}'] = val; stats[f'{col}:tpl'] += 1
        elif kind == 'const':
            rec[f'แบบโค้ดแถว {i}'] = txt(val) if val is not None else None; stats[f'{col}:const' if val is not None else f'{col}:empty'] += 1
        else:
            rec[f'แบบโค้ดแถว {i}'] = None; bad.append(f'{col}: {val}'); stats[f'{col}:FAIL'] += 1
    if bad:
        rec['สูตรเดิมที่ต้องตรวจ'] = '\n'.join(bad)[:3900]
        review.append(dict(row=r, doc=rec['รหัสเอกสาร'], market=rec['Market'], items=bad))
    seen[(str(rec['รหัสเอกสาร']).strip().lower() + str(rec['Market'] or '').strip().lower())] += 1
    products.append(rec)

dups = {k: v for k, v in seen.items() if v > 1}
json.dump(dict(years=years, months=months, days=days, lines=lines, calendar=cal, shifts=shifts), open(f'{OUT}/ref.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
json.dump(products, open(f'{OUT}/products.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(review, open(f'{OUT}/needs_review.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
used = collections.Counter(t for p in products for k in ('แบบโค้ดแถว 1', 'แบบโค้ดแถว 2', 'แบบโค้ดแถว 3', 'แบบโค้ดแถว 4') if p.get(k) for t in re.findall(r'\{([^{}]+)\}', p[k]))
json.dump(dict(tokens=used), open(f'{OUT}/tokens.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('products', len(products), '| duplicate keys', len(dups), list(dups.items())[:5])
print('templates:', dict(stats))
print('tokens used:', dict(used))
print('rows needing review:', len(review))
