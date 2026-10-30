import re,html,sys,glob,os
P='/tmp/claude-0/-home-user-booq/b7a75a17-4332-584d-aea9-cf4b76033390/scratchpad/artifact-files/12ae5a85-7762-44b9-9b19-9df906c1e373/project/'
def ex(path):
    s=open(path,encoding='utf-8').read()
    m=re.search(r'<title>(.*?)</title>',s,re.S); t=html.unescape(m.group(1)) if m else ''
    b=s.split('<x-dc>',1)[-1]
    b=re.sub(r'<script.*?</script>','',b,flags=re.S)
    b=re.sub(r'<style.*?</style>','',b,flags=re.S)
    b=re.sub(r'<svg.*?</svg>','',b,flags=re.S)
    # keep input values / placeholder
    b=re.sub(r'<input[^>]*value="([^"]*)"[^>]*>',r' [input:\1] ',b)
    b=re.sub(r'<input[^>]*type="checkbox"[^>]*(checked)?[^>]*>',' [checkbox] ',b)
    # dashed markers
    b=re.sub(r'<(div|section|button|span|label)[^>]*dashed[^>]*>',lambda m:m.group(0)+' {dashed} ',b)
    b=re.sub(r'</?(div|section|main|aside|p|li|tr|button|label|h\d|b|a|span|td|th)[^>]*>',' | ',b)
    b=re.sub(r'<[^>]+>',' ',b)
    b=html.unescape(b)
    b=re.sub(r'\s+',' ',b)
    b=re.sub(r'(\|\s*)+','| ',b)
    return t,b.strip(' |')
if __name__=='__main__':
    for n in sys.argv[1:]:
        t,b=ex(P+n)
        print('### '+n+' :: '+t); print(b); print()
