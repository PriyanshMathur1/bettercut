---
name: bettercut
description: "BetterCut: raw talking-head clips in, finished vertical reel out. Picks the last clean take of every repeated line, cuts fillers and dead air, styles the reel with one of 17 looks (63 caption styles, 16 formats, 61 motion effects, 13 hook titles, 19 animated overlays, 17 grades, SFX), optional speaker cutout for words behind the head, Mimic a reference reel's style, and an editor with text-based cutting and timestamped notes. Trigger on /bettercut or 'edit these clips into a reel', 'make this reel look like <reference>', 'change the captions / look / format of my reel'."
---

# BetterCut

All commands run from the BetterCut folder with its environment: `PY = .venv/bin/python` (create it with `./scripts/setup.sh`).

```bash
PY -m bettercut make <project> <clips or folder> [--look bold-pop] [--cutout] [--names "Claude,Acme"] [--hook "..."]
PY -m bettercut render <project> [--quality draft|high|max]     # renders/<project>-vN.mp4 + -phone.mp4 + QA
PY -m bettercut still <project> <seconds>                         # PNG with the safe-zone guide
PY -m bettercut look <project> <look-id>                          # re-style, keeps your edits to words/overlays
PY -m bettercut mimic <file-or-url> --name "creator style"        # new look in ~/.bettercut/looks
PY -m bettercut render <project> --aspect all             # 9x16 + 4x5 + 1x1 + 16x9 ; --quality master = ProRes HQ
PY -m bettercut colour <project>                          # bake colour grade + voice enhancement now
PY -m bettercut export <project>                          # .srt .vtt .fcpxml (finish the cut in Resolve / Final Cut)
PY -m bettercut broll <project>                           # stock b-roll for punch words (needs PEXELS_API_KEY)
PY -m bettercut looks | catalog | validate <project>
PY -m bettercut ui                                                # editor at http://localhost:4790
```

Projects live in `~/bettercut-projects/<project>/` (override with `BETTERCUT_PROJECTS`). The whole edit is
`spec.json`; the renderer is `composer/src/reel/` (composition id `BetterCut`).

## Workflow
1. `make` with the user's clips. Pass names/brands/jargon with `--names` so Whisper spells them right.
   Word timings are force-aligned with whisperX (frame-accurate cuts and karaoke); `--no-align` skips it.
   `make` also detects your face per shot (framing + punch-in focus) and crops wide footage around you.
   Add `--stabilize` for shaky handheld clips. Use `--cutout` when the look/format needs it (behind-head words, greenscreen, head-breakout, colour-pop,
   magazine). It takes a few minutes; say so.
2. Read `spec.json` words: check `cut` (retakes/fillers, `cutReason`) and `emphasis` choices. Fix mishearings.
3. Post a short summary (lines kept, look, hook) and render a `draft` first; look at `work/cut_check.jpg`.
4. Apply notes by editing `spec.json`, then render `high`. Never delete the user's files.

## spec.json (times are SOURCE seconds unless named out*)
- `source {src, matte?, width, height, duration, fps}`. `matte` = cut-out VP9 webm, enables behind-head.
- `segments[] {start, end, zoom?, cx?, cy?}`: kept ranges of the source, in order. `zoom` = punch-in for
  that shot, `cx/cy` = focus (0..1).
- `words[] {text, start, end, cut?, emphasis?, emoji?, breakAfter?}`. `cut: true` removes the word AND the
  gap after it. `emphasis` = punch word (bigger/accent; behind the head when `captions.behindHead`).
- `captions {enabled, style, position: top|upper|middle|lower|bottom, scale, wordsPerPage, uppercase?, behindHead?, color?, highlight?, punchY?}`
- `format {id, headline?, background?, media?, mediaKind?}`
- `hook {text, style, duration, subtitle?}` first seconds title. `endCard {enabled, style, text, subtitle?, duration}`
- `overlays[] {kind, start, end, x?, y?, scale?, rotate?, enter?, text?, subtitle?, items?, itemTimes?, value?, prefix?, suffix?, src?, emoji?, color?, tiers?, sfx?}`
  x/y = centre, 0..1 of the frame. Keep y between 0.12 and 0.76 (Instagram safe zone).
