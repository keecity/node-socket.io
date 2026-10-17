# Realistic foley set: generates any missing sounds into <out_dir>; key read from .el_key next to this script.
import json, os, sys, urllib.request
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
KEY = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.el_key')).read().strip()
R = ', realistic foley recording, no music, no beeps, no synth'
SFX = {
  # selecting units
  'select_mech':    ('giant steel robot shifting its weight, deep hydraulic servo groan and metal joint creak' + R, 1.2),
  'select_tank':    ('main battle tank diesel engine revving once at idle, heavy mechanical rumble' + R, 1.3),
  'select_heli':    ('military helicopter turbine whine rising, rotor blades thumping' + R, 1.3),
  'select_soldier': ('soldiers gear rattle, rifle sling and boots shuffling, quick radio squelch' + R, 0.8),
  # orders
  'order_move':     ('military field radio push-to-talk click and short static squelch' + R, 0.6),
  'order_attack':   ('assault rifle charging handle racked, metallic chamber clack' + R, 0.8),
  'mech_move':      ('heavy hydraulic actuators engaging on a giant robot leg, deep pneumatic hiss' + R, 1.0),
  'tank_move':      ('tank tracks clanking as it starts moving, engine load increasing' + R, 1.5),
  # building
  'place_building': ('heavy steel beams dropped on concrete, crane cable rattle' + R, 1.2),
  'construction':   ('busy construction site, hammering, power drill, metal scaffolding clanks' + R, 3.0),
  'build_done':     ('scaffolding poles being pulled down and stacked, final heavy metal clank' + R, 1.6),
  'demolish':       ('building demolition, concrete walls crumbling, debris falling, dust' + R, 3.0),
  'upgrade':        ('large electrical transformer powering up, heavy relay switch thunk and hum' + R, 1.6),
  # economy
  'cash':           ('stack of paper banknotes counted and handed over, coins dropped on a counter' + R, 1.0),
  'truck':          ('semi truck diesel engine pulling away, air brake release hiss' + R, 2.0),
  # interface
  'ui_click':       ('heavy toggle switch on a military control panel flicked' + R, 0.5),
  'ui_open':        ('metal clipboard and paper map unfolded on a table' + R, 0.6),
  'alert':          ('distant military base air raid siren wail, short' + R, 2.0),
  # combat extras
  'unit_destroyed': ('vehicle destroyed, metal tearing, secondary ammunition cooking off' + R, 2.5),
  'mech_boost':     ('jet thruster ignition roar, heavy exhaust blast' + R, 1.5),
  'heli_rotor':     ('military helicopter rotor loop, steady thumping blades and turbine' + R, 6.0),
}
for name, (text, sec) in SFX.items():
  path = os.path.join(OUT, name + '.mp3')
  if os.path.exists(path): continue
  req = urllib.request.Request('https://api.elevenlabs.io/v1/sound-generation', method='POST',
    data=json.dumps({'text': text, 'duration_seconds': sec, 'prompt_influence': 0.6}).encode(), headers={'xi-api-key': KEY, 'Content-Type': 'application/json'})
  try:
    with urllib.request.urlopen(req, timeout=120) as r: open(path, 'wb').write(r.read()); print('ok', name)
  except Exception as e: print('FAIL', name, e)
