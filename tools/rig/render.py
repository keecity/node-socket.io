from load import *;import io;from PIL import Image,ImageDraw
def render(P,F,cols,out,view="front",S=600):
    imgs=[]
    for v in (["front","side"] if view=="both" else [view]):
        if v=="front":X,Y,Z=P[:,0],P[:,1],P[:,2]
        else:X,Y,Z=-P[:,2]+0.3,P[:,1],P[:,0]
        im=Image.new("RGB",(S,S),(40,40,50));d=ImageDraw.Draw(im)
        order=np.argsort(Z[F].mean(1))
        for i in order:
            pts=[((X[j]+0.55)*S/1.1,(0.95-Y[j])*S/1.1) for j in F[i]];d.polygon(pts,fill=tuple(cols[i]))
        imgs.append(im)
    W=Image.new("RGB",(S*len(imgs),S));[W.paste(m,(k*S,0)) for k,m in enumerate(imgs)];W.save(out)
def texcols(U,F,im):
    T=np.asarray(Image.open(io.BytesIO(im)).convert("RGB"));h,w,_=T.shape;uv=U[F].mean(1)
    return T[np.clip((uv[:,1]*h).astype(int),0,h-1),np.clip((uv[:,0]*w).astype(int),0,w-1)]