- `broll[] {src, start, end, mode: full|split|pip|card|behind, from?, kind?}`
- `motion {autoZoom: off|subtle|alternate|punchy, cutTransition, camera, events[] {effect, at, duration?, intensity?}}`
- `grade {preset, vignette 0..1, grain 0..1}` (creative CSS look on top) plus the BAKED grade (ffmpeg, true colour):
  `lut` (built-in: cinematic-teal, warm-film, cool-film, golden-hour, bleach-bypass, faded-matte, punchy-pop,
  moody-green, night-blue, pastel-dream, mono-silver, sunset-pink, clean-skin, high-contrast-bw, or any .cube
  in ~/.bettercut/luts), `lutStrength 0..1`, `exposure -2..2 EV`, `temperature/tint/contrast/highlights/shadows/
  saturation/vibrance -100..100`, `sharpen/denoise 0..100`, `autoWhiteBalance`, `autoExposure`, `matchClips`.
  Per-shot overrides: `segments[i].grade {...}`. Renders re-bake automatically when these change.
- `segments[i].speed` 0.25..4 (speed ramp), `segments[i].zoom/cx/cy` (punch-in and focus; set from face detection).
- `audio {music?, musicVolume, duck, sfx, sfxVolume, voiceVolume, enhanceVoice?, loudness? (LUFS, default -14), sfxEvents[] {at, sound, volume?}}`
  Every render is loudness-mastered (two-pass EBU R128, -1 dBTP). `motion.beatPulse` pulses the frame on music beats.
- `brand {name, handle, primary, accent, text, ink, background, headingFont, bodyFont, serifFont}`
- `progressBar`, `safeGuide` (preview only, never render with it)

Mapping a note's OUTPUT time to SOURCE time: walk `segments` in order, subtract each kept length
(minus cut-word gaps) until the remainder fits in a segment; source = segment.start + remainder.
`PY -c "from bettercut.timeline import place_segments; ..."` gives `outStart/outEnd` per segment.

## Values
Run `PY -m bettercut catalog` for the authoritative list. Summary:
- Looks: bold-pop, behind-head, warm-serif, editorial-dark, clean-minimal, karaoke, box-highlight, clean-frame,
  cinema, neon-night, comic, retro-vhs, colour-pop, magazine, podcast-clip, tier-list, floating (+ mimic-*).
- Caption styles (63), groups Karaoke, Pop, Box, Minimal, Kinetic, Editorial, Fun, Retro, Neon, e.g.
  karaoke-fill, bold-pop, pop-emoji, pop-single, highlight-box, box-accent, box-pill, box-tape, minimal-clean,
  kinetic-stack, kinetic-mix, editorial-serif, editorial-mix, editorial-quiet, fun-comic, retro-pixel, neon-cyan.
- Formats (16): full, blur-fit, white-frame, polaroid, cinema, split-top, split-bottom, side-by-side, pip,
  greenscreen*, head-breakout*, colour-pop*, magazine, panel-top, post-card, zoom-frame (*needs matte).
- Effects: camera (punch-in, punch-hold, slow-push, ken-burns-left, shake-hard, handheld, dutch-left,
  crash-zoom, zoom-face...), transition (flash-white, flash-black, zoom-blur, whip-left, glitch, rgb-split,
  light-leak, film-burn, iris, shutter, vhs, zoom-through...), entrance for overlays (pop, slide-up,
  drop-bounce, spin-pop, blur-in, scale-down, elastic, wipe-in, reveal-up...).
- Hook titles: slam, stamp, marker, stacked, serif-elegant, glitch, typewriter, neon, ticker, question,
  big-number, split-headline, label. End cards: follow, subscribe-glow, comment-keyword, minimal-handle.
- Overlays: emoji, sticker, lowerThird, checklist, numberedList, progressSteps, counter, keyword, image, arrow,
  circle, followButton, notification, quote, commentReply, poll, tierList, splitHeadline, postCard.
- Grades: none, clean, punchy, warm, golden, cool, teal-orange, moody, editorial-dark, film, vintage, pastel,
  high-key, mono, noir, matrix, duotone-brand. SFX: whoosh, swish, pop, click, ding, hit, riser, swoosh_up,
  glitch, shutter, typing, notify, bass_drop (or a file path).

## Rules
1. Safe zone (1080x1920): nothing important above y 220, below y 1470, within 35px of the sides, or in the
   right 100px below y 1155. Check with `still` (red = unsafe).
2. Never cover the face with cards; behind-head words must stay readable.
3. Captions say what was said: fix names, keep meaning. No em dashes in on-screen text.
4. SFX stay under the voice. QA flags peaks above -0.5 dB.
5. Real people's content (reaction media, b-roll from others) gets an on-screen @credit. Use generic
   placeholders for commenters/notifications, never fabricated proof.
6. Mimic learns pacing/colour/typography from a reference; it never reuses the reference's footage or text.
