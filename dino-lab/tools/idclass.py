import numpy as np, colorsys
NAMES=['skin','mouth','dome','beak','site']
def classify(C):
    hsv=np.array([colorsys.rgb_to_hsv(*c) for c in C]); h=hsv[:,0]*360; s=hsv[:,1]
    k=np.zeros(len(C),int)                                   # purple skin by default
    sat=s>0.3
    k[sat&((h>=335)|(h<15))]=1                               # pink/red: mouth
    k[sat&(h>=15)&(h<48)]=2                                  # orange: dome / keratin cap
    k[sat&(h>=48)&(h<66)]=3                                  # yellow: beak
    k[sat&(h>=66)&(h<170)]=4                                 # green: attachment sites
    return k,hsv
