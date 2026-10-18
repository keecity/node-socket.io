"""Video prompts for the two-view start frame.

Every clip must show the subject and nothing else. The solver compares the two views, so
anything the video model adds (a spark, a slash trail, a rock, a shockwave, a second
creature) is read as a disagreement and the clip is rejected even when the body motion is
right. Attack effects belong in the game, not in the reference clip.
"""

FRAMING = ("Split-screen turnaround of the same 3D creature: left panel is the front view, right panel is the "
           "side view. Both panels show the exact same creature performing the exact same motion at the same "
           "time, perfectly synchronized.")

STAGING = ("It stays inside each panel at all times. Cameras are completely locked off and static in both panels: "
           "no zoom, no pan, no camera shake, no cuts. Keep the plain studio background, even lighting, gray bars "
           "top and bottom, and the creature's design exactly as in the first frame.")

SUBJECT_ONLY = ("Only the creature is in the frame, nothing else ever appears: no visual effects, no lightning, "
                "sparks, energy, glow, fire, smoke, dust, debris, impact flashes, motion trails or shockwaves; no "
                "props, rocks, ground cracks, shadows of other objects, extra limbs, extra tails or other creatures. "
                "The creature's body never changes shape, color or size. The background stays empty and unchanged "
                "for the whole clip.")


def clip_prompt(action):
    """Prompt for one clip: ``action`` describes only the motion, e.g. 'BITE: the creature lunges...'."""
    action = action.strip()
    if not action.endswith((".", "!")):
        action += "."
    return " ".join([FRAMING, action, STAGING, SUBJECT_ONLY])
