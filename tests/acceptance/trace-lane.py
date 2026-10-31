"""Adds a traced() line for every criterion that a lane test cites by ID and that no QA file names yet.
Usage: python3 tests/acceptance/trace-lane.py   (run uncited.py for each feature first, or this script does it)
R1..R8 repeat in F04, F06, F07 and F13, so for those features only lane files whose name fits the feature are kept."""
import glob, json, os, re, subprocess, sys
FILTER = {'F04': r'checkout|pricing|promo|order|price|discount|quote|pay\.|pay-', 'F06': r'package|credit|wallet|f06|ledger|expiry|claim|payment',
          'F07': r'coach|solo|substitution|leave', 'F13': r'report|payout|receipt|close|daily'}
names = {}
for p in glob.glob('tests/acceptance/F*-*.spec.ts'):
    b = os.path.basename(p)
    if b.endswith(('.traced.spec.ts', '.new.spec.ts')): continue
    names.setdefault(b[:3], b[:-8])
total = 0
for feat in sorted(names):
    subprocess.run(['python3', 'tests/acceptance/uncited.py', feat], capture_output=True)
    j = json.load(open(f'/tmp/{feat}.json'))
    own = ''.join(open(p).read() for p in glob.glob(f'tests/acceptance/{feat}-*') if p.endswith(('.traced.spec.ts', '.new.spec.ts')))
    tp = f'tests/acceptance/{names[feat]}.traced.spec.ts'
    lines = []
    for i in j['order']:
        if re.search(r'(?<![A-Za-z0-9-])' + re.escape(i) + r'(?![0-9a-z])', own): continue
        files = j['cov'][i]
        if feat in FILTER and re.match(r'R\d+-AC', i):
            files = [f for f in files if re.search(FILTER[feat], os.path.basename(f) if feat != 'F04' else f.replace('packages/', ''))]
        if not files: continue
        s = j['d'][i][:80].replace('\\', '\\\\').replace('"', '\\"')
        lines.append('traced("%s/%s", "%s", [%s]);' % (feat, i, s, ", ".join('{ file: "%s", has: "%s" }' % (f, i) for f in files[:3])))
    if lines:
        if not os.path.exists(tp): open(tp, 'w').write(f"// {feat} acceptance criteria proven by tests next to the code.\nimport {{ traced }} from './trace';\n\n")
        with open(tp, 'a') as o: o.write("\n// Added by trace-lane.py: criteria the lane's tests name by ID.\n" + "\n".join(lines) + "\n")
        total += len(lines); print(feat, len(lines))
print('added', total)
