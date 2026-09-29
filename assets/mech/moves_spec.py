"""Hand-authored move set for the shield mech (game clip names, order and timing).

Poses are dicts of bone -> (x, y, z) Euler degrees in this rig's conventions:
  * bones pointing down (arms, legs, hands, feet, skirts): +x swings the tip forward,
    +z swings it toward the mech's left (+X). So left arm out = +z, right arm out = -z.
  * Hips / Spine / Head (pointing up): +x leans forward, +y turns to the mech's left,
    +z leans to the mech's right.
  * LowerLeg: negative x bends the knee. ForeArm: positive x bends the elbow.
Special keys: 'lift' (m, added after grounding), 'fistR' 0..1, 'saber' (held), 'blade' 0..1,
'gun' 0/1, 'sab' = ((x,y,z) hilt position, (x,y,z) blade direction) solved onto the right arm.
Positions are in the mech's space: +X its left, -Y its front, Z up (ground = 0).
"""


def M(*dicts, **kw):
    out = {}
    for d in dicts:
        out.update(d)
    out.update(kw)
    return out


def legs(tl, kl, tr, kr, al=3, ar=-4, fl=0, fr=0):
    """thigh/knee angles per side; feet kept flat (plus optional extra point)."""
    return {'UpperLeg_L': (tl, 0, al), 'LowerLeg_L': (kl, 0, 0), 'Foot_L': (-(tl + kl) + fl, 0, 0),
            'UpperLeg_R': (tr, 0, ar), 'LowerLeg_R': (kr, 0, 0), 'Foot_R': (-(tr + kr) + fr, 0, 0)}


# ---------------------------------------------------------------- building blocks
STAND = legs(2, -4, 2, -4)
READY_LEGS = legs(16, -28, -6, -20)                      # left foot forward, knees soft
LOW_LEGS = legs(24, -44, -2, -34)
WIDE_LEGS = legs(8, -14, -4, -12, al=8, ar=-9)

# shield-arm poses solved from the shield geometry: shield stays upright, face out,
# collarbone within ~10 deg (so the shoulder stays seated)
SH_CARRY = {'Shoulder_L': (4.4, -5.0, -0.7), 'UpperArm_L': (-13.5, -3.2, 0.0), 'ForeArm_L': (8.9, 0, 0)}
SH_READY = {'Shoulder_L': (10.2, -8.8, 8.9), 'UpperArm_L': (-10.6, 14.2, -10.6), 'ForeArm_L': (0.0, 0, 0)}
SH_BRACE = {'Shoulder_L': (11.4, -9.9, 7.3), 'UpperArm_L': (-51.9, 47.5, -9.6), 'ForeArm_L': (45.9, 0, 0)}
SH_BASH = {'Shoulder_L': (11.3, -4.8, 10.3), 'UpperArm_L': (-13.0, 61.8, 34.2), 'ForeArm_L': (51.8, 0, 0)}
SH_BLOCK = {'Shoulder_L': (7.2, 2.0, 11.0), 'UpperArm_L': (-15.7, 50.5, 20.6), 'ForeArm_L': (74.1, 0, 0)}  # shield across the chest
SH_BACK = {'Shoulder_L': (-10.2, -2.1, -7.2), 'UpperArm_L': (-46.0, -0.9, 7.6), 'ForeArm_L': (55.4, 0, 0)}

R_GUARD = {'UpperArm_R': (22, 0, -12), 'ForeArm_R': (78, 0, 0), 'Hand_R': (0, 0, 0), 'fistR': 1}
R_LOW = {'UpperArm_R': (6, 0, -6), 'ForeArm_R': (20, 0, 0), 'fistR': 0.4}
R_BACK = {'UpperArm_R': (-25, 0, -10), 'ForeArm_R': (25, 0, 0), 'fistR': 1}

TORSO_READY = {'Spine': (5, -8, 0), 'Head': (-3, 7, 0)}
BATTLE = M(READY_LEGS, SH_READY, R_GUARD, TORSO_READY)
GUN_LOW = {'UpperArm_R': (22, 0, -10), 'ForeArm_R': (58, 0, 0), 'Hand_R': (0, 0, 0), 'fistR': 1, 'gun': 1}
GUN_AIM = {'UpperArm_R': (84, 0, -4), 'ForeArm_R': (4, 0, 0), 'Hand_R': (0, 0, 0), 'fistR': 1, 'gun': 1}
SABER_ON = {'fistR': 1, 'saber': 1, 'blade': 1}
# saber at the ready: same arm as the approved Saber_Idle
S_READY = M(SABER_ON, {'UpperArm_R': (30, 0, -14), 'ForeArm_R': (70, 0, 0), 'Hand_R': (-20, 0, 0)})


def S(pos, d):
    return M(SABER_ON, sab=(pos, d))


