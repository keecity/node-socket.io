# Builds terrain-lab.html: a single self-contained file (modules inlined, worker from a Blob)
# so the lab opens by double-click as well as from a server.
import json, re, pathlib
d=pathlib.Path(__file__).parent
strip=lambda s: re.sub(r'^export ', '', s, flags=re.M)
def inline_module(line, src):
    # "import {a, b} from '...';  //@INLINE_X" -> "const {a,b}=(()=>{ <module> ; return {a,b}; })();"
    names=re.search(r'import\s*\{([^}]*)\}',line).group(1)
    body=re.sub(r'^export ', '', src, flags=re.M)
    return 'const {'+names+'}=(()=>{\n'+body+'\nreturn {'+names+'};\n})();'
genraw=(d/'terrain-gen.js').read_text(); gen=strip(genraw); mat=(d/'terrain-material.js').read_text(); wat=(d/'water-material.js').read_text()
src=(d/'terrain-lab.src.html').read_text()
out=[]
for line in src.split('\n'):
    if '//@INLINE_GEN' in line: out.append(inline_module(line,genraw))
    elif '//@INLINE_MAT' in line: out.append(inline_module(line,mat))
    elif '//@INLINE_WAT' in line: out.append(inline_module(line,wat))
    elif '//@GEN_SRC' in line: out.append('const GEN_SRC='+json.dumps(gen)+';')
    else: out.append(line)
(d/'terrain-lab.html').write_text('\n'.join(out))
print('built terrain-lab.html')
