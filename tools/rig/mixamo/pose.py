import mediapipe as mp, cv2, numpy as np, json
from mediapipe.tasks.python import vision, BaseOptions
opt = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path='pose_landmarker_heavy.task'), running_mode=vision.RunningMode.VIDEO, min_pose_detection_confidence=0.3, min_tracking_confidence=0.3)
lm = vision.PoseLandmarker.create_from_options(opt)
cap = cv2.VideoCapture('ref/run_dribble2.mp4'); out = []; i = 0
while True:
    ok, fr = cap.read()
    if not ok: break
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
    r = lm.detect_for_video(img, int(i * 1000 / 24))
    if r.pose_landmarks:
        out.append({'f': i, 'n': [[p.x, p.y, p.z, p.visibility] for p in r.pose_landmarks[0]], 'w': [[p.x, p.y, p.z] for p in r.pose_world_landmarks[0]]})
    else: out.append({'f': i})
    i += 1
json.dump(out, open('pose.json', 'w')); print(i, 'frames', sum('n' in o for o in out), 'detected')
