"""Old 20-bone clips -> Mixamo rig. Both rest poses are T-poses facing +z, so each bone gets the same
world-space rotation change as its old counterpart; hips height is solved so the feet meet the floor as before."""
import numpy as np, mixrig as M
import rig as O
from rig import qmat, matq, slerp
K = 1.0 / 0.9                       # old model is 0.9 tall, new 1.0: world-size match
MAP = {'Hips': 'hips', 'Spine': 'spine', 'Spine2': 'chest', 'Neck': 'neck', 'Head': 'head'}
for S, s in (('Left', 'L'), ('Right', 'R')):
    MAP.update({f'{S}Shoulder': f'shoulder.{s}', f'{S}Arm': f'upperarm.{s}', f'{S}ForeArm': f'forearm.{s}', f'{S}Hand': f'hand.{s}',
                f'{S}UpLeg': f'thigh.{s}', f'{S}Leg': f'shin.{s}', f'{S}Foot': f'foot.{s}'})
O_REST = O.fk({}); M_REST = M.fk()
RREST = {i: M_REST[i][:3, :3] for i in M_REST}
def delta(Wo, ob): return Wo[ob][:3, :3] @ O_REST[ob][:3, :3].T
def qfrom(R): return matq(R)
ANK_O = O.HEAD['foot.L'][1]; ANK_M = M_REST[M.ID['LeftFoot']][1, 3]
def frame(pose, ball_old, r_old=O.BALL_R if hasattr(O, 'BALL_R') else 0.07, r_new=0.078):
    Wo = O.fk(pose); D = {b: delta(Wo, o) for b, o in MAP.items()}
    qs = lambda R: matq(R)
    D['Spine1'] = qmat(slerp(matq(D['Spine']), matq(D['Spine2']), 0.5))
    local = {}; W = {}
    hips_rest = M.REST[M.ID['Hips']][0].copy()
    def solve(hips_t):
        for i in M.ORDER:
            tr, q, s = M.REST[i]; nm = M.NAME[i]
            Wp = W[M.PARENT[i]] if i in M.PARENT else np.eye(4)
            if nm == 'Hips': tr = hips_t
            if nm in D:
                Rw = D[nm] @ RREST[i]; Rl = Wp[:3, :3].T @ Rw if i in M.PARENT else Rw
                local[nm] = matq(Rl); q = local[nm]
            W[i] = Wp @ M.mat(tr, q, s)
    # horizontal hips/root motion scaled to the new size; height solved from the feet
    hip_off = (Wo['hips'][:3, 3] - O_REST['hips'][:3, 3]) - pose.get('_root', np.zeros(3))
    ht = hips_rest + np.array([hip_off[0] * K, 0, hip_off[2] * K])
    solve(ht)
    old_lift = min(Wo[f'foot.{s}'][1, 3] for s in 'LR') - ANK_O
    new_lift = min(W[M.ID[f'{S}Foot']][1, 3] for S in ('Left', 'Right')) - ANK_M
    ht[1] += old_lift * K - new_lift
    solve(ht)
    root_t = np.asarray(pose.get('_root', np.zeros(3))) * K
    # ball: glued to a hand it touches (same world offset), otherwise its old path scaled, floor-relative
    b = np.asarray(ball_old, float); free = np.array([b[0] * K, r_new + (b[1] - r_old) * K, b[2] * K])
    acc, wsum = np.zeros(3), 0.0
    for s, S in (('L', 'Left'), ('R', 'Right')):
        ho = Wo[f'hand.{s}'][:3, 3]; d = np.linalg.norm(b - ho) - r_old
        w = float(np.clip((0.09 - d) / 0.05, 0, 1))
        if w > 0:
            hn = W[M.ID[f'{S}Hand']][:3, 3] + root_t
            acc += w * (hn + (b - ho) * (r_new / r_old)); wsum += w
    wsum_c = min(1.0, wsum); bn = (acc / wsum if wsum > 0 else free) * wsum_c + free * (1 - wsum_c)
    return local, ht, root_t, bn
