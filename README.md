# TG Film Room

Draw on game film with your Apple Pencil, then let the edit happen in code.

1. **Film** – open the app on your iPad, start a screen recording, start your camera, tap **Sync mark**, and break down the play.
2. **Edit** – put the screen recording and the camera file in `pipeline/input/` and run one command. Out comes a 1080p video with you on the left, the full film on the right, animated nodes behind, the TG monogram, and clean audio.

## First-time setup (once, in Claude Code)

Open this folder in Claude Code and ask it to do these for you:

1. **Install ffmpeg** – `brew install ffmpeg` (install Homebrew first if the Mac doesn't have it).
2. **Put the project on GitHub** – create a repo called `tg-film-room` and push this folder.
3. **Turn on hosting** – move `setup/pages.yml` to `.github/workflows/pages.yml` (it deploys the `app/` folder to GitHub Pages on every push to `main`). Then in the repo: Settings → Pages → Source: GitHub Actions.
4. **On the iPad** – open the Pages link in Safari → Share → Add to Home Screen. It now opens full screen like an app.

## Filming a breakdown

- Use clips up to about 3 minutes.
- iPad: Control Centre → long-press Screen Recording → **Microphone on** → Start Recording.
- Start your camera (phone or camera) so it can hear the iPad.
- In Film Room tap **Sync mark** once (you'll hear a beep and the video flashes). Then talk through the play.
- The jog wheel sits beside the film, so it never shows up in the final video.

## Making the video

```
python3 pipeline/make_video.py
```

It finds the two videos in `pipeline/input/` (the screen recording's name contains `ScreenRecording`). The finished file goes to `pipeline/output/`.

Useful options:

| Option | What it does |
| --- | --- |
| `--preview 20` | Render only 20 seconds, to check the look quickly |
| `--fast` | Use the Mac's hardware encoder (quicker) |
| `--audio screen` | Use the iPad's microphone instead of the camera's |
| `--camera-sync 12.4` | Tell it when you tapped Sync mark in the camera file, if the beep wasn't heard |
| `--no-watermark` | Leave the TG monogram off |
| `--no-nodes` | Plain background, no animated nodes |
| `--cuts "0:12 me, 0:30 film, 0:45 split"` | Switch layouts at those times: `me` = you full screen, `film` = film full screen, `split` = side by side (the start). Each switch is a soft crossfade |

## Brand

Everything follows the Evergreen brand guide in `docs/brand/`. See `CLAUDE.md` for the short version.
