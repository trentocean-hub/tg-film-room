# TG Film Room

Trenton Gibson's film-breakdown tools. Trenton is a pro basketball player (#33, playing in Germany) who makes YouTube and TikTok breakdowns for high school and college hoopers. He is not a developer: explain changes in plain words, and keep things simple to run.

## What's here

- `app/` – the iPad web app (Apple Pencil telestrator). Plain HTML, CSS and JS, **no build step and no npm**. Open `app/index.html` through any static server.
  - `js/app.js` – everything: drawing tools, jog wheel, playback, Sync mark.
  - `css/app.css` – brand tokens at the top (`:root`).
  - `sw.js` – offline cache. **Bump `VERSION` in `sw.js` whenever app files change**, or iPads keep the old version.
  - `manifest.webmanifest` – lets it run full screen from the iPad Home Screen.
- `pipeline/make_video.py` – turns the iPad screen recording + the camera recording into the finished video. Python 3 standard library + ffmpeg only (no pip packages).
  - `pipeline/input/` – drop the two recordings here. `pipeline/output/` – finished videos land here. Both are git-ignored.
- `docs/brand/` – the brand guide PDFs. Read them before changing anything visual.

## How the two halves connect (keep these in sync)

- **Face-cam zone.** The jog wheel sits in `.zone` in `app/css/app.css` (right 2%, bottom 3%, width 25%, height 33% of the stage). `ZONE` in `pipeline/make_video.py` must use the same numbers, so the camera lands exactly on top of the wheel.
- **Sync mark.** Tapping it plays a 1 kHz beep for 0.2 s and fills the stage with bone (#EEE7D8) for 0.2 s. The pipeline finds the beep in both recordings to line them up, and finds the bone rectangle to know where the video sits on screen. If you change the beep or the flash, change `find_beep` / `find_flash` too.

## Brand rules (Evergreen, from docs/brand)

- Colours: night `#0E1511` ground, ground-raised `#161F1A`, forest `#24402F` (lead, big fields), forest-glow `#8CC4A4` (the only bright colour, keep it small), plum `#4B2742` (panels), oxblood `#6B1D27` / oxblood-soft `#D9A0A6` (one "this is the mistake" accent per frame), ink/bone `#EEE7D8`, ink-muted `#A3A89F`.
- Never put forest text or thin forest lines on night (1.6:1 contrast).
- Type: Cormorant Garamond 500 for titles, Inter 400/500 for everything else. No third family.
- Copy: sentence case, a player talking to players, direct and calm. Short first line, quieter second line. No tracked capitals, no code-style labels, no emoji, no icon packs.
- Motion: "seed, then materialize" – forest-glow particles gather (1.6–2.0 s) then settle (1.8–2.4 s); text fades in from an 8px blur over 1.2 s. No snaps, bounces, zooms or whooshes. (The Sync mark flash is a production marker that the pipeline cuts out; it never reaches the final video.)
- Logos: TG monogram (`app/assets/tg-monogram.png`) for watermarks and small spaces. Bone on night/forest/plum/oxblood only, no effects.

## Running things

- App locally: `cd app && python3 -m http.server 8080`, then open `http://<mac-ip>:8080` on the iPad (same Wi-Fi). Pencil features need a real iPad.
- Pipeline: `brew install ffmpeg` once, then `python3 pipeline/make_video.py` (uses the two files in `pipeline/input/`). `--preview 20` renders 20 s to check the look; `--fast` uses the Mac's hardware encoder; `--help` lists overrides like `--camera-sync 12.4`.
- Hosting: the `app/` folder is deployed to GitHub Pages (see README). Pushing to `main` updates the live site.

## Ideas on the list

- Branded intro and end card using the particle "materialize" motion (Remotion is a good fit; Trenton has a `cc remotion draft` folder).
- Captions burned in from the camera audio.
- Telestration that follows a moving player.
- Saving a breakdown's drawings per clip.
