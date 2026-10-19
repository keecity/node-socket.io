# Voltusk — animation log

Video model **wan3_0_prime**, 6 s, 720p, 16:9, from the two-view start frame (media `3c7acbd7-002a-492b-ba31-f619822ab6bb`).

Detector: DINOv2 ViT-S/14 + heatmap head, 448 px, fine-tuned on 11,000 renders incl. 2,500 acrobatic poses.

## Body (measured from the rig)

- Bone roles: hip `hip`, head tip `head_nub`, jaw tip `jaw_nub`, feet `left_front_foot_nub`, `right_front_foot_nub`, `left_back_foot_nub(mirrored)`, `right_back_foot_nub`, tail 4 bones
- Nose to rump 0.550 m, height 0.370 m, footprint capsule radius 0.195 m

## Game clips

| Role | Source | Status | Length (at rate) | Rate | Key moment | Measured |
|---|---|---|---|---|---|---|
| idle | idle [0–179] | used | 5.97 s (5.97 s) | 1× | - | - |
| walk | walk [39–155] | used | 3.87 s (3.87 s) | 1× | - | gait 0.40 m/s at -4°, loop 7×0.55 s (seam 4.0%); airborne 1.57–1.63, 2.67–2.73, 3.20–3.30, 3.77–3.83 |
| run | run [35–178] | used | 4.77 s (4.77 s) | 1× | - | gait 0.51 m/s at +2°, loop 10×0.48 s (seam 5.3%); airborne 0.33–0.47, 0.80–0.97, 1.30–1.43, 1.80–1.87, 2.23–2.33, 3.17–3.30, 3.63–3.77, 4.10–4.27, 4.60–4.77 |
| walk_back | walk_back | **rejected**: travels at 3 deg, 0.12 m/s; needs 180 deg. Regenerate this clip. → plays `walk` | - | - | - | - |
| strafe_left | strafe_left | **rejected**: travels at -24 deg, 0.34 m/s; needs 90 deg. Regenerate this clip. → plays `walk` | - | - | - | - |
| strafe_right | strafe_right | **rejected**: travels at -7 deg, 0.23 m/s; needs -90 deg. Regenerate this clip. → plays `walk` | - | - | - | - |
| horn | attack [61–120] | used | 1.97 s (0.98 s) | 2× | 1.13 s (peak_speed) | travel 0.14 m; strike reach 0.67 m |
| bite | bite [75–110] | used | 1.17 s (0.58 s) | 2× | 0.47 s (peak_speed) | strike reach 0.60 m |
| leap | jump [30–119] | used | 2.97 s (1.48 s) | 2× | 2.40 s (landing) | travel 0.03 m |
| victory | jump [30–119] | used | 2.97 s (2.47 s) | 1.2× | 2.40 s (landing) | travel 0.03 m |
| spin | spin [45–104] | used | 1.97 s (0.98 s) | 2× | 1.60 s (landing) | airborne 0.30–1.10, 1.30–1.57; travel 0.06 m; strike reach 0.62 m |
| dodge | dodge [62–98] | used | 1.20 s (0.92 s) | 1.3× | - | airborne 0.53–0.90; travel 0.11 m |
| power | idle [0–179] | used | 5.97 s (4.26 s) | 1.4× | - | - |
| hurt | hurt [33–79] | used | 1.53 s (1.18 s) | 1.3× | 0.87 s (peak_speed) | travel 0.13 m; strike reach 0.51 m |
| faint | faint [16–179] | used | 5.43 s (5.43 s) | 1× | - | travel 0.10 m |

## Moves

| Move | Type | Clip | Damage | Cooldown | Notes |
|---|---|---|---|---|---|
| Thunder Horn | melee | horn | 11 | 1.7 s | - |
| Volt Fang | melee | bite | 8 | 2.2 s | paralyze {'chance': 0.3, 'seconds': 3.0} |
| Static Leap | wave | leap | 11 | 6.0 s | range [2.2, 6.0], wave_speed 7.0 |
| Storm Spin | dash_strike | spin | 20 | 9.0 s | range [1.6, 3.5], energy 75, area 0.9, armor True |
| Spark Step | evade | dodge | - | 1.6 s | - |
| Overcharge | buff | power | - | 9.0 s | - |

