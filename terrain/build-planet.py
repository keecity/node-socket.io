# Builds planet-lab.html: modules inlined in their own scopes; worker sources embedded as strings.
import json, re, pathlib
d=pathlib.Path(__file__).parent
strip=lambda s: re.sub(r'^export ', '', s, flags=re.M)
def inline_module(line, src):
    names=re.search(r'import\s*\{([^}]*)\}',line).group(1)
    return 'const {'+names+'}=(()=>{\n'+strip(src)+'\nreturn {'+names+'};\n})();'
mods={'//@INLINE_GEN':'terrain-gen.js','//@INLINE_MAT':'terrain-material.js','//@INLINE_CUBE':'cube-sphere.js','//@INLINE_PLANET':'planet-tiles.js'}
out=[]
for line in (d/'planet-lab.src.html').read_text().split('\n'):
    k=next((k for k in mods if k in line),None)
    if k: out.append(inline_module(line,(d/mods[k]).read_text()))
    elif '//@SRC' in line: out.append('const GEN_SRC='+json.dumps(strip((d/'terrain-gen.js').read_text()))+', CUBE_SRC='+json.dumps(strip((d/'cube-sphere.js').read_text()))+';')
    else: out.append(line)
(d/'planet-lab.html').write_text('\n'.join(out)); print('built planet-lab.html')
