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
for _s in ['bounce','net','cheer','crowd','boo','rim','whistle','catch','pass']: assets['snd_'+_s] = base64.b64encode(open('snd/'+_s+'.mp3','rb').read()).decode()
assets['teal'] = base64.b64encode(open('tex_teal.jpg', 'rb').read()).decode()
head = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Court Clash 3v3</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Russo+One&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet"><style>
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
#meter.steal{background:linear-gradient(90deg,#d0283a 0,#d0283a 15.5%,#6a2a8f 15.5%,#3a6fe0 30%,#3fd0e0 45%,#3fd0e0 55%,#3a6fe0 70%,#6a2a8f 84.5%,#d0283a 84.5%,#d0283a)}.tag.near{box-shadow:0 0 0 2px #3fd0e0}
#stamina{position:absolute;left:50%;transform:translateX(-50%);top:calc(max(12px,env(safe-area-inset-top)) + 100px);width:min(160px,40vw);height:6px;border-radius:3px;background:#0008;box-shadow:0 0 0 1px #fff3;pointer-events:none}#stam{height:100%;border-radius:3px;background:linear-gradient(90deg,#ff9a3d,#ffd27a);transition:width .1s}#stamina.low #stam{background:#e04a3a}#stamina span{position:absolute;top:8px;width:100%;text-align:center;font-size:9px;letter-spacing:1.5px;color:#cfe0ea;text-shadow:0 1px 3px #000}
.tag .sbar{display:block;height:3px;margin:2px -2px 0;border-radius:2px;background:#0007;overflow:hidden}.tag .sbar b{display:block;height:100%;background:#ffd27a}.tag .sbar.low b{background:#e04a3a}
#ring{position:absolute;width:34px;height:14px;margin:-7px 0 0 -17px;border:2px solid #ffd27a;border-radius:50%;opacity:0;pointer-events:none}#ring.go{animation:ring .6s ease-out}@keyframes ring{from{opacity:1;transform:scale(.4)}to{opacity:0;transform:scale(1.6)}}
#online{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(320px,88vw);background:#0d1824ee;border:1px solid #2c4357;border-radius:14px;padding:16px;box-shadow:0 10px 40px #000a;z-index:20;font-size:13px}#online[hidden]{display:none}#online p{color:#b9cad6;line-height:1.4}#online i{color:#7f9cab}#onlist{display:flex;flex-direction:column;gap:6px;margin:8px 0}#online button{background:#4b2a8f;color:#fff;border:0;border-radius:9px;padding:9px 12px;font-weight:700;cursor:pointer}#onlist button{background:#127e75}.onrow{display:flex;gap:8px;justify-content:flex-end}#onclose{background:#2a3a48!important}
.sbar[hidden]{display:none!important}#tut{position:absolute;left:50%;transform:translateX(-50%);top:calc(max(12px,env(safe-area-inset-top)) + 64px);width:min(360px,92vw);background:#0d1824e6;border:1px solid #2c4357;border-radius:14px;padding:10px 14px;box-shadow:0 8px 30px #0009;font-size:13px;z-index:15;pointer-events:auto}#tut[hidden]{display:none}#tut b{font-size:14px;letter-spacing:.5px}#tut p{margin:5px 0 6px;color:#cfdde8;line-height:1.35;font-size:12px}.tsteps{display:flex;gap:5px;margin-bottom:6px}.tsteps i{flex:1;height:4px;border-radius:2px;background:#2a3a48}.tsteps i.d{background:#3fbf6a}.tsteps i.c{background:#ffb23e}.trow{display:flex;align-items:center;justify-content:space-between;gap:8px}#tok{color:#5fe08a;font-weight:700;font-size:12px}#tskip{background:#2a3a48;color:#cfe0ea;border:0;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer}
#hint{position:absolute;top:calc(max(12px,env(safe-area-inset-top)) + 62px);width:100%;text-align:center;font-size:11px;color:#cfe0ea;text-shadow:0 1px 4px #000;pointer-events:none}
#loading{position:absolute;top:45%;width:100%;text-align:center;color:#61d1c4;font-size:18px}#status{display:none}
@media(max-width:520px){#controls{gap:4px;flex-wrap:nowrap;max-width:100vw}#controls button{padding:6px 6px;font-size:10.5px;min-height:30px}.team{min-width:92px;padding:7px 10px}.team b{font-size:22px}#toast.big{font-size:24px}#banner{font-size:21px}}
/* ---------- arena HUD (scoreboard, tags, timing meter) ---------- */
body{font-family:'Rajdhani',system-ui,sans-serif}
.deco{position:absolute;pointer-events:none;width:46vw;height:120px;opacity:.9}
.deco.tl{left:0;top:0;background:linear-gradient(135deg,transparent 46%,#7b3cf0 46.5%,#7b3cf0 49%,transparent 49.5%,transparent 54%,#5a2bb5 54.5%,#5a2bb5 56%,transparent 56.5%)}
.deco.tr{right:0;top:0;background:linear-gradient(225deg,transparent 46%,#19c6c0 46.5%,#19c6c0 49%,transparent 49.5%,transparent 54%,#118f8b 54.5%,#118f8b 56%,transparent 56.5%)}
.deco.bl{left:0;bottom:0;background:linear-gradient(45deg,transparent 46%,#7b3cf0 46.5%,#7b3cf0 48.5%,transparent 49%)}
.deco.br{right:0;bottom:0;background:linear-gradient(-45deg,transparent 46%,#19c6c0 46.5%,#19c6c0 48.5%,transparent 49%)}
#board{top:max(8px,env(safe-area-inset-top));gap:0;border-radius:0;overflow:visible;box-shadow:none;align-items:flex-start;width:min(560px,96vw);justify-content:center}
#board .team{position:relative;flex:1;min-width:0;height:clamp(64px,17vw,92px);padding:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:0;
  background:linear-gradient(180deg,#c9d3dc,#6d7a86 45%,#e3e9ee 55%,#7c8894);filter:drop-shadow(0 6px 10px #0009)}
#board .t0{clip-path:polygon(9% 0,100% 0,100% 100%,0 100%,0 22%);margin-right:-6px}
#board .t1{clip-path:polygon(0 0,91% 0,100% 22%,100% 100%,0 100%);margin-left:-6px;flex-direction:column}
#board .team::before{content:'';position:absolute;inset:3px;z-index:-0}
#board .t0::before{clip-path:polygon(9% 0,100% 0,100% 100%,0 100%,0 22%);background:radial-gradient(circle at 18% 50%,#7a45e6 0 22%,transparent 23%),repeating-radial-gradient(circle at 18% 50%,transparent 0 9px,#ffffff10 9px 10px),linear-gradient(115deg,#2a1260,#4b25a6 40%,#1a0d3c)}
#board .t1::before{clip-path:polygon(0 0,91% 0,100% 22%,100% 100%,0 100%);background:radial-gradient(circle at 82% 50%,#16a9a3 0 22%,transparent 23%),repeating-radial-gradient(circle at 82% 50%,transparent 0 9px,#ffffff10 9px 10px),linear-gradient(245deg,#0b4a4c,#0f7e79 40%,#082a2c)}
#board .team span{position:relative;font-family:'Russo One',system-ui,sans-serif;font-size:clamp(13px,3.4vw,19px);letter-spacing:2px;color:#e6ecf2;text-shadow:0 2px 0 #0008}
#board .t1 span{font-style:italic}
#board .team b{position:relative;font-family:'Russo One',system-ui,sans-serif;font-size:clamp(30px,9vw,50px);line-height:1;color:#fff;text-shadow:0 3px 0 #0009,0 0 14px #fff3;min-width:0}
#board .team b::after{content:'';display:block;height:4px;width:60%;margin:3px auto 0;border-radius:2px}
#board .t0 b::after{background:#8b5cf6}#board .t1 b::after{background:#22d3cb}
#board .dot{position:absolute;width:12px;height:12px;top:50%;margin-top:-2px;background:transparent}
#board .t0 .dot{right:16%}#board .t1 .dot{left:16%}
#board .dot.on{background:#ffb627;box-shadow:0 0 10px #ffb627}
#mid{position:relative;z-index:2;width:clamp(96px,26vw,150px);height:clamp(78px,21vw,112px);padding:0;background:linear-gradient(180deg,#d6dde3,#6b7884 50%,#cdd5dc);clip-path:polygon(14% 0,86% 0,100% 18%,94% 78%,80% 100%,20% 100%,6% 78%,0 18%);filter:drop-shadow(0 6px 10px #000a);display:block}
#mid::before{content:'';position:absolute;inset:4px;clip-path:polygon(14% 0,86% 0,100% 18%,94% 78%,80% 100%,20% 100%,6% 78%,0 18%);background:radial-gradient(circle at 50% 42%,#2a1a08,#0b0f16 70%)}
#mid::after{content:'';position:absolute;left:50%;top:44%;width:62%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;
  background:repeating-conic-gradient(from -60deg,#ffb627 0 5deg,transparent 5deg 12deg);-webkit-mask:radial-gradient(circle,transparent 62%,#000 63% 72%,transparent 73%);mask:radial-gradient(circle,transparent 62%,#000 63% 72%,transparent 73%);opacity:.9}
#mid small{position:absolute;left:0;right:0;text-align:center;font-family:'Russo One',system-ui,sans-serif;color:#ffcf5a;letter-spacing:1px;font-size:clamp(9px,2.4vw,13px)}
#mid small:first-child{top:9%}
#mid small:last-child{bottom:4%;color:#dfe6ec;font-size:clamp(8px,2.1vw,11px);letter-spacing:1.5px}
#clock{position:absolute;left:0;right:0;top:44%;transform:translateY(-50%);text-align:center;font-family:'Russo One',system-ui,sans-serif;font-size:clamp(28px,8vw,46px);color:#ffc233;text-shadow:0 0 12px #ffb62777,0 3px 0 #000;min-height:0;z-index:1}
#menu-btn{position:absolute;top:calc(max(8px,env(safe-area-inset-top)) + 4px);right:max(8px,env(safe-area-inset-right));width:44px;height:48px;border:0;cursor:pointer;z-index:12;
  background:linear-gradient(180deg,#e2e8ee,#6c7884);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);display:grid;place-items:center}
#menu-btn::before{content:'';position:absolute;inset:3px;background:#0d141d;clip-path:inherit}
#menu-btn i{position:relative;width:12px;height:16px;border-left:4px solid #fff;border-right:4px solid #fff}
#controls{top:calc(max(8px,env(safe-area-inset-top)) + 58px);bottom:auto;left:auto;right:max(8px,env(safe-area-inset-right));transform:none;flex-direction:column;flex-wrap:nowrap;gap:6px;background:#0b121bf0;border:1px solid #2c4357;border-radius:12px;padding:8px;z-index:12;width:auto;max-width:none}
#controls[hidden]{display:none}
#controls button{font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:14px!important;padding:8px 14px!important;min-height:36px!important;text-align:left}
/* name tags */
.tag{font-family:'Russo One',system-ui,sans-serif;font-weight:400;font-size:12px;padding:3px 10px 4px;border-radius:3px;opacity:1;color:#fff;letter-spacing:.3px;
  background:linear-gradient(180deg,#14233a,#0b1626)!important;border:2px solid currentColor;clip-path:none;transform-origin:50% 100%}
.tag.t0{border-color:#8b5cf6;background:linear-gradient(180deg,#2c1863,#170c38)!important}.tag.t1{border-color:#22d3cb;background:linear-gradient(180deg,#0f3340,#0a1d27)!important}
.tag::after{content:'';position:absolute;left:50%;bottom:-9px;margin-left:-6px;border:6px solid transparent;border-top:7px solid #8b5cf6;border-bottom:0}
.tag.t1::after{border-top-color:#22d3cb}
.tag.ball{border-color:#ffc233!important;box-shadow:0 0 10px #ffb62788;font-size:14px}
.tag.ball::after{border-top-color:#ffc233;bottom:-12px;border-width:8px 8px 0}
.tag.near{box-shadow:0 0 0 2px #22d3cb,0 0 12px #22d3cb}
.tag .sbar{margin:3px 0 0}
/* bottom: hint + timing meter */
#hint{top:auto!important;bottom:calc(max(14px,env(safe-area-inset-bottom)) + 104px);font-size:14px;font-weight:600;color:#c8d4de;letter-spacing:.3px}
#hint b{color:#fff}
#meter{bottom:calc(max(14px,env(safe-area-inset-bottom)) + 30px);width:min(420px,90vw);height:46px;border-radius:0;opacity:.4;transform:translateX(-50%);box-shadow:none;
  background:linear-gradient(180deg,#e2e8ee,#5f6b77 50%,#c9d1d8);clip-path:polygon(3.5% 0,96.5% 0,100% 50%,96.5% 100%,3.5% 100%,0 50%);padding:0}
#meter.show{opacity:1;transform:translateX(-50%)}
#meter .zone{position:absolute;inset:6px 0;clip-path:polygon(0 0,100% 0,100% 100%,0 100%);
  background:repeating-linear-gradient(90deg,transparent 0 calc(100%/17 - 3px),#05080c calc(100%/17 - 3px) calc(100%/17)),
    linear-gradient(90deg,#273342 var(--g0),#22c55e var(--g0),#4ade80 50%,#22c55e var(--g1),#273342 var(--g1));box-shadow:inset 0 0 0 2px #05080c}
#meter.steal{background:linear-gradient(180deg,#e2e8ee,#5f6b77 50%,#c9d1d8)}
#meter.steal .zone{background:repeating-linear-gradient(90deg,transparent 0 calc(100%/17 - 3px),#05080c calc(100%/17 - 3px) calc(100%/17)),
    linear-gradient(90deg,#c0263a 0 15.5%,#273342 15.5% var(--g0),#22d3cb var(--g0),#67e8f9 50%,#22d3cb var(--g1),#273342 var(--g1) 84.5%,#c0263a 84.5%)}
#meter .perfect{display:none}
#mark{top:2px;height:42px;width:6px;margin-left:-3px;border-radius:3px;background:#fff;box-shadow:0 0 6px #fff,0 0 16px #b4ffcf,0 0 26px #4ade80;z-index:2}
#meter.steal #mark{box-shadow:0 0 6px #fff,0 0 16px #a5f3fc,0 0 26px #22d3cb}
#meter span#mlabel{top:-24px;font-family:'Russo One',system-ui,sans-serif;font-size:13px;letter-spacing:5px;color:#e6ecf2;font-weight:400}
#meter::after{content:'RELEASE';position:absolute;left:0;right:0;bottom:-24px;text-align:center;font-family:'Russo One',system-ui,sans-serif;font-size:12px;letter-spacing:6px;color:#c8d4de}
#meter.steal::after{content:'TAP'}
#meter{overflow:visible}
#meterwrap{position:absolute;left:0;right:0;bottom:0;height:150px;pointer-events:none;background:linear-gradient(180deg,transparent,#060a10cc 45%)}
#toast{top:calc(max(8px,env(safe-area-inset-top)) + 120px);font-family:'Russo One',system-ui,sans-serif;font-weight:400}
#toast.big{color:#ffc233}
#tut{top:calc(max(8px,env(safe-area-inset-top)) + 118px)}
#online-btn,#tut-btn{order:-1}
/* fixes */
#board{width:min(560px,calc(100vw - 66px));left:calc(50% - 25px)}
#mid{height:clamp(84px,23vw,118px)}
#mid::after{top:47%;width:54%}
#mid small:first-child{top:6%}#mid small:last-child{bottom:5%}
#clock{top:47%}
#hint{white-space:nowrap;font-size:clamp(10px,3vw,14px);font-weight:500}
#meter{background:none!important;clip-path:none!important}
#meter::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,#e2e8ee,#5f6b77 50%,#c9d1d8);clip-path:polygon(3.5% 0,96.5% 0,100% 50%,96.5% 100%,3.5% 100%,0 50%)}
#meter .zone{inset:6px 18px!important;clip-path:none!important;overflow:visible}
#mark{top:-4px;height:42px}
</style></head><body><canvas id="scene"></canvas><div class="deco tl"></div><div class="deco tr"></div><div class="deco bl"></div><div class="deco br"></div><div id="meterwrap"></div>
<div id="board"><div class="team t0"><span>PURPLE</span><b id="s0">0</b><i class="dot" id="poss0"></i></div><div id="mid"><small>SHOT</small><div id="clock"></div><small>FIRST TO 21</small></div><div class="team t1"><span>TEAL</span><b id="s1">0</b><i class="dot" id="poss1"></i></div></div>
<div id="tags"></div><div id="toast"></div><div id="banner"></div><div id="loading">Warming up… <small style="display:block;font-size:12px;color:#7f9cab;margin-top:8px">If this text never changes, this viewer is not running the page\'s scripts. Open the file in a browser.</small></div><div id="status"></div>
<div id="meter"><div class="zone"><div id="mark"></div></div><div class="perfect"></div><span id="mlabel">SHOT TIMING</span></div><div id="ring"></div><div id="hint">Tap to move &nbsp;•&nbsp; Tap teammate to pass &nbsp;•&nbsp; Hold to shoot</div>
<button id="menu-btn" aria-label="Menu"><i></i></button><div id="controls" hidden><button id="mode">Watch AI</button><button id="pause">Pause</button><button id="speed">1×</button><button id="cam">Broadcast cam</button><button id="restart">Restart</button><button id="mute">Mute</button></div>
'''
game = open('game.js').read()
stage = lambda t: '<script>document.getElementById("loading").textContent=' + json.dumps(t) + ';</script>'
onerr = '<script>window.addEventListener("error",e=>{const l=document.getElementById("loading");if(l&&!l.hidden)l.textContent="Error: "+e.message;});</script>'
html = head + onerr + stage('Loading engine…') + engine + '\n</script>' + stage('Unpacking court and players…') + '<script>const ASSETS=' + json.dumps(assets) + ';</script>' + stage('Starting…') + '<script>' + game + '</script></body></html>'
open(OUT, 'w').write(html)
print(len(html))