## Source clips

### idle

- Job: `21d29114-8c2b-47ac-9895-833e82274edf` (before the subject-only rule)
- Solve: views agree
- Prompt action: IDLE animation: the creature stands in place breathing slowly, chest rising and falling, small head turns and a lazy tail sway, occasional weight shift between legs. Feet stay planted.

### walk

- Job: `000d813a-e383-48c0-8c76-e2a4ded8d6d2` (before the subject-only rule)
- Solve: views agree
- Prompt action: WALK CYCLE IN PLACE: the four-legged creature walks with a natural quadruped gait (diagonal leg pairs alternate), body bobbing gently, head nodding, tail swaying, but it stays centered in each panel as if on a treadmill and does not leave the frame.
- Notes: Close to marching on the spot: planted feet slide back only ~6 cm per step, so the measured ground speed is low. The left hind foot barely lifts in the solve (stiff).

### attack

- Job: `34b1ebd8-4070-46cf-9302-dd2ac011d968` (before the subject-only rule)
- Solve: views agree
- Prompt action: ATTACK animation: the creature crouches, rears back, then lunges forward a short distance with a powerful horn headbutt and snapping jaw bite, then recovers back to its standing pose.
- Notes: Contains three thrusts; pack keeps one beat around the strongest.

### bite

- Job: `d6bc8be6-bed9-4b70-bf9b-9044945841ab` (before the subject-only rule)
- Solve: views agree, bad joints 5.1%
- Prompt action: BITE attack animation, vicious and fast: the creature rears its head back and opens its jaws wide, then lunges forward with its whole body and snaps its jaws shut hard, snaps a second time, violently shakes its head side to side as if tearing at prey, then pulls back to its stance with the mouth closing. Aggressive fighting-game timing with strong anticipation and follow-through.
- Notes: Several snaps; pack keeps the strongest.

### jump

- Job: `5bb72cea-04c2-422e-967e-75b92c51beff` (before the subject-only rule)
- Solve: views disagree, bad joints 10.8%, body only 4.9%
- Prompt action: JUMP animation, powerful and dynamic: the creature crouches deep with anticipation, then leaps straight up high into the air, legs tucking under its body, tail swinging, head raised, hangs at the top for a moment, then drops and lands hard with all four feet, absorbing the impact with a deep squash, then rises back to its stance. Big, readable, fighting-game timing. It jumps in place and stays inside each panel.
- Notes: The model made a rear-up stomp (front feet up ~30 cm, hind feet planted), twice, not a jump. Used as the Static Leap stomp and the victory pose. It cannot clear a ground wave; Spark Step (dodge) does that.

### dodge

- Job: `1da66fb0-cea7-4340-80fe-ba5ebe74d612` (before the subject-only rule)
- Solve: views agree, bad joints 8.4%
- Prompt action: DODGE animation, fast and athletic: the creature tenses, then explosively hops sideways to its left, body leaning hard and tail whipping for balance, legs bunching and pushing off the ground, lands low in a defensive crouch, then springs quickly back to the center with a second quick hop and settles into a ready stance. Sharp, snappy timing like a fighting game.
- Notes: Two real hops, fully airborne; pack keeps the first (hop out).

### spin

- Job: `0b48e70f-9018-4dbc-ab19-4e9559dce6eb` (before the subject-only rule)
- Solve: views disagree, bad joints 13.3%, body only 6.5%
- Prompt action: JUMP SPIN STRIKE special attack: the creature crouches low, launches itself high into the air, does one full fast 360-degree spin around its vertical axis while airborne with its tail whipping around, then comes crashing down head-first and strikes the ground in front of it with its horn in a powerful slam, holds the impact pose for a beat, then recovers to its stance. Explosive, acrobatic fighting-game timing. It stays roughly in place inside each panel.
- Notes: Fully airborne ~0.8 s. The gate fails on the tail, hidden behind the body mid-spin; body joints pass. Needed the acrobatic detector retrain. Hip position jitters mid-spin; pack smooths root motion.

### run

