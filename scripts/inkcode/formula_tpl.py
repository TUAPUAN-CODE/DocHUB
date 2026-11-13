"""Excel "Code Format" formula -> DocHUB template ({tokens}); pure functions, no Excel needed (used by extract.py and retranslate.py)."""
import re

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
    p = p.replace('&""', '')
    p = re.sub(r'\[\d+\]', '', p.replace('$', ''))
    p = re.sub(r'\s+', '', p)
    p = re.sub(r"'3\.\)DATABASE[^']*'!", '', p)   # the database sheet's own date / line cells = the production date / line
    rng = []
    def keep(m): rng.append(m.group(1)); return 'Ref!<%d>' % (len(rng) - 1)
    p = re.sub(r'Ref!([A-Z]+\d+:[A-Z]+\d+)', keep, p)
    p = re.sub(r'\b([A-Z]{1,2})\d+\b', lambda m: m.group(1) + '#', p)
    return re.sub(r'<(\d+)>', lambda m: rng[int(m.group(1))], p)

DATE_COLS = {4, 5, 8, 10}   # calendar columns (K4 K5 K8 K10) that hold ISO dates
def conv_part(raw):
    p = raw.strip()
    while p.startswith('(') and p.endswith(')') and split_amp(p[1:-1]) == [p[1:-1]] and p[1:-1].count('(') == p[1:-1].count(')'): p = p[1:-1].strip()
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
    # parts of a date column of the calendar sheet:  VLOOKUP(C#[-1], Ref!A34:Jxx, n, 0)  with n = 4 / 5 / 8 / 10
    V = r"VLOOKUP\(C#(-1)?,Ref!A\d+:[A-Z]+\d+,(\d+),0\)"
    def kdate(part, cols=DATE_COLS):
        m = re.fullmatch(part, p2)
        return m
    m = re.fullmatch(r'IF\(DAY\(%s\)<10,"0"&DAY\(%s\),DAY\(%s\)\)' % (V, V, V), p2)
    if m and m.group(1) == m.group(3) == m.group(5) and m.group(2) == m.group(4) == m.group(6) and int(m.group(2)) in DATE_COLS:
        return '{K%sDD%s}' % (m.group(2), m.group(1) or '')
    m = re.fullmatch(r'IF\(MONTH\(%s\)<10,"0"&MONTH\(%s\),MONTH\(%s\)\)' % (V, V, V), p2)
    if m and m.group(1) == m.group(3) == m.group(5) and m.group(2) == m.group(4) == m.group(6) and int(m.group(2)) in DATE_COLS:
        return '{K%sMM%s}' % (m.group(2), m.group(1) or '')
    m = re.fullmatch(r'YEAR\(%s\)' % V, p2)
    if m and int(m.group(2)) in DATE_COLS: return '{K%sY%s}' % (m.group(2), m.group(1) or '')
    m = re.fullmatch(r'RIGHT\(YEAR\(%s\),2\)' % V, p2)
    if m and int(m.group(2)) in DATE_COLS: return '{K%sYY%s}' % (m.group(2), m.group(1) or '')
    m = re.fullmatch(r'HLOOKUP\(MONTH\(%s\),Ref!U2:AF(\d),(\d),0\)' % V, p2)
    if m and int(m.group(2)) in DATE_COLS and int(m.group(4)) <= int(m.group(3)) - 1 and int(m.group(4)) in MONTH_IDX and MONTH_IDX[int(m.group(4))] in ('MC', 'MON', 'M2'):
        return '{K%s%s%s}' % (m.group(2), MONTH_IDX[int(m.group(4))], m.group(1) or '')
    # shift code from a wider range (A8:C10): same table as A8:B11
    m = re.fullmatch(r'HLOOKUP\(D#,Ref!A8:[A-C](\d+),(\d),0\)', p2)
    if m and int(m.group(2)) in (2, 3, 4): return '{SC%s}' % m.group(2)
    m = re.fullmatch(r'YEAR\(C#\)-2000', p2)
    if m: return '{YY}'
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
    body = re.sub(r"'3\.\) ?DATABASE[^']*'!", '', f[1:])   # the ')' inside that sheet name would confuse split_amp
    out = []
    for part in split_amp(body):
        t = conv_part(part)
        if t is None: return ('fail', f)
        out.append(t)
    return ('tpl', ''.join(out))