# blade key positions (hilt position, blade direction)
SB_HIGH_R = S((-0.55, 0.30, 2.55), (-0.25, 0.55, 0.8))      # wound up over the right shoulder
SB_LOW_L = S((0.22, -0.40, 1.45), (0.6, -0.45, -0.65))       # finished low left
SB_SIDE_R = S((-0.62, -0.30, 1.75), (-0.85, -0.45, 0.15))    # backhand finish, out right
SB_OVER = S((-0.12, 0.10, 2.95), (0.0, 0.45, 0.9))           # raised overhead
SB_CLEAVE = S((-0.10, -0.60, 1.55), (0.0, -0.55, -0.83))     # cleave finished in front
SB_CHAMBER = S((-0.45, 0.15, 1.90), (0.0, -1.0, 0.1))        # thrust chambered at the hip
SB_THRUST = S((-0.15, -0.80, 1.95), (0.0, -1.0, 0.05))       # arm extended, blade forward
SB_LOW_R = S((-0.40, -0.25, 1.25), (-0.2, -0.5, -0.85))      # low, blade down in front
SB_UP = S((-0.25, -0.35, 2.70), (0.0, -0.3, 0.95))           # rising cut finished high
SB_SWEEP_A = S((-0.70, 0.15, 1.90), (-0.9, 0.35, 0.1))       # sweep start, out to the right
SB_SWEEP_B = S((0.45, -0.35, 1.90), (0.9, -0.35, 0.0))       # sweep end, across to the left
SB_HIGH_L = S((0.20, -0.10, 2.60), (0.5, 0.35, 0.8))         # wound up high on the left
SB_PARRY = S((-0.05, -0.45, 2.05), (0.35, -0.1, 0.93))       # blade upright across the front
SB_WAIST_R = S((-0.60, 0.00, 1.80), (-0.9, 0.2, 0.3))
SB_WAIST_L = S((0.35, -0.45, 1.80), (0.8, -0.5, 0.2))
SB_TRAIL = S((-0.55, 0.35, 1.50), (-0.3, 0.8, -0.5))         # held low behind while dashing
SB_UPCUT_L = S((0.30, -0.30, 2.60), (0.5, -0.2, 0.85))


# ---------------------------------------------------------------- clips
# each clip: dur (s), loop, keys [(t, pose)], optional fx(u, pose) additive overlay,
# ground (keep feet on the floor), gun/saber flags come from the poses.
CLIPS = {}


def clip(name, dur, keys, loop=False, fx=None, ground=True):
    CLIPS[name] = dict(dur=dur, keys=keys, loop=loop, fx=fx, ground=ground)


import math
sin, cos, pi = math.sin, math.cos, math.pi


def breathe(amp=1.0):
    def f(u, p):
        b = 0.5 - 0.5 * cos(2 * pi * u)
        add(p, 'Spine', (-1.2 * amp * sin(2 * pi * u), 0, 0))
        add(p, 'Head', (0.8 * amp * sin(2 * pi * u - 0.6), 0, 0))
        add(p, 'UpperArm_R', (1.5 * amp * sin(2 * pi * u), 0, 0))
        add(p, 'ForeArm_R', (2.0 * amp * sin(2 * pi * u - 0.4), 0, 0))
        add(p, 'ForeArm_L', (1.2 * amp * sin(2 * pi * u - 0.4), 0, 0))
        p['lift'] = p.get('lift', 0) - 0.01 * amp * b
    return f


def add(p, bone, d):
    v = p.get(bone, (0, 0, 0))
    p[bone] = tuple(a + b for a, b in zip(v, d))


def jitter(rate, amp, bones=('Head', 'Spine')):
    def f(u, p, dur=None):
        for i, b in enumerate(bones):
            add(p, b, (amp[i] * sin(2 * pi * rate * u + i), amp[i] * 0.4 * sin(2 * pi * rate * u * 1.7 + i), 0))
    return f


def chain(*fs):
    def f(u, p):
        for g in fs:
            g(u, p)
    return f


# 1 Joint_Check: a slow tour of every joint group, back to neutral
N = M(STAND, SH_CARRY, R_LOW)
clip('Joint_Check', 4.0, [
    (0.0, N),
    (0.4, M(N, Head=(0, 35, 0))), (0.8, M(N, Head=(0, -35, 0))), (1.1, M(N, Head=(-15, 0, 0))),
    (1.4, M(N, Spine=(0, 30, 0))), (1.7, M(N, Spine=(0, -30, 0))),
    (2.1, M(N, UpperArm_R=(150, 0, -15), ForeArm_R=(20, 0, 0), fistR=1)),
    (2.5, M(N, UpperArm_R=(60, 0, -60), ForeArm_R=(90, 0, 0), fistR=0)),
    (2.9, M(N, SH_BASH)),
    (3.3, M(N, legs(70, -90, 2, -8))),
    (3.6, M(N, legs(2, -8, 70, -90))),
    (4.0, N)])

# 3 Battle_Idle (loop): shield low and upright, right fist up, weight shifting
clip('Battle_Idle', 3.0, [(0.0, BATTLE), (1.5, M(BATTLE, legs(18, -32, -4, -24), Spine=(6, -11, 0))), (3.0, BATTLE)],
     loop=True, fx=breathe(1.2))

# 4-8 boosting (loops): thrusters carry the mech, legs trail
BOOST_F = M(legs(-14, -36, -24, -52, fl=-66, fr=-76), SH_BRACE, R_BACK,
            Hips=(14, 0, 0), Spine=(16, -6, 0), Head=(-26, 5, 0), lift=0.05)
clip('Boost_Forward', 0.8, [(0, BOOST_F), (0.4, M(BOOST_F, Hips=(16, 0, 1.5))), (0.8, BOOST_F)], loop=True,
     fx=jitter(10, (0.8, 0.5)), ground=False)
BOOST_B = M(legs(26, -40, 14, -30, fl=-10, fr=-10), SH_BLOCK, R_GUARD,
            Hips=(-10, 0, 0), Spine=(-6, -8, 0), Head=(14, 6, 0), lift=0.05)
