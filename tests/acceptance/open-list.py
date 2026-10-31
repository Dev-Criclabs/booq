"""Lists the criteria of a feature that no real test names (not counting the generated skeleton or a closure gate). usage: python3 tests/acceptance/open-list.py F07"""
import json, re, glob, subprocess, sys
feat = sys.argv[1]
subprocess.run(['python3', 'tests/acceptance/uncited.py', feat], capture_output=True)
j = json.load(open(f'/tmp/{feat}.json'))
texts = ''
for p in glob.glob('tests/acceptance/F*.ts'):
    b = p.split('/')[-1]
    if b.endswith('-gate.new.spec.ts'): continue
    if re.match(r'F\d\d-.*\.spec\.ts$', b) and not (b.endswith('.traced.spec.ts') or b.endswith('.new.spec.ts')): continue
    texts += open(p).read()
op = [i for i in j['order'] if not re.search(rf'{feat}/' + re.escape(i) + r'(?![0-9a-z])', texts)]
print(feat, len(j['order']), 'criteria;', len(op), 'with no real test')
for i in op: print(' ', i, '::', j['d'][i][:int(sys.argv[2]) if len(sys.argv) > 2 else 110])
