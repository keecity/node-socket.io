from PIL import Image
import io, base64
im=Image.open('ui4/upanel.webp').convert('RGBA')
def u(c): b=io.BytesIO(); c.save(b,'WEBP',quality=88); return 'url(data:image/webp;base64,'+base64.b64encode(b.getvalue()).decode()+')'
css=':root{'
css+='--u-head:'+u(im.crop((0,0,700,64)))+';--u-strip:'+u(im.crop((0,63,700,64)))+';--u-foot:'+u(im.crop((0,262,700,279)))+';'
for i,c in enumerate((85,124,164,203,243)): css+=f'--u-row{i}:'+u(im.crop((0,c-19,700,c+19)))+';'
css+='}\n'
css+='''#team .upan{aspect-ratio:auto;background:none;display:flex;flex-direction:column}
#team .upan .uh{aspect-ratio:700/64;background:var(--u-head) center/100% 100% no-repeat}
#team .upan .uf{aspect-ratio:700/17;background:var(--u-foot) center/100% 100% no-repeat}
#team .upan .ug{position:relative;aspect-ratio:700/30;background:var(--u-strip) center/100% 100% repeat-y;display:flex;align-items:flex-end;padding:0 0 1.2% 17.6%;font-size:clamp(9px,2.6cqw,13px);letter-spacing:1px;color:#c9d6e2;line-height:1}
#team .upan .ug .lvn{position:absolute;right:6%;bottom:1.2%;font-size:.8em;color:#8fa3b5}
#team .urow{position:relative!important;left:auto!important;top:auto!important;width:100%!important;height:auto!important;aspect-ratio:700/38;background:center/100% 100% no-repeat;cursor:pointer}
#team .urow.r0{background-image:var(--u-row0)}#team .urow.r1{background-image:var(--u-row1)}#team .urow.r2{background-image:var(--u-row2)}#team .urow.r3{background-image:var(--u-row3)}#team .urow.r4{background-image:var(--u-row4)}
#team .urow .ubar{left:17.4%;top:26%;width:31.6%;height:48%}
#team .urow .uic{position:absolute;left:4.5%;top:0;width:8.5%;height:100%;border-radius:30%}
#team .urow:active .uic,#team .urow:hover .uic{box-shadow:0 0 0 2px #ffc233,0 0 10px #ffc23399}
#team .urow.max{cursor:default}#team .urow.max .b{color:#8fa3b5}
#team .xpb .xpfill{position:absolute;left:27.2%;top:56%;height:20%;border-radius:4px;background:linear-gradient(90deg,#c98a12,#ffc233);max-width:55.9%}
#team .xpb .dg{z-index:1}#team .xpb .need{font-size:.55em;margin-left:.3em;color:#e8eef4;align-self:center}
#ucf{position:absolute;inset:0;z-index:20;background:#000a;display:flex;align-items:center;justify-content:center}
#ucf[hidden]{display:none}
#ucf .box{width:86%;max-width:380px;background:linear-gradient(#152235,#0b1420);border:2px solid #b8c3cc;border-radius:10px;box-shadow:0 0 0 2px #0008,0 0 24px #000;padding:18px 16px 14px;text-align:center;color:#e8eef4}
#ucf h3{margin:0 0 4px;font:400 clamp(16px,5cqw,22px) 'Russo One',system-ui;letter-spacing:1px}
#ucf .chg{font:400 clamp(22px,7cqw,32px) 'Russo One',system-ui;margin:6px 0}#ucf .chg b{color:#43e3c7;font-weight:400}
#ucf .cst{font-size:13px;color:#c9d6e2;margin-bottom:12px}#ucf .cst b{color:#ffc233}
#ucf .bts{display:flex;gap:4%}#ucf .bts button{flex:1;aspect-ratio:459/113;font:400 clamp(12px,3.6cqw,16px) 'Russo One',system-ui;color:#fff;letter-spacing:1px}
#ucf .ok{background:var(--t-btn_gold_s) center/100% 100% no-repeat;color:#1a1206!important}#ucf .ok.off{filter:grayscale(1) brightness(.7)}
#ucf .no{background:var(--t-btn_dark) center/100% 100% no-repeat}
'''
open('upan.css','w').write(css)
import numpy as np
h=np.asarray(im.crop((0,0,700,64))).astype(float)/255
mx=h[...,:3].max(-1); mn=h[...,:3].min(-1); s=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0); d=np.maximum(mx-mn,1e-6)
r,g,b=h[...,0],h[...,1],h[...,2]
hue=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
w=np.clip((s-.2)/.25,0,1)*((hue>230)&(hue<315))*np.clip((mx-.06)/.1,0,1)*h[...,3]
m=np.zeros((64,700,4),np.uint8); m[...,:3]=255; m[...,3]=(w*255).astype(np.uint8)
css2=':root{--u-headm:'+u(Image.fromarray(m))+'}\n'
css2+="""#team .upan .uh{position:relative;isolation:isolate}#team .upan .uh::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background:var(--tc,#7b3cf0);-webkit-mask:var(--u-headm) center/100% 100% no-repeat;mask:var(--u-headm) center/100% 100% no-repeat;mix-blend-mode:color}
#team .urow .ubar b{background:var(--tcb,#8b4cf6)}
"""
open('upan.css','a').write(css2)
