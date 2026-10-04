from PIL import Image
import numpy as np, io, base64
def L(i): return Image.open(f'../images/{i}.webp').convert('RGBA')
def u(c, q=85): b=io.BytesIO(); c.save(b,'WEBP',quality=q); return 'url(data:image/webp;base64,'+base64.b64encode(b.getvalue()).decode()+')'
def fit(c, w): 
  if c.width>w: c=c.resize((w, round(c.height*w/c.width)), Image.LANCZOS)
  return c
def mask(c):
  h=np.asarray(c).astype(float)/255; mx=h[...,:3].max(-1); mn=h[...,:3].min(-1); s=np.where(mx>0,(mx-mn)/np.maximum(mx,1e-6),0); d=np.maximum(mx-mn,1e-6)
  r,g,b=h[...,0],h[...,1],h[...,2]; hue=np.where(mx==r,((g-b)/d)%6,np.where(mx==g,(b-r)/d+2,(r-g)/d+4))*60
  w=np.clip((s-.2)/.25,0,1)*((hue>230)&(hue<315))*np.clip((mx-.06)/.1,0,1)*h[...,3]
  m=np.zeros(h.shape[:2]+(4,),np.uint8); m[...,:3]=255; m[...,3]=(w*255).astype(np.uint8); return Image.fromarray(m)
A={}; S={}
a57,a58,a59,a60,a61,a62=L(57),L(58),L(59),L(60),L(61),L(62)
crops={'titlebar':(a57,(151,8,1126,160)),'pill':(a57,(1121,17,1414,149)),'hero':(a57,(32,171,1504,570)),'secbar':(a57,(25,584,1512,676)),'row':(a57,(31,683,1506,877)),
 'gold':(a58,(40,133,750,454)),'coin':(a58,(849,754,1040,948)),'info':(a58,(1314,752,1497,940)),
 'i_team':(a59,(223,113,529,427)),'i_draft':(a59,(747,114,1022,427)),'i_up':(a59,(205,521,561,807)),'i_gym':(a59,(712,540,1071,811)),'nav4':(a59,(13,859,1240,1035)),'back':(a59,(113,1068,372,1235)),
 'title':(a60,(427,14,1106,192)),'room':(a61,(33,192,1504,865))}
eq=sorted([(23,10,346,364),(362,80,721,371),(736,90,1062,371),(19,377,354,692),(391,387,692,702),(720,387,1065,693),(11,695,362,1079),(371,755,722,1048),(744,689,1067,1063),(24,1102,348,1413),(372,1074,711,1414),(721,1073,1071,1423)],key=lambda b:(round(b[1]/300),b[0]))
for i,b in enumerate(eq): crops[f'eq{i}']=(a62,b)
a64=L(64)
eq2=[(26,5,355,393),(401,4,688,397),(721,21,1082,386),(30,404,383,778),(400,394,703,781),(760,397,1050,778),(14,791,372,1143),(404,780,714,1135),(760,778,1050,1148),(17,1142,388,1412),(399,1147,716,1426),(731,1179,1082,1422)]
for i,b in enumerate(eq2):
  c=a64.crop(b); bb=c.getbbox(); crops[f'eq{12+i}']=(a64,(b[0]+bb[0],b[1]+bb[1],b[0]+bb[2],b[1]+bb[3]))
css=':root{'
for k,(im,b) in crops.items():
  c=im.crop(b); c=fit(c, 700 if k in('hero','row','secbar','nav4','room') else 140 if k.startswith('eq') else 300)
  css+=f'--g-{k}:{u(c, 72 if k=="room" else 80)};'; S[k]=c.size
  if k in ('hero','row','secbar') or k.startswith('eq') or k=='room': css+=f'--gm-{k}:{u(mask(c),50)};'
css+='}\n'
open('gym_sprites.css','w').write(css); print(S)
