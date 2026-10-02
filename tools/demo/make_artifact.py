h=open('/home/user/node-socket.io/public/court-demo.html').read()
h=h.replace('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">','',1)
h=h.replace('</style></head><body><canvas','</style><canvas',1)
assert h.endswith('</body></html>'); h=h[:-len('</body></html>')]
h=h.replace('html,body{margin:0;height:100%;background:#080e17;','html,body{margin:0;height:100%;background:#080e17;color-scheme:dark;',1)
h=h.replace('canvas{width:100vw;height:100vh;display:block;touch-action:none}','canvas{position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none}',1)
assert h.startswith('<title>'); open('court-clash.html','w').write(h); print('artifact', len(h))
