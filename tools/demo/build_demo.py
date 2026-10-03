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
/* ---------- arena HUD built from the sprite sheet ---------- */
body{font-family:'Rajdhani',system-ui,sans-serif}
.deco{position:absolute;pointer-events:none;opacity:.95}
.deco.tl{left:0;top:0;width:46vw;height:120px;background:linear-gradient(135deg,transparent 46%,#7b3cf0 46.5%,#7b3cf0 49%,transparent 49.5%,transparent 54%,#5a2bb5 54.5%,#5a2bb5 56%,transparent 56.5%)}
.deco.tr{right:0;top:0;width:46vw;height:120px;background:linear-gradient(225deg,transparent 46%,#19c6c0 46.5%,#19c6c0 49%,transparent 49.5%,transparent 54%,#118f8b 54.5%,#118f8b 56%,transparent 56.5%)}
.deco.bl{left:0;bottom:0;width:min(40vw,240px);aspect-ratio:341/150;background:var(--i-decol) no-repeat left bottom/contain}
.deco.br{right:0;bottom:0;width:min(40vw,240px);aspect-ratio:341/152;background:var(--i-decor) no-repeat right bottom/contain}
#board{--W:min(600px,calc(100vw - 62px));top:max(6px,env(safe-area-inset-top));left:calc(50% - 26px);transform:translateX(-50%);width:var(--W);height:calc(var(--W) * 177 / 1278);
  display:block;border-radius:0;overflow:visible;box-shadow:none;filter:drop-shadow(0 6px 10px #000a)}
#board .team,#mid{position:absolute;top:0;height:100%;padding:0;min-width:0;background:none;display:block}
#board .t0{left:0;width:39.05%;background:var(--i-pl) no-repeat center/100% 100%}
#mid{left:38.6%;width:21.75%;background:var(--i-pc) no-repeat center/100% 100%;z-index:2;clip-path:none;filter:none}
#board .t1{right:0;width:39.2%;background:var(--i-pr) no-repeat center/100% 100%}
#board .team::before,#mid::before,#mid::after,#board .team b::after{display:none!important}
#board .team span,#mid small{display:none}
.lbl{position:absolute;display:block;background:no-repeat center/contain}
.t0 .lbl{left:42%;width:48%;top:6%;height:32%;background-image:var(--i-lpurple)}
.t1 .lbl{left:10%;width:42%;top:6%;height:32%;background-image:var(--i-lteal)}
#mid .lbl{left:24%;width:52%;top:8%;height:24%;background-image:var(--i-lshot)}
.num{position:absolute;display:flex;justify-content:center;align-items:center;gap:0;height:48%;top:38%;font-size:0}
.t0 .num{left:44%;width:44%}.t1 .num{left:12%;width:40%}
#clock.num{left:0;width:100%;top:36%;height:44%;min-height:0;transform:none;text-shadow:none}
.num i{display:block;height:100%;background:no-repeat center/contain;margin:0 -1%}
#board .dot{position:absolute;width:9%;height:auto;aspect-ratio:1;top:50%;margin:0;border-radius:0;background:var(--i-dot) no-repeat center/contain;opacity:0;box-shadow:none;transition:opacity .2s}
#board .t0 .dot{left:88%}#board .t1 .dot{left:3%}
#board .dot.on{opacity:1;background:var(--i-dot) no-repeat center/contain;box-shadow:none}
#ft21{position:absolute;left:36.5%;width:26%;top:88%;aspect-ratio:461/96;background:var(--i-ft21) no-repeat center/contain;z-index:3}
#menu-btn{position:absolute;top:calc(max(6px,env(safe-area-inset-top)) + 6px);right:max(6px,env(safe-area-inset-right));width:46px;height:51px;border:0;cursor:pointer;z-index:12;background:var(--i-pause) no-repeat center/contain;clip-path:none;padding:0}
#menu-btn::before,#menu-btn i{display:none}
#controls{top:calc(max(8px,env(safe-area-inset-top)) + 62px);bottom:auto;left:auto;right:max(8px,env(safe-area-inset-right));transform:none;flex-direction:column;flex-wrap:nowrap;gap:6px;background:#0b121bf0;border:1px solid #2c4357;border-radius:12px;padding:8px;z-index:12;width:auto;max-width:none}
#controls[hidden]{display:none}
#controls button{font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:14px!important;padding:8px 14px!important;min-height:36px!important;text-align:left}
/* name tags */
.tag{font-family:'Russo One',system-ui,sans-serif;font-weight:400;font-size:13px;padding:5px 15px 14px;border:0;border-radius:0;opacity:1;color:#fff;text-shadow:0 1px 2px #000;box-shadow:none!important;
  background:var(--i-tagp) no-repeat center/100% 100%!important;min-width:58px;text-align:center}
.tag.t1{background-image:var(--i-tagt)!important}
.tag.ball{z-index:3;background-image:var(--i-tagg)!important;font-size:15px;padding:6px 17px 18px}
.tag::after{display:none}
.tag.near{filter:drop-shadow(0 0 6px #22d3cb)}
.tag .sbar{margin:2px 0 0;height:3px}
/* bottom: hint plate + timing meter */
#hint{top:auto!important;bottom:calc(max(12px,env(safe-area-inset-bottom)) + 108px);left:50%;width:min(360px,86vw);transform:translateX(-50%);aspect-ratio:583/69;font-size:0!important;background:var(--i-hint) no-repeat center/contain;text-shadow:none}
#meter{bottom:calc(max(12px,env(safe-area-inset-bottom)) + 30px);width:min(440px,92vw);height:auto;aspect-ratio:1173/112;border-radius:0;opacity:.45;transform:translateX(-50%);box-shadow:none;overflow:visible;
  background:var(--i-meter) no-repeat center/100% 100%!important;clip-path:none!important;padding:0}
#meter::before{display:none}
#meter.show{opacity:1;transform:translateX(-50%)}
#meter .zone{position:absolute;left:5.4%;right:5.4%;top:18%;bottom:18%;inset:18% 5.4%!important;overflow:visible;clip-path:none!important;box-shadow:none;
  background:none!important}
#meter .zone::before{content:'';position:absolute;inset:0;background:var(--i-green) repeat-x left center/auto 100%;
  -webkit-mask:linear-gradient(90deg,transparent var(--g0),#000 var(--g0),#000 var(--g1),transparent var(--g1));mask:linear-gradient(90deg,transparent var(--g0),#000 var(--g0),#000 var(--g1),transparent var(--g1))}
#meter.steal .zone::before{filter:hue-rotate(38deg) saturate(1.2)}
#meter.steal .zone::after{content:'';position:absolute;inset:0;background:#d0283acc;-webkit-mask:linear-gradient(90deg,#000 0 15.5%,transparent 15.5% 84.5%,#000 84.5%);mask:linear-gradient(90deg,#000 0 15.5%,transparent 15.5% 84.5%,#000 84.5%)}
#meter .perfect{display:none}
#mark{top:-22%;height:144%;width:auto;aspect-ratio:43/104;margin-left:0;transform:translateX(-50%);border-radius:0;background:var(--i-mark) no-repeat center/contain;box-shadow:none;z-index:2}
#meter span#mlabel{left:50%;transform:translateX(-50%);top:-34px;width:auto;height:26px;aspect-ratio:229/64;font-size:0;background:var(--i-ltiming) no-repeat center/contain;text-shadow:none}
#meter.steal span#mlabel{aspect-ratio:auto;font-size:12px;font-family:'Russo One',system-ui,sans-serif;letter-spacing:2px;color:#fff;background:#0b121b;border:2px solid #9aa6b2;padding:2px 12px;height:auto;width:auto;white-space:nowrap}
#meter::after{content:'';position:absolute;left:50%;transform:translateX(-50%);bottom:-32px;height:24px;aspect-ratio:189/64;background:var(--i-lrelease) no-repeat center/contain}
#meterwrap{position:absolute;left:0;right:0;bottom:0;height:170px;pointer-events:none;background:linear-gradient(180deg,transparent,#060a10cc 45%)}
#toast{top:calc(max(8px,env(safe-area-inset-top)) + 140px);font-family:'Russo One',system-ui,sans-serif;font-weight:400}
#toast.big{color:#ffc233}
#tut{top:calc(max(8px,env(safe-area-inset-top)) + 136px)}
'''+open('ui_sprites.css').read()+'''</style></head><body><canvas id="scene"></canvas><div class="deco tl"></div><div class="deco tr"></div><div class="deco bl"></div><div class="deco br"></div><div id="meterwrap"></div>
<div id="board"><div class="team t0"><i class="lbl"></i><b id="s0" class="num"></b><i class="dot" id="poss0"></i></div><div id="mid"><i class="lbl"></i><div id="clock" class="num"></div></div><div class="team t1"><i class="lbl"></i><b id="s1" class="num"></b><i class="dot" id="poss1"></i></div><div id="ft21"></div></div>
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
