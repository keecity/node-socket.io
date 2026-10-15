# Generates the game's sound effects with the ElevenLabs sound-generation API.
# usage: python3 gen_sfx.py <out_dir>   (key read from .el_key next to this script; existing files are skipped)
import json, os, sys, urllib.request
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
KEY = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.el_key')).read().strip()
SFX = {  # name: (prompt, seconds)
  'explosion':      ('large explosion with debris and rumble, cinematic war game sound effect', 3.0),
  'explosion_small':('small sharp explosion, missile impact, game sound effect', 1.5),
  'beam':           ('futuristic mecha beam rifle shot, charged energy blast with electric crackle', 1.2),
  'tank_cannon':    ('tank main cannon firing, deep heavy boom with echo', 2.0),
  'heli_gun':       ('short burst of helicopter rotary chain gun fire', 1.0),
  'missile':        ('rocket missile launch whoosh', 1.5),
  'rifle':          ('single assault rifle shot outdoors', 0.6),
  'mech_step':      ('giant robot mech heavy metal footstep thud with hydraulic hiss', 1.0),
  'saber':          ('energy beam saber ignite and hum, sci-fi', 1.5),
  'construction':   ('construction site, hammering and metal scaffolding clanks', 3.0),
  'build_done':     ('positive short sci-fi interface chime, construction complete', 1.0),
  'hangar_door':    ('massive hangar door opening, heavy mechanical servo and hydraulic release', 3.0),
  'collapse':       ('building collapsing, concrete crumbling and dust', 3.0),
  'alert':          ('military radar alert warning beeps', 1.5),
  'ui_click':       ('soft clean futuristic user interface click', 0.5),
  'cash':           ('cash register coins transaction sound, short', 0.8),
  'ambience_day':   ('calm countryside town daytime ambience, distant birds, light wind, distant traffic', 20.0),
  'ambience_night': ('quiet night ambience, crickets, light wind, distant dog barking', 20.0),
}
for name, (text, sec) in SFX.items():
  path = os.path.join(OUT, name + '.mp3')
  if os.path.exists(path): print('skip', name); continue
  req = urllib.request.Request('https://api.elevenlabs.io/v1/sound-generation', method='POST',
    data=json.dumps({'text': text, 'duration_seconds': sec, 'prompt_influence': 0.55}).encode(),
    headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
  try:
    with urllib.request.urlopen(req, timeout=120) as r: open(path, 'wb').write(r.read()); print('ok', name, os.path.getsize(path))
  except Exception as e: print('FAIL', name, e)
