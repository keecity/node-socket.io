"""Assemble the AI vs AI demo: court page engine + assets + new player GLB + game script."""
import json, re, base64, sys
SRC = sys.argv[1]; OUT = sys.argv[2]
lines = open(SRC).read().split('\n')
start = next(i for i, l in enumerate(lines) if l.startswith('<script>'))           # engine script starts
end = next(i for i, l in enumerate(lines) if l.startswith('</script><script>const ASSETS='))
engine = '<script>' + open('node_modules/playcanvas/build/playcanvas.min.js').read()
assets = json.loads(re.search(r'const ASSETS=(\{.*?\});', lines[end]).group(1))
assets['player'] = base64.b64encode(open('player_rigged.glb', 'rb').read()).decode()
assets['color'] = base64.b64encode(open('color.jpg', 'rb').read()).decode()
assets['height'] = base64.b64encode(open('height.jpg', 'rb').read()).decode()
assets['teal'] = base64.b64encode(open('tex_teal.jpg', 'rb').read()).decode()
head = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Court Clash 3v3</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#080e17;font-family:system-ui,sans-serif;color:#eaf1f7;overflow:hidden}
canvas{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;width:100vw;height:100vh;display:block;touch-action:none}
#board{position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;align-items:stretch;gap:0;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px #0007;font-variant-numeric:tabular-nums;user-select:none}
.team{display:flex;align-items:center;gap:10px;padding:8px 14px;min-width:120px}
.t0{background:#4b2a8f}.t1{background:#127e75;flex-direction:row-reverse}
.team b{font-size:26px;font-weight:800;min-width:30px;text-align:center}.team span{font-size:12px;letter-spacing:2px;font-weight:700}
.dot{width:8px;height:8px;border-radius:50%;background:#fff3;transition:.2s}.dot.on{background:#ffb23e;box-shadow:0 0 8px #ffb23e}
#mid{background:#101b28;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 12px;min-width:58px}
#mid small{font-size:9px;color:#7f9cab;letter-spacing:1.5px}#clock{font-size:20px;font-weight:800;color:#ffb23e;min-height:24px}
#toast{position:absolute;top:22%;width:100%;text-align:center;font-size:18px;font-weight:700;letter-spacing:.5px;opacity:0;transform:translateY(8px);transition:.25s;pointer-events:none;text-shadow:0 2px 12px #000c}
#toast.show{opacity:1;transform:none}#toast.big{font-size:30px;font-weight:900;color:#ffd27a}
#banner{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%) scale(.8);padding:18px 28px;border-radius:14px;font-size:28px;font-weight:900;opacity:0;transition:.3s;pointer-events:none;white-space:nowrap}
#banner.show{opacity:1;transform:translate(-50%,-50%) scale(1)}#banner.t0{background:#4b2a8fee}#banner.t1{background:#127e75ee}
#controls{position:absolute;bottom:max(14px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 24px)}
#controls button{font:inherit;font-size:13px;color:#dbe6ef;border:1px solid #40505f;border-radius:9px;background:#101b28dd;padding:10px 14px;cursor:pointer;min-height:40px}
#controls button:hover{background:#2b4055}#mute.on{background:#5a2b2b}
#tags{position:absolute;inset:0;pointer-events:none;overflow:hidden}.tag{position:absolute;left:0;top:0;font-size:11px;font-weight:700;padding:2px 7px;border-radius:9px;white-space:nowrap;opacity:.85}.tag.t0{background:#4b2a8fcc}.tag.t1{background:#127e75cc}.tag.ball{opacity:1;box-shadow:0 0 0 2px #ffb23e;font-size:12px}
#meter{position:absolute;left:50%;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 60px);transform:translateX(-50%) scale(.9);width:min(260px,70vw);height:22px;border-radius:11px;--g0:46%;--g1:54%;background:linear-gradient(90deg,#b8383b,#e0a83a 22%,#3fbf6a var(--g0),#3fbf6a var(--g1),#e0a83a 78%,#b8383b);transition:opacity .15s,transform .15s;box-shadow:0 0 0 2px #0009,0 6px 18px #0008;opacity:0;transition:.15s;pointer-events:none}
#meter.show{opacity:1;transform:translateX(-50%) scale(1)}#meter .perfect{position:absolute;left:46%;width:8%;transition:left .2s,width .2s;top:-4px;bottom:-4px;border-radius:3px;border:2px solid #fff}
#mark{position:absolute;top:-7px;width:6px;height:36px;margin-left:-3px;border-radius:3px;background:#fff;box-shadow:0 0 8px #000}#meter span{position:absolute;top:28px;width:100%;text-align:center;font-size:10px;letter-spacing:1.5px;font-weight:700;color:#fff;text-shadow:0 1px 4px #000}
#meter.steal{background:linear-gradient(90deg,#6a2a8f,#3a6fe0 30%,#3fd0e0 45%,#3fd0e0 55%,#3a6fe0 70%,#6a2a8f)}.tag.near{box-shadow:0 0 0 2px #3fd0e0}
#stamina{position:absolute;left:50%;transform:translateX(-50%);top:calc(max(12px,env(safe-area-inset-top)) + 100px);width:min(160px,40vw);height:6px;border-radius:3px;background:#0008;box-shadow:0 0 0 1px #fff3;pointer-events:none}#stam{height:100%;border-radius:3px;background:linear-gradient(90deg,#ff9a3d,#ffd27a);transition:width .1s}#stamina.low #stam{background:#e04a3a}#stamina span{position:absolute;top:8px;width:100%;text-align:center;font-size:9px;letter-spacing:1.5px;color:#cfe0ea;text-shadow:0 1px 3px #000}
#ring{position:absolute;width:34px;height:14px;margin:-7px 0 0 -17px;border:2px solid #ffd27a;border-radius:50%;opacity:0;pointer-events:none}#ring.go{animation:ring .6s ease-out}@keyframes ring{from{opacity:1;transform:scale(.4)}to{opacity:0;transform:scale(1.6)}}
#hint{position:absolute;top:calc(max(12px,env(safe-area-inset-top)) + 62px);width:100%;text-align:center;font-size:11px;color:#cfe0ea;text-shadow:0 1px 4px #000;pointer-events:none}
#loading{position:absolute;top:45%;width:100%;text-align:center;color:#61d1c4;font-size:18px}#status{display:none}
@media(max-width:520px){#controls{gap:5px;flex-wrap:nowrap}#controls button{padding:6px 8px;font-size:11px;min-height:30px}.team{min-width:92px;padding:7px 10px}.team b{font-size:22px}#toast.big{font-size:24px}#banner{font-size:21px}}
</style></head><body><canvas id="scene"></canvas>
<div id="board"><div class="team t0"><span>PURPLE</span><b id="s0">0</b><i class="dot" id="poss0"></i></div><div id="mid"><small>SHOT</small><div id="clock"></div><small>TO 21</small></div><div class="team t1"><span>TEAL</span><b id="s1">0</b><i class="dot" id="poss1"></i></div></div>
<div id="tags"></div><div id="toast"></div><div id="banner"></div><div id="loading">Warming up… <small style="display:block;font-size:12px;color:#7f9cab;margin-top:8px">If this text never changes, this viewer is not running the page\'s scripts. Open the file in a browser.</small></div><div id="status"></div>
<div id="meter"><div class="zone"></div><div class="perfect"></div><div id="mark"></div><span id="mlabel">RELEASE IN THE CENTRE</span></div><div id="ring"></div><div id="stamina"><div id="stam"></div><span>STAMINA</span></div><div id="hint">You are <b>Purple</b> · tap court to move · tap a teammate to pass · keep tapping the spot to sprint · hold to shoot · on defense get close and tap to steal</div>
<div id="controls"><button id="mode">Watch AI</button><button id="pause">Pause</button><button id="speed">1×</button><button id="cam">Broadcast cam</button><button id="restart">Restart</button><button id="mute">Mute</button></div>
'''
game = open('game.js').read()
stage = lambda t: '<script>document.getElementById("loading").textContent=' + json.dumps(t) + ';</script>'
onerr = '<script>window.addEventListener("error",e=>{const l=document.getElementById("loading");if(l&&!l.hidden)l.textContent="Error: "+e.message;});</script>'
html = head + onerr + stage('Loading engine…') + engine + '\n</script>' + stage('Unpacking court and players…') + '<script>const ASSETS=' + json.dumps(assets) + ';</script>' + stage('Starting…') + '<script>' + game + '</script></body></html>'
open(OUT, 'w').write(html)
print(len(html))
