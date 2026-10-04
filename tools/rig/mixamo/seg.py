import numpy as np, cv2
# classes: 0 bg, 1 skin, 2 ball, 3 purple, 4 yellow trim, 5 black, 6 white
def classify_rgb(rgb):
    hsv = cv2.cvtColor(rgb.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2HSV).reshape(-1, 3).astype(int)
    h, s, v = hsv[:, 0] * 2, hsv[:, 1], hsv[:, 2]
    c = np.zeros(len(h), int)
    c[(v < 70)] = 5
    c[(s < 35) & (v > 225)] = 6
    c[(h >= 245) & (h <= 320) & (s > 70) & (v >= 50)] = 3
    c[(h >= 30) & (h <= 60) & (s > 110) & (v > 120)] = 4
    org = (h < 28) & (s > 100) & (v >= 70)
    c[org & (s < 175)] = 1                      # skin: lighter, less saturated
    c[org & (s >= 175)] = 2                     # ball: deep saturated orange
    return c
def frame_classes(img_rgb): return classify_rgb(img_rgb.reshape(-1, 3)).reshape(img_rgb.shape[:2])
PAL = np.array([[45, 45, 50], [235, 170, 120], [230, 90, 20], [120, 40, 200], [250, 200, 40], [10, 10, 10], [255, 255, 255]], np.uint8)
