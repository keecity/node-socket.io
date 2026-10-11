# Dino Lab

This package contains the latest version with the neck and head seam fixes.

Run from this extracted folder:

    python3 -m http.server 8000

Then open http://localhost:8000 in your browser. Use a local web server rather than opening index.html directly, because the app loads model and texture files.

The PlayCanvas engine and dinosaur assets are included. Google Fonts uses an internet connection; the app falls back to system fonts.

The creature stays in one skinned mesh. Connections use closed triangle strips, cached topology, local smoothing with falloff, and partial surface updates. A background worker refines connections after edits settle. Original head bone weights are preserved.

First-time connections and major shape changes take longer than cached edits. Performance depends on your device.