- Job: `0996cb7f-3c57-453d-b23b-7beaa59fda38`
- Solve: views disagree, bad joints 20.9%, body only 12.3%
- Prompt action: RUN CYCLE IN PLACE: the four-legged creature runs at full speed on the spot with a powerful bounding gallop, front and hind leg pairs reaching and gathering, spine flexing, head pushing forward low and aggressive, tail streaming behind and bouncing with each stride. It runs in place and does not travel across the panel. The cycle loops cleanly.
- Notes: Fast gallop is the hardest clip for the detector (motion blur). Stride is short, so the run is only ~20% faster than the walk at 1x; the game plays gaits up to 1.8x.

### hurt

- Job: `e1f0b824-6ff9-4f9a-b04c-30eb37a433ad`
- Solve: views agree, bad joints 5.6%
- Prompt action: HURT REACTION, strong and readable: the creature flinches as if struck hard on the head by an unseen blow, its head snaps back and to the side, the body recoils backwards with the front legs lifting slightly and stumbling back two short steps, the mouth opens in pain, the tail flinches, then it shakes it off and plants its feet back in its ready stance. Fast fighting-game timing.
- Notes: 'unseen blow' keeps the model from drawing an attacker.

### faint

- Job: `50fb7682-a72f-4418-8c67-d6f6406d8a0d`
- Solve: views disagree, bad joints 11.6%, body only 6.8%
- Prompt action: FAINT / KNOCKOUT: the creature staggers, wobbles unsteadily side to side, its legs buckle, the front legs fold first, then the whole body collapses heavily onto its side on the ground, the head drops to the floor and the tail goes limp. It lies completely still on the ground, unconscious, for the rest of the clip.
- Notes: Lying on its side is outside the detector's training poses; still reads correctly.

### walk_back

- Job: `ad611581-4503-4602-b143-4cd771c8ca88`
- Solve: views agree, bad joints 6.4%
- Prompt action: WALK BACKWARD IN PLACE: the four-legged creature walks steadily backwards with a natural reversed quadruped gait, diagonal leg pairs alternating, stepping its feet backwards, head low and facing forward, watchful, tail swaying. It walks backward on the spot like on a treadmill and does not travel across the panel. The cycle loops cleanly.
- Notes: REJECTED by pack: the feet march nearly in place and drift forward (heading 3 deg, 0.12 m/s). Regenerate.

### strafe_left

- Job: `6df256cc-6f72-4d61-8f06-edd4c4353764`
- Solve: views agree, bad joints 9.0%
- Prompt action: SIDESTEP TO ITS LEFT IN PLACE: the creature keeps its body and head facing straight forward while it strafes sideways toward its own left with quick crossing side steps of all four legs, body swaying slightly, tail balancing, alert combat stance. It sidesteps on the spot like on a treadmill and does not travel across the panel. The cycle loops cleanly.
- Notes: REJECTED by pack: steps go forward-right (heading -29 deg), not to its left. Regenerate.

### strafe_right

- Job: `61e730f9-c27f-426a-95ed-0f84fb4544aa`
- Solve: views disagree, bad joints 10.3%
- Prompt action: SIDESTEP TO ITS RIGHT IN PLACE: the creature keeps its body and head facing straight forward while it strafes sideways toward its own right with quick crossing side steps of all four legs, body swaying slightly, tail balancing, alert combat stance. It sidesteps on the spot like on a treadmill and does not travel across the panel. The cycle loops cleanly.
- Notes: REJECTED by pack: steps go forward (heading -7 deg). Regenerate.

### roar

- Job: `not generated`
- Solve: -
- Prompt action: ROAR / POWER UP: the creature plants its feet, lowers its head, then rears up its front body and throws its head back in a huge triumphant roar with the jaw wide open, chest pushed out, tail lifted, holds the roar for a moment, then settles back down onto all fours in its ready stance.
- Notes: NOT GENERATED: Higgsfield plan out of credits. Overcharge plays the idle clip until this exists.

## To redo

- `walk_back`: travels at 3 deg, 0.12 m/s; needs 180 deg. Regenerate this clip.
- `strafe_left`: travels at -24 deg, 0.34 m/s; needs 90 deg. Regenerate this clip.
- `strafe_right`: travels at -7 deg, 0.23 m/s; needs -90 deg. Regenerate this clip.
- `roar`: not generated