clip('Boost_Back', 0.8, [(0, BOOST_B), (0.4, M(BOOST_B, Hips=(-12, 0, -1.5))), (0.8, BOOST_B)], loop=True,
     fx=jitter(10, (0.8, 0.5)), ground=False)
for side, sg in (('L', 1), ('R', -1)):
    BS = M(legs(4, -24, 4, -30, al=-10 * sg + 3, ar=-10 * sg - 4), SH_READY, R_GUARD,
           Hips=(4, 0, -12 * sg), Spine=(4, -6, 8 * sg), Head=(-2, 6, 4 * sg), lift=0.05)
    clip(f'Boost_Strafe_{side}', 0.8, [(0, BS), (0.4, M(BS, Hips=(5, 0, -13.5 * sg))), (0.8, BS)], loop=True,
         fx=jitter(10, (0.8, 0.5)), ground=False)

# 5 Boost_Dash_Burst: coil, then explode forward into the boost lean
clip('Boost_Dash_Burst', 0.5, [(0.0, BATTLE), (0.1, M(LOW_LEGS, SH_BRACE, R_GUARD, Spine=(12, -6, 0), Head=(-10, 5, 0))),
                               (0.25, M(BOOST_F, lift=0.02)), (0.5, BOOST_F)], ground=False)

# 9-10 QuickStep: fast side dodge on the ground
for side, sg in (('L', 1), ('R', -1)):
    lead = ('L' if sg > 0 else 'R')
    q1 = M(READY_LEGS, SH_READY, R_GUARD, Hips=(4, 0, -6 * sg), Spine=(6, -8, 10 * sg), Head=(-3, 6, -6 * sg))
    q2 = M(q1, legs(14, -20, -4, -30, al=12 * sg + 3, ar=12 * sg - 4), Hips=(4, 0, -10 * sg), lift=0.04)
    clip(f'QuickStep_{side}', 0.5, [(0.0, BATTLE), (0.12, q1), (0.28, q2), (0.5, BATTLE)])

# 11 Boost_Jump: crouch, thrust off at 0.22, tuck into the hover
CROUCH = M(legs(40, -70, 34, -62), SH_BRACE, R_GUARD, Spine=(16, -6, 0), Head=(-14, 5, 0))
HOVER = M(legs(22, -48, 8, -30, fl=-80, fr=-80), SH_READY, R_GUARD, Spine=(4, -6, 0), Head=(-3, 6, 0))
clip('Boost_Jump', 1.0, [(0.0, BATTLE), (0.2, CROUCH), (0.3, M(legs(-4, -6, -6, -8, fl=-60, fr=-60), SH_READY, R_BACK, Spine=(-4, 0, 0), lift=0.25)),
                         (0.62, M(HOVER, lift=0.9)), (1.0, M(HOVER, lift=1.2))], ground=True)
clip('Air_Hover', 1.2, [(0.0, M(HOVER, lift=1.2)), (0.6, M(HOVER, legs(26, -54, 10, -34, fl=-84, fr=-84), lift=1.24)), (1.2, M(HOVER, lift=1.2))],
     loop=True, fx=jitter(6, (0.6, 0.4)), ground=True)
clip('Landing', 0.9, [(0.0, M(HOVER, lift=0.25)), (0.08, M(legs(44, -86, 38, -80), SH_BRACE, R_GUARD, Spine=(20, -6, 0), Head=(-18, 5, 0))),
                      (0.35, M(legs(30, -56, 18, -44), SH_READY, R_GUARD, Spine=(10, -8, 0))), (0.9, BATTLE)])

# 14-16 head vulcans: head locks on, bursts rattle the head and chest
VUL = M(BATTLE, Head=(2, 7, 0), Spine=(6, -8, 0))
clip('Head_Vulcan_Fire', 0.6, [(0.0, VUL), (0.6, VUL)], loop=True, fx=jitter(12, (1.2, 0.5)))
clip('Head_Vulcan_Sweep', 1.67, [(0.0, M(VUL, Spine=(6, -26, 0), Head=(2, -10, 0))), (0.83, VUL),
                                 (1.67, M(VUL, Spine=(6, 18, 0), Head=(2, 14, 0)))], fx=jitter(12, (1.2, 0.5)))
clip('Air_Vulcan_Fire', 0.6, [(0.0, M(HOVER, Head=(4, 6, 0), lift=1.2)), (0.6, M(HOVER, Head=(4, 6, 0), lift=1.2))],
     loop=True, fx=jitter(12, (1.2, 0.5)), ground=True)

