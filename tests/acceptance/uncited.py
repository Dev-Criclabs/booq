import re,glob,sys,json
feat=sys.argv[1]
d={};order=[]
src=glob.glob(f'specs/features/{feat}-*/requirements.md')[0]
for l in open(src):
    m=re.match(r'^- (\S+?-AC\d+[a-z]?)[.:]\s+(.*)',l)
    if m: d[m.group(1)]=m.group(2); order.append(m.group(1))
files=[f for f in glob.glob('**/*.ts',recursive=True)+glob.glob('**/*.tsx',recursive=True) if 'node_modules' not in f and not f.startswith('tests/acceptance')]
text={f:open(f).read() for f in files if re.search(r'\.(test|spec)\.tsx?$',f)}
cov={}
for i in order:
    pat=re.compile(r'(?<![A-Za-z0-9-])'+re.escape(i)+r'(?![0-9a-z])')
    cov[i]=[f for f,t in text.items() if pat.search(t)]
json.dump({'d':d,'order':order,'cov':cov},open(f'/tmp/{feat}.json','w'))
none=[i for i in order if not cov[i]]
print(feat,len(order),'criteria;',len(none),'uncited')
if len(sys.argv)>2:
    for i in none: print(i,'::',d[i][:200])
