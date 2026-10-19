"""Animation log: one Markdown page per monster, written by `pack`.

It joins what was asked for (the clip registry: prompt, model, generation job, solve quality)
with what pack measured (segment, timing, travel, gait speed and direction) and what it decided
(used, fallback, rejected and why), so the next monster starts from a complete record.
"""


def _fmt_s(x):
    return "-" if x is None else f"{x:.2f} s"


def write_log(path, manifest, registry, animset):
    reg = (registry or {}).get("sources", {})
    clips = manifest["clips"]
    lines = [f"# {manifest['name']} — animation log", ""]
    v = (registry or {}).get("video", {})
    if v:
        lines += [f"Video model **{v.get('model')}**, {v.get('duration_s')} s, {v.get('resolution')}, {v.get('aspect')}, "
                  f"from the two-view start frame (media `{v.get('start_image_media')}`).", ""]
    if (registry or {}).get("detector"):
        lines += [f"Detector: {registry['detector']}.", ""]
    b = manifest["body"]
    lines += ["## Body (measured from the rig)", "",
              f"- Bone roles: hip `{manifest['roles']['hip']}`, head tip `{manifest['roles'].get('head_tip')}`, "
              f"jaw tip `{manifest['roles'].get('jaw_tip')}`, feet {', '.join('`%s`' % f for f in manifest['roles']['feet'])}, "
              f"tail {len(manifest['roles'].get('tail', []))} bones",
              f"- Nose to rump {b['length']:.3f} m, height {b['height']:.3f} m, footprint capsule radius {b['radius']:.3f} m", ""]

    lines += ["## Game clips", "",
              "| Role | Source | Status | Length (at rate) | Rate | Key moment | Measured |",
              "|---|---|---|---|---|---|---|"]
    for role, spec in animset["clips"].items():
        c = clips.get(role)
        if c is None:
            why = manifest.get("rejected_clips", {}).get(role)
            fb = manifest.get("fallbacks", {}).get(role)
            status = f"**rejected**: {why}" if why else "**missing**"
            if fb:
                status += f" → plays `{fb}`"
            lines.append(f"| {role} | {spec['source']} | {status} | - | - | - | - |")
            continue
        rate = c.get("rate", 1)
        facts = []
        if "speed" in c:
            facts.append(f"gait {c['speed']:.2f} m/s at {c['heading_deg']:+.0f}°, loop {c['loop']['cycles']}×{c['loop']['period_s']:.2f} s (seam {c['loop']['seam_error']:.1%})")
        if c.get("airborne"):
            facts.append("airborne " + ", ".join(f"{a:.2f}–{e:.2f}" for a, e in c["airborne"]))
        if c.get("travel", 0) > 0.02:
            facts.append(f"travel {c['travel']:.2f} m")
        if c.get("reach") is not None:
            facts.append(f"strike reach {c['reach']:.2f} m")
        key = f"{_fmt_s(c.get('event'))} ({spec['event']['type']})" if "event" in spec else "-"
        lines.append(f"| {role} | {c['source']} [{c['frames'][0]}–{c['frames'][1]}] | used | "
                     f"{c['duration']:.2f} s ({c['duration'] / rate:.2f} s) | {rate:g}× | {key} | {'; '.join(facts) or '-'} |")
    lines.append("")

    lines += ["## Moves", "", "| Move | Type | Clip | Damage | Cooldown | Notes |", "|---|---|---|---|---|---|"]
    for key, m in manifest.get("moves", {}).items():
        extra = []
        for k in ("range", "energy", "paralyze", "wave_speed", "area", "armor"):
            if k in m:
                extra.append(f"{k} {m[k]}")
        lines.append(f"| {m.get('name', key)} | {m['type']} | {m['clip']} | {m.get('damage', '-')} | {m.get('cooldown', '-')} s | {', '.join(extra) or '-'} |")
    lines.append("")

    lines += ["## Source clips", ""]
    for name, r in reg.items():
        solve = r.get("solve") or {}
        q = []
        if solve:
            q.append("views agree" if solve.get("views_agree") else "views disagree")
            if solve.get("bad_fraction") is not None:
                q.append(f"bad joints {solve['bad_fraction']:.1%}")
            if solve.get("body_only_bad_fraction") is not None:
                q.append(f"body only {solve['body_only_bad_fraction']:.1%}")
        lines += [f"### {name}", "",
                  f"- Job: `{r.get('job') or 'not generated'}`" + ("" if r.get("subject_only_clause", True) else " (before the subject-only rule)"),
                  f"- Solve: {', '.join(q) or '-'}",
                  f"- Prompt action: {r['action']}"]
        if r.get("notes"):
            lines.append(f"- Notes: {r['notes']}")
        lines.append("")

    todo = [f"`{k}`: {v}" for k, v in manifest.get("rejected_clips", {}).items()]
    todo += [f"`{k}`: not generated" for k, r in reg.items() if not r.get("job")]
    if todo:
        lines += ["## To redo", ""] + [f"- {t}" for t in todo] + [""]
    with open(path, "w") as f:
        f.write("\n".join(lines))
