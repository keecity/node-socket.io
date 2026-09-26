# Builds the Valley Duel game from valley-duel.src.html:
#   valley-duel.html            — terrain modules inlined; assets loaded as files next to it (artifact / server)
#   valley-duel-standalone.html — also embeds every asset, so it opens by double-click (needs ASSETS dir)
import json, re, sys, base64, pathlib
d=pathlib.Path(__file__).parent; t=d.parent/'terrain'
strip=lambda s: re.sub(r'^export ', '', s, flags=re.M)
def inline_module(line, src):
    # "import {a, b} from '...';  //@INLINE_X" -> "const {a,b}=(()=>{ <module> ; return {a,b}; })();"
    names=re.search(r'import\s*\{([^}]*)\}',line).group(1)
    body=re.sub(r'^export ', '', src, flags=re.M)
    return 'const {'+names+'}=(()=>{\n'+body+'\nreturn {'+names+'};\n})();'
mods={'//@INLINE_GEN':(t/'terrain-gen.js').read_text(),'//@INLINE_MAT':(t/'terrain-material.js').read_text(),'//@INLINE_WAT':(t/'water-material.js').read_text(),'//@INLINE_SET':(t/'settlements.js').read_text()}
out=[]
for line in (d/'valley-duel.src.html').read_text().split('\n'):
    k=next((k for k in mods if k in line),None); out.append(inline_module(line,mods[k]) if k else line)
html='\n'.join(out); (d/'valley-duel.html').write_text(html); print('built valley-duel.html')
if len(sys.argv)>1:   # asset dir → standalone
    A=pathlib.Path(sys.argv[1]); m={}
    for f in ['siding.jpg','grass.jpg','dirt.jpg','asphalt.jpg','roof.jpg','smoke.png','fire.png','mecha_battle_pack.b64.txt','helicopter.b64.txt','tree.b64.txt']:
        raw=(A/f).read_bytes()
        m[f]='data:text/plain,'+raw.decode().strip() if f.endswith('.txt') else 'data:'+('image/jpeg' if f.endswith('jpg') else 'image/png')+';base64,'+base64.b64encode(raw).decode()
    html=html.replace("const BASE=window.__ASSET_BASE||'';","const BASE=window.__ASSET_BASE||'';\nconst EMBED="+json.dumps(m)+";\nconst asset=f=>EMBED[f]||BASE+f;",1)
    for a,b in [("BASE+'fire.png'","asset('fire.png')"),("BASE+'smoke.png'","asset('smoke.png')"),("fetch(BASE+f)","fetch(asset(f))"),("texLoader.load(BASE+name)","texLoader.load(asset(name))")]:
        assert html.count(a)==1,a; html=html.replace(a,b)
    (d/'valley-duel-standalone.html').write_text(html); print('built valley-duel-standalone.html')