# 19 Saber_Slash_Combo: cut (0.15-0.31), backhand (0.45-0.60), overhead cleave (0.84-1.00)
LUNGE = legs(26, -40, -12, -18)
clip('Saber_Slash_Combo', 1.7, [
    (0.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY)),
    (0.12, M(READY_LEGS, SH_READY, SB_HIGH_R, Spine=(0, -22, 0), Head=(-2, 14, 0))),
    (0.31, M(LUNGE, SH_BRACE, SB_LOW_L, Spine=(12, 18, 0), Head=(-6, -10, 0))),
    (0.42, M(LUNGE, SH_BRACE, SB_LOW_L, Spine=(10, 16, 0))),
    (0.60, M(LUNGE, SH_READY, SB_SIDE_R, Spine=(6, -24, 0), Head=(-3, 16, 0))),
    (0.80, M(READY_LEGS, SH_READY, SB_OVER, Spine=(-6, -4, 0), Head=(4, 4, 0))),
    (1.00, M(legs(30, -52, -14, -22), SH_BRACE, SB_CLEAVE, Spine=(22, 0, 0), Head=(-18, 0, 0))),
    (1.25, M(legs(30, -52, -14, -22), SH_BRACE, SB_CLEAVE, Spine=(20, 0, 0), Head=(-16, 0, 0))),
    (1.70, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 20 Saber_Dash_Thrust: chamber, lunge thrust (0.30-0.44), recover
clip('Saber_Dash_Thrust', 1.1, [
    (0.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY)),
    (0.22, M(LOW_LEGS, SH_BRACE, SB_CHAMBER, Spine=(8, -24, 0), Head=(-4, 18, 0))),
    (0.36, M(legs(40, -46, -26, -6), SH_BACK, SB_THRUST, Spine=(18, 6, 0), Head=(-14, -4, 0))),
    (0.55, M(legs(40, -46, -26, -6), SH_BACK, SB_THRUST, Spine=(16, 4, 0))),
    (1.10, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 21 Saber_Air_Slash: dive from the air, cleave lands 0.26-0.43
AIR_OVER = M(HOVER, SH_READY, SB_OVER, Spine=(-8, -4, 0), Head=(6, 4, 0))
clip('Saber_Air_Slash', 1.1, [
    (0.00, M(AIR_OVER, lift=0.9)), (0.18, M(AIR_OVER, lift=0.7)),
    (0.34, M(legs(42, -80, 30, -70), SH_BRACE, SB_CLEAVE, Spine=(26, 0, 0), Head=(-20, 0, 0))),
    (0.60, M(legs(40, -76, 28, -66), SH_BRACE, SB_CLEAVE, Spine=(22, 0, 0), Head=(-18, 0, 0))),
    (1.10, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 23 Melee_Punch_Combo: shield bash (0.06-0.16), right cross (0.36-0.48)
clip('Melee_Punch_Combo', 1.1, [
    (0.00, BATTLE),
    (0.10, M(legs(24, -30, -10, -14), SH_BASH, R_GUARD, Spine=(10, 14, 0), Head=(-6, -8, 0))),
    (0.24, M(READY_LEGS, SH_READY, R_GUARD, Spine=(6, -20, 0), Head=(-3, 14, 0))),
    (0.42, M(legs(22, -24, -16, -8), SH_BRACE, fistR=1, UpperArm_R=(86, 0, 4), ForeArm_R=(6, 0, 0),
             Hand_R=(0, 0, 0), Spine=(10, 26, 0), Hips=(0, 10, 0), Head=(-6, -18, 0))),
    (0.60, M(legs(22, -24, -16, -8), SH_BRACE, fistR=1, UpperArm_R=(80, 0, 2), ForeArm_R=(12, 0, 0),
             Spine=(8, 22, 0), Hips=(0, 8, 0), Head=(-5, -15, 0))),
    (1.10, BATTLE)])

# 24 Melee_Boost_Kick: thrusters flare, right front kick 0.22-0.36
clip('Melee_Boost_Kick', 1.0, [
    (0.00, BATTLE),
    (0.14, M(legs(18, -36, 60, -100), SH_BRACE, R_BACK, Spine=(4, -6, 0), Head=(-4, 5, 0))),
    (0.30, M(legs(8, -14, 86, -6, fr=-30), SH_BRACE, R_BACK, Hips=(-8, 0, 0), Spine=(-14, -4, 0), Head=(10, 4, 0), lift=0.05)),
    (0.45, M(legs(10, -18, 70, -60), SH_READY, R_GUARD, Spine=(-6, -6, 0))),
    (1.00, BATTLE)])

# 25-26 guard
BLOCK = M(legs(22, -36, -8, -24), SH_BLOCK, R_GUARD, Spine=(10, -18, 0), Head=(-8, 14, 0))
clip('Guard_Block', 0.8, [(0.0, BATTLE), (0.06, BLOCK), (0.64, BLOCK), (0.8, BATTLE)])
clip('Guard_Block_Hit', 0.4, [(0.0, BLOCK), (0.06, M(BLOCK, Spine=(0, -14, 0), Hips=(-6, 0, 0), UpperArm_L=(-19, 52, 23), ForeArm_L=(78, 0, 0))),
                              (0.4, BLOCK)])

# 27-28 hit reactions
clip('Hit_React_Light', 0.55, [(0.0, BATTLE), (0.07, M(BATTLE, Spine=(-10, 10, 4), Head=(12, -12, 0), UpperArm_R=(10, 0, -24), ForeArm_R=(60, 0, 0))),
                               (0.55, BATTLE)])
clip('Hit_React_Heavy', 1.3, [
    (0.00, BATTLE),
    (0.10, M(legs(-2, -10, 20, -40), SH_BACK, R_BACK, Hips=(-10, 8, 0), Spine=(-22, 12, 6), Head=(20, -14, 0), fistR=0)),
    (0.45, M(legs(30, -64, 26, -60), SH_READY, R_LOW, Hips=(6, 4, 0), Spine=(14, 6, 0), Head=(-8, -4, 0))),
    (1.30, BATTLE)])

# 29 Victory_Pose: fist raised, shield planted
WIN = M(WIDE_LEGS, SH_CARRY, fistR=1,
        UpperArm_R=(160, 0, -18), ForeArm_R=(18, 0, 0), Hand_R=(0, 0, 0), Spine=(-6, -10, 0), Head=(-12, 8, 0))
clip('Victory_Pose', 2.0, [(0.0, BATTLE), (0.5, M(WIN, UpperArm_R=(120, 0, -20), ForeArm_R=(60, 0, 0))), (0.8, WIN), (2.0, M(WIN, Head=(-14, 4, 0)))])

# 30 Defeat_Shutdown: jolt, power down onto one knee, head drops
clip('Defeat_Shutdown', 2.4, [
    (0.00, BATTLE),
    (0.15, M(BATTLE, Spine=(-10, 0, 0), Head=(14, 0, 0))),
    (0.9, M(legs(34, -70, 12, -40), SH_CARRY, R_LOW, Spine=(20, 4, 0), Head=(24, 0, 0), fistR=0)),
    (1.6, M(legs(56, -120, 70, -100, fl=10), SH_CARRY,
            UpperArm_R=(10, 0, -6), ForeArm_R=(6, 0, 0), fistR=0, Spine=(32, 6, 4), Head=(38, 0, 0))),
    (2.4, M(legs(56, -122, 72, -102, fl=10), SH_CARRY,
            UpperArm_R=(8, 0, -6), ForeArm_R=(4, 0, 0), fistR=0, Spine=(34, 6, 4), Head=(42, 0, 0)))])

# 36-37 turns: step round 45 degrees (the game turns the root)
for side, sg in (('L', 1), ('R', -1)):
    clip(f'Turn_{side}_45', 0.7, [
        (0.0, BATTLE),
        (0.25, M(BATTLE, legs(30, -50, -6, -20), Hips=(0, -18 * sg, 0), Spine=(5, -8 + 10 * sg, 0), lift=0.02)),
        (0.5, M(BATTLE, legs(12, -24, 24, -46), Hips=(0, -8 * sg, 0))),
        (0.7, BATTLE)])

# 38 Saber_Run_Slash: running cut across the waist (0.13-0.30)
clip('Saber_Run_Slash', 1.0, [
    (0.00, M(legs(30, -60, -18, -20), SH_READY, SB_WAIST_R, Spine=(14, -24, 0), Head=(-10, 16, 0))),
    (0.30, M(legs(-16, -24, 34, -50), SH_BRACE, SB_WAIST_L, Spine=(16, 24, 0), Head=(-10, -14, 0))),
    (0.55, M(legs(28, -56, -10, -30), SH_READY, SB_WAIST_L, Spine=(12, 18, 0))),
    (1.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 39 Saber_Boost_Slash: coil, boost in (0.28-0.72) with the blade trailing, big up-cut 0.50-0.76
clip('Saber_Boost_Slash', 1.35, [
    (0.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY)),
    (0.26, M(CROUCH, SB_TRAIL, Spine=(16, -20, 0), Head=(-12, 16, 0))),
    (0.48, M(legs(-14, -36, -24, -52, fl=-66, fr=-76), SH_BRACE, SB_TRAIL, Hips=(14, 0, 0), Spine=(18, -24, 0), Head=(-26, 18, 0), lift=0.05)),
    (0.76, M(legs(30, -50, -12, -22), SH_BACK, SB_UPCUT_L, Spine=(6, 26, 0), Head=(-4, -16, 0))),
    (0.95, M(legs(34, -60, -10, -30), SH_READY, SB_UPCUT_L, Spine=(8, 22, 0))),
    (1.35, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 40-42 hops (small boosted hops; the game moves the root)
HOP_TUCK = M(legs(34, -66, 28, -60, fl=-66, fr=-60), SH_READY, R_GUARD, Spine=(6, -8, 0))
for name, extra in (('Boost_Hop_Back', dict(Hips=(-8, 0, 0), Spine=(-4, -8, 0))),
                    ('Boost_Hop_L', dict(Hips=(0, 0, -10), Spine=(4, -8, 8))),
                    ('Boost_Hop_R', dict(Hips=(0, 0, 10), Spine=(4, -8, -8)))):
    clip(name, 0.8, [(0.0, BATTLE), (0.1, M(CROUCH)), (0.3, M(HOP_TUCK, extra, lift=0.35)), (0.52, M(HOP_TUCK, extra, lift=0.3)),
                     (0.62, M(legs(36, -70, 30, -64), SH_BRACE, R_GUARD, Spine=(14, -6, 0))), (0.8, BATTLE)], ground=True)

# 43 Saber_Rising_Slash: low guard to a rising cut (0.16-0.36)
clip('Saber_Rising_Slash', 0.9, [
    (0.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY)),
    (0.14, M(LOW_LEGS, SH_BRACE, SB_LOW_R, Spine=(18, -14, 0), Head=(-14, 10, 0))),
    (0.36, M(legs(10, -16, -8, -10), SH_READY, SB_UP, Spine=(-8, 6, 0), Head=(4, -4, 0))),
    (0.55, M(legs(12, -20, -8, -12), SH_READY, SB_UP, Spine=(-6, 4, 0))),
    (0.90, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 44 Saber_Wide_Sweep: torso-driven horizontal sweep (0.28-0.48)
clip('Saber_Wide_Sweep', 1.2, [
    (0.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY)),
    (0.26, M(WIDE_LEGS, SH_READY, SB_SWEEP_A, Hips=(0, -14, 0), Spine=(6, -30, 0), Head=(-4, 26, 0))),
    (0.48, M(WIDE_LEGS, SH_BACK, SB_SWEEP_B, Hips=(0, 14, 0), Spine=(8, 30, 0), Head=(-4, -24, 0))),
    (0.70, M(WIDE_LEGS, SH_READY, SB_SWEEP_B, Hips=(0, 10, 0), Spine=(6, 24, 0))),
    (1.20, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 45 Saber_Stab_Combo: two quick thrusts (0.10-0.26, 0.34-0.50)
clip('Saber_Stab_Combo', 1.0, [
    (0.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY)),
    (0.08, M(READY_LEGS, SH_BRACE, SB_CHAMBER, Spine=(6, -18, 0))),
    (0.20, M(legs(28, -36, -14, -12), SH_BRACE, SB_THRUST, Spine=(12, 6, 0), Head=(-8, -4, 0))),
    (0.30, M(READY_LEGS, SH_BRACE, SB_CHAMBER, Spine=(6, -16, 0))),
    (0.44, M(legs(34, -40, -20, -8), SH_BRACE, SB_THRUST, Spine=(16, 8, 0), Head=(-10, -6, 0))),
    (0.60, M(legs(34, -40, -20, -8), SH_BRACE, SB_THRUST, Spine=(14, 6, 0))),
    (1.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 46 Saber_Cross_Cut: diagonal one way (0.15-0.30), then the X finisher (0.46-0.64)
clip('Saber_Cross_Cut', 1.1, [
    (0.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY)),
    (0.12, M(READY_LEGS, SH_READY, SB_HIGH_R, Spine=(0, -20, 0), Head=(-2, 12, 0))),
    (0.30, M(LUNGE, SH_BRACE, SB_LOW_L, Spine=(12, 16, 0), Head=(-6, -10, 0))),
    (0.44, M(READY_LEGS, SH_READY, SB_HIGH_L, Spine=(0, 16, 0), Head=(-2, -10, 0))),
    (0.64, M(LUNGE, SH_BRACE, S((-0.50, -0.35, 1.45), (-0.6, -0.45, -0.65)), Spine=(14, -18, 0), Head=(-8, 12, 0))),
    (0.80, M(LUNGE, SH_BRACE, S((-0.50, -0.35, 1.45), (-0.6, -0.45, -0.65)), Spine=(12, -16, 0))),
    (1.10, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 47 Saber_Parry_Riposte: shield + blade parry (0.04-0.33), riposte (0.42-0.57)
clip('Saber_Parry_Riposte', 1.0, [
    (0.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY)),
    (0.06, M(legs(20, -36, -8, -26), SH_BLOCK, SB_PARRY, Spine=(6, -10, 0), Head=(-6, 8, 0))),
    (0.33, M(legs(20, -36, -8, -26), SH_BLOCK, SB_PARRY, Spine=(4, -12, 0), Head=(-6, 8, 0))),
    (0.40, M(READY_LEGS, SH_READY, SB_CHAMBER, Spine=(6, -20, 0))),
    (0.52, M(legs(36, -42, -22, -8), SH_BACK, SB_THRUST, Spine=(16, 8, 0), Head=(-10, -6, 0))),
    (0.66, M(legs(36, -42, -22, -8), SH_BACK, SB_THRUST, Spine=(14, 6, 0))),
    (1.00, M(READY_LEGS, SH_READY, S_READY, TORSO_READY))])

# 48-52 beam rifle (right hand)
GUN_IDLE = M(READY_LEGS, SH_READY, GUN_LOW, TORSO_READY)
clip('Gun_Idle', 2.0, [(0.0, GUN_IDLE), (2.0, GUN_IDLE)], loop=True, fx=breathe(1.0))
PICK = M(legs(56, -104, 30, -76), SH_READY, Spine=(34, -10, -6), Head=(-24, 8, 0), fistR=0,
         UpperArm_R=(46, 0, -10), ForeArm_R=(16, 0, 0), Hand_R=(10, 0, 0))
clip('Gun_Pickup', 1.0, [(0.0, BATTLE), (0.28, PICK), (0.42, M(PICK, fistR=1, gun=1)),
                         (0.7, M(legs(30, -56, 12, -40), SH_READY, GUN_LOW, Spine=(12, -8, 0))), (1.0, GUN_IDLE)])
AIM = M(legs(18, -30, -8, -20), SH_BRACE, GUN_AIM, Spine=(4, -14, 0), Head=(-4, 14, 0))


def recoil(times, kick=6):
    def f(u, p, dur=[0.8]):
        t = u * CLIPS_DUR[0]
        for t0 in times:
            if t >= t0:
                k = math.exp(-(t - t0) / 0.035) * kick
                add(p, 'UpperArm_R', (k, 0, 0)); add(p, 'ForeArm_R', (k * 0.6, 0, 0))
                add(p, 'Spine', (-k * 0.25, 0, 0))
    return f


CLIPS_DUR = [0.8]
clip('Gun_Burst', 0.8, [(0.0, GUN_IDLE), (0.14, AIM), (0.5, AIM), (0.8, GUN_IDLE)], fx=recoil((0.18, 0.28, 0.38)))
BRACE = M(legs(26, -44, -14, -24, al=6, ar=-8), SH_BRACE, GUN_AIM, Spine=(6, -18, 0), Head=(-6, 18, 0))
clip('Gun_Charge', 1.4, [(0.0, GUN_IDLE), (0.3, BRACE), (1.4, BRACE)], fx=jitter(9, (0.2, 0.6), bones=('UpperArm_R', 'ForeArm_R')))
clip('Gun_Charge_Shot', 1.1, [(0.0, BRACE), (0.05, BRACE),
                              (0.14, M(BRACE, UpperArm_R=(112, 0, -6), ForeArm_R=(18, 0, 0), Spine=(-8, -18, 0), Hips=(-6, 0, 0), Head=(4, 18, 0))),
                              (0.45, M(BRACE, UpperArm_R=(94, 0, -5), ForeArm_R=(8, 0, 0), Spine=(0, -16, 0))), (1.1, GUN_IDLE)])

# 31-35 locomotion loops are generated from gait functions (see GAITS)
GAITS = {'Walk_Forward': (1.1, 'fwd'), 'Walk_Back': (1.2, 'back'), 'Walk_Strafe_L': (1.0, 'L'),
         'Walk_Strafe_R': (1.0, 'R'), 'Run_Forward': (0.72, 'run')}

# thrusts: turn the body side-on (right shoulder leading, head on target) so the arm
# drives straight out without twisting
_TH = SB_THRUST['sab']
for _c in CLIPS.values():
    for _t, _p in _c['keys']:
        if _p.get('sab') == _TH:
            _p['sab'] = ((-0.30, -0.78, 1.98), (0.0, -1.0, 0.03))
            _p['Hips'] = (0, 22, 0); _p['Spine'] = (10, 26, 0); _p['Head'] = (-6, -40, 0)

# ---- clean strokes: every saber key uses a plain shoulder/elbow arm pose (no solving);
# the wrist stays near the Saber_Idle angle and only cocks for thrusts / cleave finishes.
def A(ua, fa, h):
    return {'UpperArm_R': ua, 'ForeArm_R': (fa, 0, 0), 'Hand_R': (h, 0, 0)}
FK = {
    'HIGH_R': A((130, 0, -35), 60, -20), 'LOW_L': A((40, 0, 30), 15, -55), 'SIDE_R': A((75, 0, -65), 20, -40),
    'OVER': A((160, 0, -10), 40, -20), 'CLEAVE': A((45, 0, -5), 5, -55), 'CHAMBER': A((-10, 0, -15), 25, -45),
    'THRUST': A((55, 0, -5), 0, -65), 'LOW_R': A((10, 0, -15), 20, -55), 'UP': A((150, 0, -20), 15, -20),
    'SWEEP_A': A((70, 0, -80), 20, -40), 'SWEEP_B': A((70, 0, 40), 15, -40), 'HIGH_L': A((135, 0, 20), 60, -20),
    'PARRY': A((60, 0, 15), 40, -20), 'WAIST_R': A((55, 0, -60), 30, -45), 'WAIST_L': A((55, 0, 35), 15, -45),
    'TRAIL': A((-35, 0, -15), 25, -45), 'UPCUT_L': A((140, 0, 25), 15, -20), 'CROSS_R': A((40, 0, -35), 15, -55)}
_SB = {'HIGH_R': SB_HIGH_R, 'LOW_L': SB_LOW_L, 'SIDE_R': SB_SIDE_R, 'OVER': SB_OVER, 'CLEAVE': SB_CLEAVE,
       'CHAMBER': SB_CHAMBER, 'LOW_R': SB_LOW_R, 'UP': SB_UP, 'SWEEP_A': SB_SWEEP_A, 'SWEEP_B': SB_SWEEP_B,
       'HIGH_L': SB_HIGH_L, 'PARRY': SB_PARRY, 'WAIST_R': SB_WAIST_R, 'WAIST_L': SB_WAIST_L, 'TRAIL': SB_TRAIL,
       'UPCUT_L': SB_UPCUT_L}
_BYPOS = {tuple(v['sab'][0]): k for k, v in _SB.items()}
_BYPOS[(-0.30, -0.78, 1.98)] = 'THRUST'
_BYPOS[(-0.15, -0.80, 1.95)] = 'THRUST'
_BYPOS[(-0.50, -0.35, 1.45)] = 'CROSS_R'
for _c in CLIPS.values():
    for _t, _p in _c['keys']:
        if 'sab' in _p:
            _p.update(FK[_BYPOS[tuple(_p['sab'][0])]]); del _p['sab']

# ---- saber strikes rebuilt against a dummy at 1.2 units: each hit window gets
# wind-up -> contact (blade through the dummy at mid-window) -> follow-through
import json as _json, os as _os
_ST = _json.load(open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)) if '__file__' in dir() else '.', 'strokes.json'))) \
    if _os.path.exists('strokes.json') else None
def _q2p(q):
    return {'Spine': (q[0], q[1], 0), 'Hips': (0, q[2], 0), 'UpperArm_R': (q[3], q[4], q[5]),
            'ForeArm_R': (q[6], 0, 0), 'Hand_R': (q[7], 0, 0)}
def _strike(name, dur, hits, pre=None, post_legs=None):
    rest = M(READY_LEGS, SH_READY, S_READY, TORSO_READY)
    keys = [(0.0, pre or rest)]
    for (t0, t1, stroke) in hits:
        s = _ST[stroke]; tm = (t0 + t1) / 2
        keys.append((max(keys[-1][0] + 0.02, t0 - 0.08), M(READY_LEGS, SH_READY, SABER_ON, _q2p(s['start']))))
        keys.append((t0, M(LUNGE, SH_BRACE, SABER_ON, _q2p(s['start']), step=STEP * 0.6)))
        keys.append((tm, M(LUNGE, SH_BRACE, SABER_ON, _q2p(s['contact']), step=STEP)))
        keys.append((t1, M(LUNGE, SH_BRACE, SABER_ON, _q2p(s['end']), step=STEP)))
    last = keys[-1][1]
    keys.append((min(dur - 0.05, keys[-1][0] + 0.15), M(post_legs or LUNGE, dict(last, **{k: v for k, v in last.items() if k.endswith('_R')}), step=STEP)))
    keys.append((dur, rest))
    keys.sort(key=lambda k: k[0])
    CLIPS[name]['keys'] = keys
STEP = 0.6     # lunge: hips forward 0.55, front foot steps 1.1 (units)
if _ST:
    _strike('Saber_Slash_Combo', 1.7, [(0.15, 0.31, 'diag_dn'), (0.45, 0.6, 'backhand'), (0.84, 1.0, 'cleave')])
    _strike('Saber_Run_Slash', 1.0, [(0.13, 0.3, 'sweep')], pre=M(legs(30, -60, -18, -20), SH_READY, S_READY, Spine=(14, -10, 0)))
    _strike('Saber_Boost_Slash', 1.35, [(0.5, 0.76, 'rising')])
    _strike('Saber_Air_Slash', 1.1, [(0.26, 0.43, 'cleave')], pre=M(AIR_OVER, lift=0.9))
    _strike('Saber_Dash_Thrust', 1.1, [(0.3, 0.44, 'thrust')])
    _strike('Saber_Rising_Slash', 0.9, [(0.16, 0.36, 'rising')])
    _strike('Saber_Wide_Sweep', 1.2, [(0.28, 0.48, 'sweep')])
    _strike('Saber_Stab_Combo', 1.0, [(0.1, 0.26, 'thrust'), (0.34, 0.5, 'thrust')])
    _strike('Saber_Cross_Cut', 1.1, [(0.15, 0.3, 'diag_dn'), (0.46, 0.64, 'diag_dn2')])
    _pk = [k for k in CLIPS['Saber_Parry_Riposte']['keys'] if k[0] <= 0.33]
    _strike('Saber_Parry_Riposte', 1.0, [(0.42, 0.57, 'thrust')])
    CLIPS['Saber_Parry_Riposte']['keys'] = _pk + [k for k in CLIPS['Saber_Parry_Riposte']['keys'] if k[0] > 0.33]

# air slash: the dive carries the body forward into the cleave (lands ~0.8 units in)
if _ST:
    _ak = CLIPS['Saber_Air_Slash']['keys']
    for _i, (_t, _p) in enumerate(_ak):
        if 0.2 <= _t < 1.0:
            _p['hips'] = (0, -0.8 * min(1.0, (_t - 0.1) / 0.3), 0)
            _p.pop('step', None)

# ---- saber clash (both robots play the same clip facing each other ~2.2 units apart;
# the blades cross in an X at the midpoint)
_CL = _json.load(open('clash.json')) if _os.path.exists('clash.json') else None
if _CL and _ST:
    BIND = M(legs(22, -38, -10, -20), SH_BRACE, SABER_ON, _q2p(_CL['bind']))
    PUSH = M(legs(26, -42, -14, -16), SH_BRACE, SABER_ON, _q2p(_CL['push']))
    READY_S = M(READY_LEGS, SH_READY, S_READY, TORSO_READY)
    WIND = M(READY_LEGS, SH_READY, SABER_ON, _q2p(_ST['diag_dn']['start']))
    def _strain(u, p):
        k = math.sin(2 * math.pi * u * 7) * 1.4 + math.sin(2 * math.pi * u * 13) * 0.7   # grinding tremor
        add(p, 'UpperArm_R', (k, 0, 0.5 * k)); add(p, 'ForeArm_R', (-0.8 * k, 0, 0))
        add(p, 'Spine', (0.5 * math.sin(2 * math.pi * u * 2), 0, 0.3 * k)); add(p, 'Head', (-0.4 * k, 0, 0))
    clip('Saber_Clash_Enter', 0.45, [(0.0, READY_S), (0.15, WIND), (0.3, BIND), (0.45, PUSH)])
    clip('Saber_Clash_Loop', 1.0, [(0.0, PUSH), (0.5, M(BIND, Spine=(BIND['Spine'][0] + 3, BIND['Spine'][1], 0))), (1.0, PUSH)],
         loop=True, fx=_strain)
    SHOVE = M(LUNGE, SH_BASH, SABER_ON, _q2p(_ST['sweep']['end']), step=STEP * 0.7)
    clip('Saber_Clash_Win', 0.7, [(0.0, PUSH), (0.18, M(PUSH, step=STEP * 0.5)), (0.36, SHOVE), (0.7, READY_S)])
    RECOIL = M(legs(-6, -30, 34, -60), SH_BLOCK, SABER_ON, _q2p(_ST['backhand']['start']),
               Hips=(-10, 0, 0), Spine=(-16, 10, 0), Head=(14, -8, 0), hips=(0, 0.55, 0))
    clip('Saber_Clash_Lose', 0.8, [(0.0, PUSH), (0.14, RECOIL), (0.45, M(RECOIL, hips=(0, 0.35, 0), Spine=(-4, 4, 0))), (0.8, READY_S)])
