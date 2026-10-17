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
  'place_building': ('a single heavy concrete foundation block set down on the ground by a crane, one deep solid thud, short' + R, 0.8),
  'construction':   ('steady rhythmic hammering on wood and nails at a construction site, several workers hammering, natural' + R, 4.0),
  'build_done':     ('heavy steel blast door closing and locking with a deep mechanical latch, solid and satisfying' + R, 1.2),
  'demolish':       ('building demolition, concrete walls crumbling, debris falling, dust' + R, 3.0),
  'upgrade':        ('large electrical transformer powering up, heavy relay switch thunk and hum' + R, 1.6),
  # economy
  'cash':           ('modern user interface purchase confirmation, soft digital two-note confirm with subtle shimmer, high quality strategy game menu sound, not retro, not arcade', 0.8),
  'truck':          ('semi truck diesel engine pulling away, air brake release hiss' + R, 2.0),
  # interface
  'ui_click':       ('modern sleek user interface button click, short soft digital tick, subtle, high quality game menu sound, not retro, not arcade', 0.5),
  'ui_open':        ('modern sleek user interface panel open, short soft digital whoosh with gentle tick, high quality game menu sound, not retro, not arcade', 0.6),
  'rifle':          ('loud close-range single assault rifle gunshot, sharp crack with short outdoor echo' + R, 0.7),
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
