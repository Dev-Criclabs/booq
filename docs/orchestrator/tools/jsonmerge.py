import json,subprocess,sys
p=sys.argv[1]
ours=json.loads(subprocess.check_output(['git','show',':2:'+p]))
theirs=json.loads(subprocess.check_output(['git','show',':3:'+p]))
def dm(a,b):
    r=dict(a)
    for k,v in b.items():
        r[k]=dm(r[k],v) if isinstance(v,dict) and isinstance(r.get(k),dict) else v
    return r
def n(d): return sum(n(v) if isinstance(v,dict) else 1 for v in d.values())
m=dm(ours,theirs); print(p,n(ours),n(theirs),n(m))
open(p,'w').write(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
subprocess.check_call(['git','add',p])
