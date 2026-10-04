import sys
from clips import *; import pv
from pv import deform, draw
from PIL import Image, ImageOps
v0 = pv.view_mat
pv.view_mat = lambda k: R3(('y', 90)) if k == 'rside' else v0(k)
fr, bl = CLIPS['DribbleRun'](); n = len(fr) - 1
ys=[b[1] for b in bl[:n]]; fl=int(np.argmin(ys)); print('floor', fl)
refk=[0,4,8,11,14,18,22,25]; S=260; W=Image.new('RGB',(S*len(refk),S*2),(30,32,40)); import subprocess
for i,k in enumerate(refk):
    f=int(round(fl+(k-4)*n/28))%n
    Q=deform(fr[f]); r=fr[f]['_root']; cen=pv.view_mat('rside')@(np.array([0,0.45,0])+r)
    im=draw(Q,bl[f],'rside',(cen[0],cen[1],0.6),S,'')
    W.paste(im if sys.argv[1:]==['nomirror'] else ImageOps.mirror(im),(S*i,S))
    subprocess.run(['ffmpeg','-v','error','-y','-ss',str(0.75+k/24),'-i','/root/.claude/uploads/f39474d5-a23f-5b25-8a44-868a8905bd48/b4ce331d-run_dribble.mp4','-frames:v','1','-vf',f'crop=420:420:217:30,scale={S}:{S}','ref/r.png'])
    W.paste(Image.open('ref/r.png').convert('RGB'),(S*i,0))
W.save('cmp_drun.png')
