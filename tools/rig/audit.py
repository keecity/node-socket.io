from clips import *
import sys
names = sys.argv[1:] or list(CLIPS)
for name in names:
    fr, bl = CLIPS[name]()
    prev = {}
    for f, q in enumerate(fr):
        M = fk(q)
        for S in 'LR':
            R = qmat(q[f'hand.{S}']); ang = np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))
            Rw = M[f'hand.{S}'][:3, :3]
            if S in prev:
                d = np.degrees(np.arccos(np.clip((np.trace(prev[S].T @ Rw) - 1) / 2, -1, 1))) * FPS
            else: d = 0
            prev[S] = Rw
            if ang > 66 or d > 720: print(f'{name} t={f/FPS:.2f} {S} wrist={ang:.0f} handspeed={d:.0f}deg/s')
        for S in 'LR':
            R = qmat(q[f'forearm.{S}']); a2 = np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))
            if a2 > 150: print(f'{name} t={f/FPS:.2f} {S} elbow {a2:.0f}')
    print(name, 'checked', len(fr), 'frames')
