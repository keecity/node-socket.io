# Builds terrain-lab.html: a single self-contained file (modules inlined, worker from a Blob)
# so the lab opens by double-click as well as from a server.
import json, re, pathlib
d=pathlib.Path(__file__).parent
strip=lambda s: re.sub(r'^export ', '', s, flags=re.M)
gen=strip((d/'terrain-gen.js').read_text()); mat=strip((d/'terrain-material.js').read_text()); wat=strip((d/'water-material.js').read_text())
src=(d/'terrain-lab.src.html').read_text()
out=[]
for line in src.split('\n'):
    if '//@INLINE_GEN' in line: out.append(gen)
    elif '//@INLINE_MAT' in line: out.append(mat)
    elif '//@INLINE_WAT' in line: out.append(wat)
    elif '//@GEN_SRC' in line: out.append('const GEN_SRC='+json.dumps(gen)+';')
    else: out.append(line)
(d/'terrain-lab.html').write_text('\n'.join(out))
print('built terrain-lab.html')
