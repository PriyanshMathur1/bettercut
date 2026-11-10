"""Unit tests for BetterCut's pure decision logic (no ffmpeg, whisper or node needed)."""
from __future__ import annotations

import json

from pathlib import Path

import pytest

from bettercut import autocut, enrich, mimic, spec as specmod, timeline


def W(text, start, end, **kw):
    return {"text": text, "start": start, "end": end, **kw}


# ---- takes / fillers ---------------------------------------------------------

def test_pick_takes_keeps_last_complete_take():
    words = [
        W("This", 0.0, 0.2), W("is", 0.25, 0.4), W("the", 0.45, 0.6), W("hook.", 0.65, 0.9),
        W("This", 2.0, 2.2), W("is", 2.25, 2.4), W("the", 2.45, 2.6), W("real", 2.65, 2.9), W("hook.", 2.95, 3.2),
        W("Next", 4.0, 4.3), W("line.", 4.35, 4.6),
    ]
    out = autocut.pick_takes(words)
    assert [w["text"] for w in out if w.get("cut")] == ["This", "is", "the", "hook."]
    assert all(not w.get("cut") for w in out[4:])


def test_pick_takes_drops_false_start():
    words = [W("So", 0, 0.2), W("the", 0.25, 0.4), W("So", 1.5, 1.7), W("the", 1.75, 1.9), W("thing", 1.95, 2.2), W("is.", 2.25, 2.5)]
    out = autocut.pick_takes(words)
    assert [w.get("cut", False) for w in out] == [True, True, False, False, False, False]


def test_unrelated_lines_are_kept():
    words = [W("Money", 0, 0.3), W("matters.", 0.35, 0.8), W("Time", 2, 2.3), W("matters", 2.35, 2.7), W("more.", 2.75, 3.0)]
    assert not any(w.get("cut") for w in autocut.pick_takes(words))


def test_mark_fillers_and_stutter():
    words = [W("I", 0, 0.1), W("I", 0.15, 0.25), W("um", 0.3, 0.5), W("think", 0.55, 0.8)]
    out = autocut.mark_fillers(words)
    assert [w.get("cutReason") for w in out] == ["stutter", None, "filler", None]


# ---- segments ----------------------------------------------------------------

def test_build_segments_cuts_dead_air_and_pads():
    words = [W("a", 1.0, 1.3), W("b", 1.4, 1.7), W("c", 3.0, 3.4)]
    segs = autocut.build_segments(words, duration=5.0, max_gap=0.35)
    assert [(s["start"], s["end"]) for s in segs] == [(0.94, 1.8), (2.94, 3.5)]


def test_build_segments_ends_at_detected_silence():
    words = [W("a", 1.0, 1.6)]
    segs = autocut.build_segments(words, duration=5.0, silences=[(1.58, 2.5)])
    assert segs[0]["end"] == pytest.approx(1.62)


def test_cut_words_still_shape_segments_by_default():
    words = [W("a", 1.0, 1.3, cut=True), W("b", 1.4, 1.7)]
    assert autocut.build_segments(words, 5.0)[0]["start"] == pytest.approx(0.94)
    assert autocut.build_segments(words, 5.0, respect_cuts=True)[0]["start"] == pytest.approx(1.34)


# ---- enrichment --------------------------------------------------------------

def test_emphasis_prefers_numbers_and_respects_spacing():
    words = [W("I", 0, 0.1), W("made", 0.15, 0.3), W("$10,000", 0.35, 0.9), W("in", 0.95, 1.0), W("one", 1.05, 1.2), W("month.", 1.25, 1.6)]
    out = enrich.pick_emphasis(words)
    assert [w["text"] for w in out if w.get("emphasis")] == ["$10,000"]


def test_fix_names_snaps_mishearing():
    out = enrich.fix_names([W("Cloude,", 0, 0.3), W("skill", 0.4, 0.6)], ["Claude"])
    assert out[0]["text"] == "Claude,"
    assert out[1]["text"] == "skill"


def test_emoji_only_on_emphasis():
    out = enrich.attach_emoji([W("money", 0, 0.3, emphasis=True), W("money", 1, 1.3)])
    assert out[0].get("emoji") == "💰" and "emoji" not in out[1]


def test_hook_text_skips_cut_lines():
    words = [W("Um", 0, 0.2, cut=True), W("Three", 1, 1.2), W("rules", 1.3, 1.6), W("for", 1.7, 1.8), W("money.", 1.9, 2.2)]
    assert enrich.hook_text(words) == "Three rules for money"


# ---- timeline parity with the TypeScript renderer --------------------------------

TS_WORDS = [
    W("Hello", 0.1, 0.4), W("um", 0.5, 0.7, cut=True), W("world.", 0.9, 1.3), W("Next", 3.0, 3.3), W("line", 3.4, 3.7),
]


def test_timeline_matches_ts_vectors():
    placed = timeline.place_segments({"segments": [{"start": 0, "end": 1.5}, {"start": 2.9, "end": 3.8}], "words": TS_WORDS})
    assert len(placed) == 3
    assert placed[1]["outStart"] == pytest.approx(0.48)
    assert placed[-1]["outEnd"] == pytest.approx(0.48 + (1.5 - 0.87) + 0.9)


def test_total_duration_includes_end_card():
    spec = {"segments": [{"start": 0, "end": 2}], "words": [], "endCard": {"enabled": True, "duration": 2.5}}
    assert timeline.total_duration(spec) == pytest.approx(4.5)


# ---- spec / looks --------------------------------------------------------------

def test_every_builtin_look_applies():
    looks = specmod.list_looks()
    assert len([k for k, v in looks.items() if not v["user"]]) >= 15
    base = specmod.build_spec({"src": "/x.mp4", "width": 1080, "height": 1920, "duration": 5, "fps": 30}, [], [], hook="Hi there")
    for look_id in looks:
        s = specmod.apply_look(base, look_id, "Hi there")
        assert s["look"] == look_id
        assert s["captions"]["style"]
        assert "$hook" not in json.dumps(s)


def test_behind_head_disabled_without_matte():
    base = specmod.build_spec({"src": "/x.mp4", "width": 1080, "height": 1920, "duration": 5, "fps": 30}, [], [], look="behind-head")
    assert base["captions"]["behindHead"] is False


def test_validate_flags_missing_source_and_matte():
    s = specmod.build_spec({"src": "/nope.mp4", "width": 1080, "height": 1920, "duration": 5, "fps": 30}, [], [], look="colour-pop")
    issues = specmod.validate(s)
    assert any("missing" in i for i in issues)
    assert any("needs a cutout" in i for i in issues)


def test_look_patch_merges_one_level():
    out = specmod.merge({"a": {"x": 1, "y": 2}, "b": [1]}, {"a": {"y": 3}, "b": [2]})
    assert out == {"a": {"x": 1, "y": 3}, "b": [2]}


# ---- mimic ---------------------------------------------------------------------

def test_mimic_fast_dark_reference():
    patch = mimic.choose_look({
        "shots": {"cutsPerMin": 40},
        "colour": {"brightness": 0.25, "saturation": 0.2, "warmth": 0, "contrast": 0.5, "palette": ["#111111", "#FF2244"]},
        "speech": {"wps": 3.6},
    })
    assert patch["motion"]["autoZoom"] == "punchy"
    assert patch["grade"]["preset"] == "editorial-dark"
    assert patch["captions"]["wordsPerPage"] == 2
    assert patch["brand"]["accent"] == "#FF2244"
    assert patch["progressBar"] is True


def test_mimic_slow_warm_reference():
    patch = mimic.choose_look({
        "shots": {"cutsPerMin": 4},
        "colour": {"brightness": 0.6, "saturation": 0.3, "warmth": 0.2, "contrast": 0.3, "palette": ["#C0A080"]},
        "speech": {"wps": 1.8},
    })
    assert patch["motion"]["camera"] == "slow-push"
    assert patch["grade"]["preset"] == "warm"
    assert patch["captions"]["wordsPerPage"] == 4
    assert "brand" not in patch


def test_shot_stats():
    st = mimic.shot_stats([1.0, 2.0, 4.0], 6.0)
    assert st["shots"] == 4 and st["cutsPerMin"] == 40.0 and st["avgShot"] == 1.5


def test_speed_ramp_python_twin():
    placed = timeline.place_segments({"segments": [{"start": 0, "end": 2, "speed": 2}, {"start": 3, "end": 4}], "words": []})
    assert placed[0]["outEnd"] == pytest.approx(1.0)
    assert timeline.to_output(placed, 1.0) == pytest.approx(0.5)


# ---- pro upgrades: colour, audio, export, vision, b-roll -----------------------------

from bettercut import colour, export, vision, broll  # noqa: E402


def _spec(**kw):
    s = specmod.build_spec({"src": "/x.mp4", "width": 1080, "height": 1920, "duration": 10, "fps": 30}, [], [{"start": 0, "end": 4}, {"start": 5, "end": 9}])
    s.update(kw)
    return s


def test_neutral_grade_needs_no_bake():
    assert not colour.needs_bake(_spec())


def test_build_filter_orders_correction_then_lut():
    s = _spec()
    s["grade"].update({"exposure": 0.5, "temperature": 40, "lut": "cinematic-teal", "lutStrength": 1, "sharpen": 20})
    f = colour.build_filter(s)
    assert f.index("exposure=") < f.index("colortemperature") < f.index("lut3d") < f.index("cas=")
    assert colour.needs_bake(s)


def test_per_shot_grade_uses_timeline_enable():
    s = _spec()
    s["segments"][1]["grade"] = {"saturation": -50}
    assert "enable='between(t,5.000,9.000)'" in colour.build_filter(s)


def test_partial_lut_strength_blends():
    s = _spec()
    s["grade"].update({"lut": "warm-film", "lutStrength": 0.5})
    assert "blend=all_mode=normal:all_opacity=0.500" in colour.build_filter(s)


def test_bake_key_changes_with_settings_and_voice():
    a, b = _spec(), _spec()
    b["grade"]["exposure"] = 0.2
    c = _spec()
    c["audio"]["enhanceVoice"] = True
    assert len({colour.bake_key(a), colour.bake_key(b), colour.bake_key(c)}) == 3


def test_auto_exposure_and_match_gains():
    assert colour.auto_exposure_ev({"luma": 0.235}) == pytest.approx(1.0, abs=0.01)
    assert colour.auto_exposure_ev({"luma": 0.01}) == 1.5
    g, o = colour.match_gains({"mean": [0.5, 0.5, 0.5], "std": [0.2, 0.2, 0.2]}, {"mean": [0.4, 0.5, 0.6], "std": [0.1, 0.2, 0.4]})
    assert g == [1.6, 1.0, 0.6] and o[1] == 0.0


def test_generated_lut_is_valid_cube(tmp_path):
    p = colour.write_cube(tmp_path / "t.cube", colour.LOOKS["mono-silver"], size=5)
    lines = p.read_text().splitlines()
    assert "LUT_3D_SIZE 5" in lines
    assert len([ln for ln in lines if ln and ln[0].isdigit()]) == 125


def test_srt_vtt_and_fcpxml():
    s = _spec(words=[W("Hello", 0.5, 0.9), W("world.", 1.0, 1.4), W("Again", 5.5, 5.9)])
    srt = export.srt(s)
    assert srt.startswith("1\n00:00:00,500 --> 00:00:01,400\nHello world.")
    assert "00:00:04,500" in srt  # 5.5s source -> 4.5s output after the 4..5 gap is cut
    assert export.vtt(s).startswith("WEBVTT")
    x = export.fcpxml(s)
    assert x.count("<asset-clip") == 2 and 'offset="120/30s"' in x


def test_face_focus_point_keeps_headroom():
    cx, cy = vision.focus_point((0.4, 0.3, 0.2))
    assert cx == 0.4 and cy == pytest.approx(0.42)


def test_broll_keywords_spaced_and_meaningful():
    s = _spec(words=[W("money", 1, 1.3, emphasis=True), W("savings", 2, 2.4, emphasis=True), W("travel", 6, 6.4, emphasis=True), W("2024", 9, 9.3, emphasis=True)])
    assert [k["word"] for k in broll.keywords(s)] == ["money", "travel"]


def test_catalog_reads_every_style_from_the_renderer():
    from bettercut.catalog import counts

    c = counts()
    assert c["captionStyles"] >= 60 and c["formats"] >= 16 and c["effects"] >= 60
    assert c["titles"] >= 13 and c["overlays"] >= 19 and c["grades"] >= 17


def test_alignment_merge_retimes_matching_words_only():
    from bettercut.align import merge_alignment

    words = [
        {"text": "Hello,", "start": 0.10, "end": 0.50},
        {"text": "2024", "start": 0.55, "end": 1.00},
        {"text": "world.", "start": 1.05, "end": 1.60},
        {"text": "again", "start": 1.70, "end": 2.00},
    ]
    aligned = [
        {"word": "Hello,", "start": 0.22, "end": 0.48},
        {"word": "2024"},                                   # aligner skipped (digits)
        {"word": "world.", "start": 1.12, "end": 1.75},     # end overlaps next word -> clipped
        {"word": "again", "start": 3.50, "end": 3.90},      # shifted > max_shift -> ignored
    ]
    out, moved = merge_alignment(words, aligned)
    assert moved == 2
    assert (out[0]["start"], out[0]["end"]) == (0.22, 0.48)
    assert (out[1]["start"], out[1]["end"]) == (0.55, 1.00)
    assert out[2]["start"] == 1.12 and out[2]["end"] == 1.70
    assert (out[3]["start"], out[3]["end"]) == (1.70, 2.00)
    assert words[0]["start"] == 0.10  # input not mutated


def test_alignment_merge_survives_text_mismatch():
    from bettercut.align import merge_alignment

    words = [{"text": t, "start": i * 0.5, "end": i * 0.5 + 0.4} for i, t in enumerate(["so", "um", "the", "plan"])]
    aligned = [{"word": "so", "start": 0.05, "end": 0.3}, {"word": "the", "start": 1.02, "end": 1.2}, {"word": "plan", "start": 1.55, "end": 1.9}]
    out, moved = merge_alignment(words, aligned)
    assert moved == 3
    assert out[1] == words[1]  # "um" missing from aligner keeps Whisper timing


def test_alignment_boxes_pad_into_silence_not_neighbours():
    from bettercut.align import pad_segments

    segs = [{"text": "a", "start": 0.2, "end": 1.0}, {"text": "b", "start": 1.3, "end": 2.0}]
    out = pad_segments(segs, duration=2.2)
    assert out[0]["start"] == 0.0 and out[0]["end"] == 1.3
    assert out[1]["start"] == 1.0 and out[1]["end"] == 2.2
    assert segs[0]["end"] == 1.0


def test_contact_sheet_handles_limited_range_phone_video(tmp_path):
    import subprocess
    from bettercut import media

    clip = tmp_path / "phone.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=320x568:r=30:d=2",
                    "-pix_fmt", "yuv420p", "-color_range", "tv", "-c:v", "libx264", str(clip)], check=True)
    out = media.contact_sheet(clip, tmp_path / "sheet.jpg", [0.5, 1.5], cols=2, width=120)
    assert out.exists() and out.stat().st_size > 0


def test_assemble_mixes_silent_and_voiced_clips(tmp_path):
    import subprocess
    from bettercut import media

    silent, voiced = tmp_path / "silent.mp4", tmp_path / "voiced.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=180x320:r=30:d=1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(silent)], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=180x320:r=30:d=1",
                    "-f", "lavfi", "-i", "sine=f=440:d=1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", str(voiced)], check=True)
    info = media.assemble([silent, voiced], tmp_path / "out.mp4", width=180, height=320)
    assert media.has_audio(tmp_path / "out.mp4")
    assert abs(info["duration"] - 2.0) < 0.15
    assert [c["start"] for c in info["clips"]] == [0.0, 1.0]


def test_split_number_tokens_are_rejoined_and_never_cut_as_stutters():
    from bettercut import autocut, enrich

    raw = [("That's", 8.45, 8.70), ("3", 8.74, 8.86), (".3", 8.88, 9.18), ("%", 9.20, 9.48), ("back", 9.51, 9.75),
           ("10", 21.56, 21.68), (",000", 21.70, 22.20), ("rupees.", 22.31, 22.8), ("add", 23.0, 23.2), ("-on", 23.22, 23.4),
           ("cards", 23.45, 23.8)]
    words = [{"text": t, "start": a, "end": b} for t, a, b in raw]
    merged = autocut.mark_fillers(enrich.merge_split_tokens(words))
    assert [w["text"] for w in merged] == ["That's", "3.3%", "back", "10,000", "rupees.", "add-on", "cards"]
    assert not any(w.get("cut") for w in merged)
    assert merged[1]["start"] == 8.74 and merged[1]["end"] == 9.48


def test_numbers_are_not_stutters_but_words_are():
    from bettercut import autocut

    ws = [{"text": t, "start": i, "end": i + 0.5} for i, t in enumerate(["I", "I", "think", "2", "2", "options"])]
    out = autocut.mark_fillers(ws)
    assert [w.get("cut", False) for w in out] == [True, False, False, False, False, False]


def test_uncovered_speech_finds_dropped_lines():
    from bettercut.media import uncovered_speech

    words = [{"text": "a", "start": 0.2, "end": 0.6}, {"text": "b", "start": 0.7, "end": 1.4},
             {"text": "c", "start": 24.9, "end": 26.3}]
    speech = [(0.15, 1.5), (24.5, 31.0), (40.0, 40.3)]
    # the CTA at 26.3-31.0 was dropped; the 0.3 s blip at 40 s is too short to matter
    assert uncovered_speech(speech, words) == [(26.55, 31.0)]
    assert uncovered_speech([(0.15, 1.5)], words) == []


def test_validate_flags_placeholder_brand_on_end_card():
    from bettercut.spec import DEFAULT_BRAND, validate

    spec = {"source": {"src": "http://x/a.mp4"}, "segments": [{"start": 0, "end": 1}],
            "endCard": {"enabled": True}, "brand": dict(DEFAULT_BRAND)}
    assert any("placeholder" in i for i in validate(spec))
    spec["brand"] = {**DEFAULT_BRAND, "name": "Asha", "handle": "asha"}
    assert not any("placeholder" in i for i in validate(spec))


def test_placeholder_brand_is_advice_and_never_blocks_a_render():
    from bettercut.spec import DEFAULT_BRAND, blocking, validate

    spec = {"source": {"src": "http://x/a.mp4"}, "segments": [{"start": 0, "end": 1}],
            "endCard": {"enabled": True}, "brand": dict(DEFAULT_BRAND)}
    assert validate(spec) and blocking(spec) == []
    spec["segments"] = []
    assert any("no segments" in i for i in blocking(spec))


def test_a_clip_with_no_speech_becomes_a_whole_clip_reel(tmp_path, monkeypatch):
    """B-roll, music or screen recordings: nothing to cut on, so keep everything and show no captions."""
    from bettercut import media, pipeline

    src = tmp_path / "p" / "assets" / "source.mp4"
    monkeypatch.setattr(media, "find_clips", lambda clips, newest=None: ["clip.mp4"])
    monkeypatch.setattr(media, "assemble", lambda files, out, stabilize=False, **kw: (out.parent.mkdir(parents=True, exist_ok=True), out.write_bytes(b"x"), {"clips": []})[2])
    monkeypatch.setattr(media, "probe", lambda p: {"duration": 13.5, "width": 1080, "height": 1920})
    monkeypatch.setattr(media, "transcribe", lambda *a, **k: [])
    monkeypatch.setattr(media, "speech_gaps", lambda p: [(0.0, 13.5)])
    logs = []
    spec = pipeline.make(tmp_path / "p", ["clip.mp4"], reframe=False, log=logs.append)
    assert spec["words"] == [] and not (spec.get("hook") or {}).get("text")
    assert [(s["start"], s["end"]) for s in spec["segments"]] == [(0.0, 13.5)]
    assert any("no speech" in m for m in logs)
    from bettercut.spec import blocking
    assert blocking(spec) == []
    assert src.exists()


def test_shots_play_in_listed_order_with_freeze_frames_and_joins():
    """Python twin of composer/tests/reel/edit.test.ts: reorder, hold and join."""
    from bettercut import timeline as tl

    words = [{"text": "first", "start": 1, "end": 1.5}, {"text": "second", "start": 6, "end": 6.5}]
    spec = {"segments": [{"id": "s2", "start": 5, "end": 9}, {"id": "s1", "start": 0, "end": 4}], "words": words}
    placed = tl.place_segments(spec)
    assert [(p["id"], p["outStart"], p["outEnd"]) for p in placed] == [("s2", 0, 4), ("s1", 4, 8)]
    assert [w["text"] for w in tl.output_words(spec)] == ["second", "first"]

    spec = {"segments": [{"start": 0, "end": 2, "hold": 1.5}, {"start": 2, "end": 4, "join": True}, {"start": 5, "end": 9}], "words": []}
    placed = tl.place_segments(spec)
    assert placed[-1]["outEnd"] == 9.5
    assert [p["shot"] for p in placed] == [0, 0, 1]
    assert tl.to_output(placed, 3) == 4.5  # after the 1.5 s freeze


def _fake_media(monkeypatch, tmp_path, new_words, add_len=6.0, old_len=10.0):
    """Stand-ins for ffmpeg and whisper so add_clips runs in milliseconds."""
    from bettercut import media

    def assemble(files, out, stabilize=False, **size):
        _fake_media.sizes.append(size)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"add")
        return {"clips": [{"clip": "new.mp4", "path": "new.mp4", "start": 0.0, "duration": add_len}], "duration": add_len}

    def concat(files, out):
        out.write_bytes(b"joined")
        return out

    _fake_media.sizes = []  # the frame size and rate each assemble call was asked for
    monkeypatch.setattr(media, "find_clips", lambda clips, newest=None: ["new.mp4"])
    monkeypatch.setattr(media, "assemble", assemble)
    monkeypatch.setattr(media, "concat", concat)
    monkeypatch.setattr(media, "probe", lambda p: {"duration": old_len + add_len if "source-" in str(p) else (add_len if str(p).endswith("add.mp4") else old_len)})
    monkeypatch.setattr(media, "transcribe", lambda *a, **k: [dict(w) for w in new_words])
    monkeypatch.setattr(media, "speech_gaps", lambda p: [])


def _reel(tmp_path, **source):
    from bettercut import pipeline

    proj = tmp_path / "p"
    (proj / "assets").mkdir(parents=True)
    (proj / "work").mkdir()
    src = proj / "assets" / "source.mp4"
    src.write_bytes(b"old")
    spec = {"version": 1, "source": {"src": str(src), "duration": 10.0, "width": 1080, "height": 1920, "fps": 30, **source},
            "segments": [{"id": "s1", "start": 0.0, "end": 4.0, "speed": 2}, {"id": "s2", "start": 5.0, "end": 9.0}],
            "words": [{"text": "Hello", "start": 0.2, "end": 0.6, "cut": True}], "overlays": [{"kind": "keyword", "start": 1, "end": 2, "text": "x"}],
            "grade": {"preset": "punchy", "baked": "abc"}}
    pipeline.save(proj, spec)
    return proj, spec


def test_add_clips_appends_footage_and_keeps_every_existing_edit(tmp_path, monkeypatch):
    from bettercut import pipeline

    proj, before = _reel(tmp_path, graded="/old/graded.mp4")
    _fake_media(monkeypatch, tmp_path, [{"text": "New", "start": 0.5, "end": 0.9}, {"text": "part.", "start": 1.0, "end": 1.4}])
    spec = pipeline.add_clips(proj, ["new.mp4"], reframe=False, log=lambda m: None)

    assert spec["segments"][:2] == before["segments"] and spec["words"][:1] == before["words"] and spec["overlays"] == before["overlays"]
    new = spec["segments"][2:]
    assert new and all(s["start"] >= 10.0 and s["end"] <= 16.0 for s in new)  # after the old footage
    assert len({s["id"] for s in spec["segments"]}) == len(spec["segments"])
    assert [(w["text"], w["start"]) for w in spec["words"][1:]] == [("New", 10.5), ("part.", 11.0)]
    assert spec["source"]["duration"] == 16.0
    src = before["source"]  # added footage is fitted to the project's own shape and rate
    assert _fake_media.sizes == [{"width": src.get("width") or 1080, "height": src.get("height") or 1920, "fps": int(src.get("fps") or 30)}]
    assert spec["source"]["src"] != before["source"]["src"] and Path(spec["source"]["src"]).exists()
    assert Path(before["source"]["src"]).exists()  # kept, so Undo still has footage to show
    assert "graded" not in spec["source"] and "baked" not in spec["grade"]  # must be re-baked from the new footage
    assert pipeline.load(proj) == spec


def test_add_clips_with_no_speech_adds_one_whole_shot_and_refuses_cutout_reels(tmp_path, monkeypatch):
    from bettercut import pipeline

    proj, _ = _reel(tmp_path)
    _fake_media(monkeypatch, tmp_path, [])
    spec = pipeline.add_clips(proj, ["new.mp4"], reframe=False, log=lambda m: None)
    assert [(s["start"], s["end"]) for s in spec["segments"][2:]] == [(10.0, 16.0)] and len(spec["words"]) == 1

    proj2, _ = _reel(tmp_path / "b", matte="/x/matte.webm")
    with pytest.raises(RuntimeError, match="cutout"):
        pipeline.add_clips(proj2, ["new.mp4"], reframe=False, log=lambda m: None)


def test_reversed_shots_get_a_file_that_survives_trimming_inwards(tmp_path, monkeypatch):
    from bettercut import media, reverse

    proj, spec = _reel(tmp_path)
    made = []
    monkeypatch.setattr(media, "reverse_span", lambda src, a, b, out: (made.append((a, b)), out.write_bytes(b"rev"), out)[2])
    assert reverse.is_current(spec)  # nothing reversed: nothing to do

    spec["segments"][1]["reverse"] = True
    assert not reverse.is_current(spec)
    baked = reverse.bake(spec, proj, log=lambda m: None)
    r = baked["segments"][1]["reversed"]
    assert made == [(5.0, 9.0)] and Path(r["src"]).exists() and (r["start"], r["end"]) == (5.0, 9.0)
    assert "reversed" not in baked["segments"][0] and reverse.is_current(baked)

    baked["segments"][1].update(start=6.0, end=8.0)  # trimmed inwards: the same file still covers it
    assert reverse.is_current(baked) and reverse.bake(baked, proj, log=lambda m: None) == baked and len(made) == 1
    baked["segments"][1]["start"] = 4.5  # trimmed outwards: needs a new file
    assert not reverse.is_current(baked)
    baked["segments"][1]["reverse"] = False  # switched off: the file reference goes away
    assert "reversed" not in reverse.bake(baked, proj, log=lambda m: None)["segments"][1]


def test_beats_repeat_when_the_music_loops_and_stop_at_the_end_of_the_reel():
    from bettercut.audio import tile_beats

    assert tile_beats([0.5, 1.5, 2.5], 3.0, 7.0) == [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]
    assert tile_beats([0.5, 1.5, 9.0], 20.0, 5.0) == [0.5, 1.5]  # music longer than the reel: no loop
    assert tile_beats([], 3.0, 7.0) == []


def test_beats_are_found_again_only_when_the_music_changes(tmp_path, monkeypatch):
    from bettercut import audio, colour, render, reverse

    proj, spec = _reel(tmp_path)
    music = tmp_path / "song.mp3"
    music.write_bytes(b"x")
    calls = []
    monkeypatch.setattr(audio, "beats", lambda p, max_seconds=None: (calls.append(str(p)), [0.5, 1.0])[1])
    monkeypatch.setattr(audio, "duration", lambda p: 60.0)
    monkeypatch.setattr(colour, "is_current", lambda s: True)
    monkeypatch.setattr(reverse, "is_current", lambda s: True)
    spec["audio"] = {"music": str(music)}
    out = render.prepare(spec, proj, log=lambda m: None)
    assert out["audio"]["beats"] == [0.5, 1.0] and out["audio"]["beatsFor"] == str(music)
    render.prepare(out, proj, log=lambda m: None)
    assert len(calls) == 1  # same music: not analysed again
    out["audio"].pop("music")
    cleared = render.prepare(out, proj, log=lambda m: None)
    assert "beats" not in cleared["audio"] and "beatsFor" not in cleared["audio"]


def test_camera_log_profiles_put_mid_grey_and_black_where_the_makers_say():
    """Anchors from each maker's published curve: the code value for 18% grey, and for black."""
    import numpy as np
    from bettercut import logprofile as L

    for profile, grey, black in (("apple-log", 0.4883, 0.0), ("slog3", 420 / 1023, 95 / 1023), ("vlog", 0.423311, 0.125)):
        assert abs(float(L.decode(profile, grey)) - 0.18) < 0.002, profile
        assert float(L.decode(profile, black)) <= 0.001, profile
        ramp = L.decode(profile, np.linspace(0.05, 0.95, 60))
        assert np.all(np.diff(ramp) > 0), profile  # brighter in, brighter out
        out = L.to_rec709(profile, np.array([[grey, grey, grey], [0.3, 0.3, 0.3], [0.7, 0.7, 0.7]]))
        assert np.allclose(out[:, 0], out[:, 1], atol=1e-3) and np.allclose(out[:, 1], out[:, 2], atol=1e-3), profile  # greys stay grey
        assert abs(out[0, 0] - 0.409) < 0.01, profile  # 18% grey lands at normal display mid grey
        assert 0 <= out.min() and out.max() <= 1
    with pytest.raises(ValueError):
        L.decode("nope", 0.5)


def test_log_conversion_runs_first_in_the_grade_and_forces_a_bake(tmp_path, monkeypatch):
    from bettercut import colour

    monkeypatch.setattr(colour, "LUT_DIR", tmp_path)
    spec = {"grade": {"log": "slog3", "exposure": 0.5}, "segments": [], "source": {"src": "x"}}
    assert colour.needs_video_bake({"grade": {"log": "slog3"}, "segments": []})
    chain = colour.build_filter(spec, luts={})
    assert chain.index("log-slog3.cube") < chain.index("exposure=")  # converted before any other control
    assert (tmp_path / "log-slog3.cube").read_text().splitlines()[1] == "LUT_3D_SIZE 65"
    assert colour.bake_key(spec) != colour.bake_key({**spec, "grade": {"exposure": 0.5}})
    assert "log-" not in colour.build_filter({"grade": {"log": "made-up"}, "segments": [], "source": {"src": "x"}}, luts={})


def test_green_screen_makes_the_cutout_once_and_removes_it_when_switched_off(tmp_path, monkeypatch):
    from bettercut import greenscreen as gs

    proj, spec = _reel(tmp_path)
    made = []
    monkeypatch.setattr(gs, "detect_color", lambda src: "#12C83A")
    monkeypatch.setattr(gs, "key_matte", lambda src, out, color, sim, blend: (made.append((color, sim, blend)), out.write_bytes(b"k"), out)[2])
    assert gs.is_current(spec)  # no green screen: nothing to do

    spec["source"]["key"] = {"similarity": 0.3}
    spec["source"]["gradedMatte"] = "/old/graded-matte.webm"
    assert not gs.is_current(spec)
    keyed = gs.bake(spec, proj, log=lambda m: None)
    assert made == [("#12C83A", 0.3, 0.08)]  # colour found automatically, other settings defaulted
    assert Path(keyed["source"]["matte"]).exists() and keyed["source"]["keyColor"] == "#12C83A"
    assert "gradedMatte" not in keyed["source"] and "baked" not in keyed["grade"]  # baked from the old cut-out
    assert gs.is_current(keyed) and gs.bake(keyed, proj, log=lambda m: None)["source"]["matte"] == keyed["source"]["matte"] and len(made) == 1

    keyed["source"]["key"]["similarity"] = 9  # out of range: clamped, and a new key is made
    again = gs.bake(keyed, proj, log=lambda m: None)
    assert made[-1][1] == 0.6 and again["source"]["matte"] != keyed["source"]["matte"]

    del again["source"]["key"]
    off = gs.bake(again, proj, log=lambda m: None)
    assert "matte" not in off["source"] and "keyed" not in off["source"] and gs.is_current(off)


def test_browser_recordings_with_no_length_are_repaired(tmp_path):
    """MediaRecorder writes a live stream with no length; the pipeline would read it as 0 seconds."""
    import shutil
    import subprocess

    from bettercut import media

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("needs ffmpeg")
    rec = tmp_path / "take.webm"
    made = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=180x320:r=15:d=1", "-f", "lavfi", "-i", "sine=f=330:d=1",
         "-c:v", "libvpx", "-b:v", "200k", "-c:a", "libopus", "-f", "webm", "-live", "1", str(rec)], capture_output=True)
    if made.returncode != 0:
        pytest.skip("this ffmpeg build can't write a live webm")
    assert media.probe(rec)["duration"] == 0  # how a browser recording arrives
    media.fix_recording(rec)
    assert 0.8 < media.probe(rec)["duration"] < 1.3 and 0.8 < media.audio_seconds(rec) < 1.3
    size = rec.stat().st_size
    media.fix_recording(rec)  # already has a length: left alone
    assert rec.stat().st_size == size and not list(tmp_path.glob("*.fixed*"))


# ---- shape and frame rate: a project follows its footage ----

def test_shape_follows_the_footage():
    from bettercut import shape

    assert shape.nearest(3840, 2160) == "16x9"
    assert shape.nearest(1080, 1920) == "9x16"
    assert shape.nearest(1000, 1000) == "1x1"
    assert shape.nearest(1080, 1350) == "4x5"
    assert shape.nearest(2560, 1080) == "16x9"  # ultrawide: the nearest standard shape
    assert shape.nearest(0, 0) == "9x16"  # unknown size


def test_frame_rate_follows_the_footage():
    from bettercut import shape

    assert [shape.pick_rate(f) for f in (23.976, 24, 25, 29.97, 30, 50, 59.94, 60)] == [24, 24, 25, 30, 30, 50, 60, 60]
    assert shape.pick_rate(0) == 30 and shape.pick_rate(120) == 60


def test_resolve_auto_or_a_chosen_shape():
    import pytest
    from bettercut import shape

    clip = {"width": 3840, "height": 2160, "fps": 23.976}
    assert shape.resolve("auto", "auto", clip) == ("16x9", 1920, 1080, 24)
    assert shape.resolve("9x16", 30, clip) == ("9x16", 1080, 1920, 30)  # a reel from landscape footage
    assert shape.resolve(None, None, {}) == ("9x16", 1080, 1920, 30)
    with pytest.raises(ValueError):
        shape.resolve("21x9", "auto", clip)


def test_renders_default_to_the_projects_own_shape():
    from bettercut import shape

    wide = {"width": 1920, "height": 1080}
    old = {}  # a reel made before shapes existed
    assert shape.native(wide) == "16x9" and shape.native(old) == "9x16"
    assert shape.aspects_for(wide, None) == ["16x9"]
    assert shape.aspects_for(wide, ["native", "9x16", "16x9", "bogus"]) == ["16x9", "9x16"]
    assert shape.aspects_for(old, []) == ["9x16"]
    assert shape.tag(wide, "16x9") == "" and shape.tag(wide, "9x16") == "-9x16"
    assert shape.tag(old, "9x16") == "" and shape.tag(old, "16x9") == "-16x9"


def _fake_make(monkeypatch, probe):
    from bettercut import media

    asked = {}

    def assemble(files, out, stabilize=False, **size):
        asked.update(size)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"x")
        return {}

    def fake_probe(p):
        if str(p).endswith("source.mp4"):  # the assembled footage has the size it was asked for
            return {"duration": 8.0, "width": asked["width"], "height": asked["height"], "fps": asked["fps"]}
        return {"duration": 8.0, **probe}

    monkeypatch.setattr(media, "find_clips", lambda clips, newest=None: ["clip.mp4"])
    monkeypatch.setattr(media, "assemble", assemble)
    monkeypatch.setattr(media, "probe", fake_probe)
    monkeypatch.setattr(media, "transcribe", lambda *a, **k: [])
    monkeypatch.setattr(media, "speech_gaps", lambda p: [(0.0, 8.0)])
    return asked


def test_landscape_footage_makes_a_landscape_project(tmp_path, monkeypatch):
    from bettercut import pipeline

    asked = _fake_make(monkeypatch, {"width": 3840, "height": 2160, "fps": 25.0})
    spec = pipeline.make(tmp_path / "p", ["clip.mp4"], reframe=False, log=lambda m: None)
    assert asked == {"width": 1920, "height": 1080, "fps": 25}
    assert (spec["width"], spec["height"], spec["fps"]) == (1920, 1080, 25)
    assert (spec["source"]["width"], spec["source"]["height"], spec["source"]["fps"]) == (1920, 1080, 25)


def test_a_chosen_shape_overrides_the_footage(tmp_path, monkeypatch):
    from bettercut import pipeline

    asked = _fake_make(monkeypatch, {"width": 3840, "height": 2160, "fps": 59.94})
    spec = pipeline.make(tmp_path / "p", ["clip.mp4"], reframe=False, shape="9x16", fps=30, log=lambda m: None)
    assert asked == {"width": 1080, "height": 1920, "fps": 30}
    assert (spec["width"], spec["height"], spec["fps"]) == (1080, 1920, 30)


def test_vertical_footage_still_makes_a_reel(tmp_path, monkeypatch):
    from bettercut import pipeline

    _fake_make(monkeypatch, {"width": 1080, "height": 1920, "fps": 30.0})
    spec = pipeline.make(tmp_path / "p", ["clip.mp4"], reframe=False, log=lambda m: None)
    assert (spec["width"], spec["height"], spec["fps"]) == (1080, 1920, 30)


def test_silent_footage_gets_one_shot_per_clip():
    from bettercut.pipeline import whole_clip_shots

    clips = [{"name": "a", "start": 0.0, "seconds": 4.0}, {"name": "b", "start": 4.0, "seconds": 6.0}, {"name": "c", "start": 10.0, "seconds": 2.0}]
    shots = whole_clip_shots(clips, 12.04)  # the joined file runs a few frames longer than the clips add up to
    assert [(s["start"], s["end"]) for s in shots] == [(0.0, 4.0), (4.0, 10.0), (10.0, 12.04)]
    assert len({s["id"] for s in shots}) == 3
    # one clip, or no clip list (an old project): a single shot for all of it
    assert whole_clip_shots(clips[:1], 4.0) == [{"id": "s1", "start": 0.0, "end": 4.0}]
    assert whole_clip_shots([], 9.5) == [{"id": "s1", "start": 0.0, "end": 9.5}]


# ---- undo and redo ----

def _editor(tmp_path, monkeypatch):
    """The local server on an empty projects folder holding one saved project."""
    from fastapi.testclient import TestClient
    from bettercut import pipeline, server

    monkeypatch.setattr(server, "PROJECTS", tmp_path)
    proj = tmp_path / "p"
    (proj / "work").mkdir(parents=True)
    pipeline.save(proj, {"version": 1, "source": {"src": "s.mp4"}, "title": "one", "segments": [], "words": []})
    return TestClient(server.app)


def _save(c, title):
    r = c.put("/api/projects/p/spec", json={"version": 1, "source": {"src": "s.mp4"}, "title": title, "segments": [], "words": []})
    assert r.status_code == 200
    return r.json()


def test_undo_then_redo_walks_back_and_forward(tmp_path, monkeypatch):
    c = _editor(tmp_path, monkeypatch)
    title = lambda: c.get("/api/projects/p/spec").json()["spec"]["title"]
    assert c.get("/api/projects/p/spec").json()["canUndo"] is False
    _save(c, "two")
    steps = _save(c, "three")
    assert (steps["canUndo"], steps["canRedo"]) == (True, False)

    r = c.post("/api/projects/p/undo").json()
    assert (r["spec"]["title"], r["canUndo"], r["canRedo"]) == ("two", True, True)
    r = c.post("/api/projects/p/undo").json()
    assert (r["spec"]["title"], r["canUndo"], r["canRedo"]) == ("one", False, True)
    assert c.post("/api/projects/p/undo").status_code == 409

    r = c.post("/api/projects/p/redo").json()
    assert (r["spec"]["title"], r["canUndo"], r["canRedo"]) == ("two", True, True)
    r = c.post("/api/projects/p/redo").json()
    assert (r["spec"]["title"], r["canRedo"]) == ("three", False)
    assert c.post("/api/projects/p/redo").status_code == 409
    assert title() == "three"


def test_a_new_edit_after_undo_ends_redo(tmp_path, monkeypatch):
    c = _editor(tmp_path, monkeypatch)
    _save(c, "two")
    c.post("/api/projects/p/undo")
    steps = _save(c, "another way")
    assert steps["canRedo"] is False
    assert c.post("/api/projects/p/redo").status_code == 409
    assert c.post("/api/projects/p/undo").json()["spec"]["title"] == "one"


def test_saving_the_same_thing_again_is_not_a_step(tmp_path, monkeypatch):
    c = _editor(tmp_path, monkeypatch)
    _save(c, "two")
    c.post("/api/projects/p/undo")
    steps = _save(c, "one")  # the editor re-saving what is already there
    assert (steps["canUndo"], steps["canRedo"]) == (False, True)
    assert c.post("/api/projects/p/redo").json()["spec"]["title"] == "two"


def _talk(rng, seconds, rate=100, bursts=None):
    """A loudness track in dB: quiet room, with loud stretches where someone talks."""
    db = rng.normal(-60, 1.5, int(seconds * rate))
    for a, b in bursts or []:
        n = int((b - a) * rate)
        db[int(a * rate) : int(a * rate) + n] = rng.normal(-20, 4, n)
    return db


def test_angles_line_up_by_their_sound_even_when_one_mic_is_quieter():
    import numpy as np
    from bettercut import multicam

    rng = np.random.default_rng(1)
    bursts = [(1 + i * 1.3, 1.6 + i * 1.3 + (i % 3) * 0.2) for i in range(20)]
    main = _talk(rng, 30, bursts=bursts)
    # the angle started 2.37 s earlier and its mic is 12 dB quieter, with its own noise
    early = int(2.37 * 100)
    angle = np.concatenate([rng.normal(-60, 1.5, early), main - 12 + rng.normal(0, 1.0, len(main))])
    offset, score = multicam.find_offset(main, angle)
    assert abs(offset - 2.37) <= 0.02 and score > multicam.MATCH_OK
    late = angle[400:]  # an angle that started 1.63 s after the main camera
    offset, _ = multicam.find_offset(main, late)
    assert abs(offset - (2.37 - 4.0)) <= 0.02
    unrelated = _talk(np.random.default_rng(9), 30, bursts=[(5, 9), (20, 22)])
    assert multicam.find_offset(main, unrelated)[1] < multicam.MATCH_OK  # nothing in common: a weak match, reported as such


def test_the_cut_follows_whoever_is_talking_without_flickering():
    import numpy as np
    from bettercut import multicam

    rng = np.random.default_rng(2)
    a = _talk(rng, 12, bursts=[(0, 5), (9, 12)])  # person A talks 0-5 s and 9-12 s
    b = _talk(rng, 12, bursts=[(5, 9)])  # person B talks 5-9 s
    cuts = multicam.choose_speakers({"main": a, "cam1": b})
    assert [c["angle"] for c in cuts] == ["main", "cam1", "main"]
    assert abs(cuts[1]["at"] - 5.0) <= 0.5 and abs(cuts[2]["at"] - 9.0) <= 0.5
    hush = _talk(rng, 12, bursts=[(1.2, 5), (9, 12)])  # a second of silence before person A starts
    cuts = multicam.choose_speakers({"main": hush, "cam1": b})
    assert cuts[0] == {"at": 0.0, "angle": "main"}  # not whichever camera happened to be a little louder in the silence
    blip = a.copy()
    blip[300:330] = -60  # A pauses for 0.3 s: not enough to switch away
    assert [c["angle"] for c in multicam.choose_speakers({"main": blip, "cam1": _talk(rng, 12)})] == ["main"]


def test_a_camera_that_was_not_recording_is_never_chosen_for_that_time():
    import numpy as np
    from bettercut import multicam

    main = np.full(500, -30.0)
    angle = np.full(200, -10.0)  # louder, but only recorded the first 2 s
    levels = multicam.aligned_levels(main, angle, 0.0)
    assert np.isnan(levels[300]) and levels[100] == -10.0
    cuts = multicam.choose_speakers({"main": main, "cam1": levels}, min_shot=0.5)
    assert cuts[0]["angle"] in ("main", "cam1") and cuts[-1]["angle"] == "main"  # back to main once cam1 stops
    assert multicam.choose_speakers({}) == []


def _screen(seconds=8.0, fps=8, w=192, h=108):
    """A still 'screen' where a button lights up at 1 s (top left), the same button again at 2 s, a menu
    opens bottom right at 4.5 s, the whole page changes at 6 s, and a small cursor wanders all along."""
    import numpy as np

    n = int(seconds * fps)
    out = np.full((n, h, w), 40, dtype=np.uint8)
    for i in range(n):
        t = i / fps
        f = out[i]
        f[10:20, 10:40] = 90  # a button
        if 1.0 <= t < 1.5 or 2.0 <= t < 2.5:
            f[10:20, 10:40] = 200  # pressed
        if t >= 4.5:
            f[70:100, 140:185] = 220  # a menu
        if t >= 6.0:
            f[:, :] = 160  # a new page
        cx = 60 + int(20 * np.sin(t * 3))
        f[50:53, cx : cx + 2] = 255  # the cursor
    return out, float(fps)


def test_screen_zooms_follow_clicks_and_end_on_a_new_page():
    from bettercut import screenzoom

    stack, fps = _screen()
    evs = screenzoom.events(screenzoom.changes(stack, fps))
    kinds = [e["kind"] for e in evs]
    assert kinds.count("screen") == 1 and kinds[-1] == "screen"  # the cursor alone is never an event
    zooms = screenzoom.plan(evs, len(stack) / fps)
    assert len(zooms) == 2
    first, second = zooms
    # the button: zoomed in just before the first press, held through the second press on the same spot
    assert first["start"] < 1.0 and first["end"] >= 4.0 - 0.01 and first["x"] < 0.25 and first["y"] < 0.25
    # the menu: bottom right, and it ends when the page changes
    assert second["x"] > 0.7 and second["y"] > 0.7 and abs(second["end"] - 6.0) < 0.2
    assert first["end"] <= second["start"]  # zooms never overlap
    assert all(1.4 <= z["zoom"] <= 2.2 for z in zooms)


def test_screen_zooms_from_a_real_video_file(tmp_path):
    import subprocess

    from bettercut import screenzoom

    stack, fps = _screen()
    n, h, w = stack.shape
    path = tmp_path / "screen.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(int(fps)),
                    "-i", "-", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "12", str(path)], input=stack.tobytes(), check=True)
    zooms = screenzoom.find_zooms(path)
    assert len(zooms) == 2 and zooms[0]["x"] < 0.25 and zooms[1]["x"] > 0.7


# ---- review links ----

def test_a_review_link_shows_the_latest_render_and_takes_comments_on_a_spot(tmp_path, monkeypatch):
    import os
    import time

    c = _editor(tmp_path, monkeypatch)
    assert c.get("/api/projects/p/review").json() == {"token": None, "comments": [], "render": None}
    token = c.post("/api/projects/p/review").json()["token"]
    assert token and c.post("/api/projects/p/review").json()["token"] == token  # the same link until stopped
    assert c.get(f"/review/{token}").status_code == 200
    assert c.get(f"/api/review/{token}/video").status_code == 404  # nothing rendered yet

    renders = tmp_path / "p" / "renders"
    renders.mkdir()
    (renders / "p-v1.mp4").write_bytes(b"old")
    (renders / "p-v2.mp4").write_bytes(b"new")
    (renders / "p-v2-phone.mp4").write_bytes(b"phone")
    now = time.time()
    os.utime(renders / "p-v1.mp4", (now - 100, now - 100))
    os.utime(renders / "p-v2-phone.mp4", (now + 100, now + 100))  # the phone copy is never the one reviewed
    d = c.get(f"/api/review/{token}").json()
    assert d["version"] == "p-v2.mp4" and d["comments"] == []
    v = c.get(f"/api/review/{token}/video")
    assert v.content == b"new" and v.headers["cache-control"] == "no-store"

    r = c.post(f"/api/review/{token}/comments", json={"name": "  Sam  ", "text": "logo too small", "at": 3.25, "x": 0.9, "y": 1.7})
    assert r.status_code == 200
    first = r.json()
    assert (first["name"], first["at"], first["x"], first["y"], first["version"], first["done"]) == ("Sam", 3.25, 0.9, 1.0, "p-v2.mp4", False)
    c.post(f"/api/review/{token}/comments", json={"text": "great hook", "at": 0.5})  # whole frame, no name
    assert c.post(f"/api/review/{token}/comments", json={"text": "   ", "at": 1}).status_code == 400
    assert c.post(f"/api/review/{token}/comments", json={"text": "x", "at": -1}).status_code == 400

    got = c.get("/api/projects/p/review").json()["comments"]
    assert [(x["at"], x["name"], x["x"]) for x in got] == [(0.5, "Reviewer", None), (3.25, "Sam", 0.9)]  # in time order
    got = c.post(f"/api/projects/p/review/comments/{first['id']}", json={"done": True}).json()["comments"]
    assert [x["done"] for x in got] == [False, True]
    assert len(c.delete(f"/api/projects/p/review/comments/{first['id']}").json()["comments"]) == 1
    assert c.delete("/api/projects/p/review/comments/nope").status_code == 404

    # reviewers can't resolve or delete: those routes need the project, which the link doesn't give
    assert c.post(f"/api/review/{token}/comments/{got[0]['id']}", json={"done": True}).status_code in (404, 405)

    # stop sharing: the old link stops working, comments stay, sharing again gives a new link
    c.delete("/api/projects/p/review")
    assert c.get(f"/api/review/{token}").status_code == 404 and c.get(f"/review/{token}").status_code == 404
    assert c.post(f"/api/review/{token}/comments", json={"text": "late", "at": 1}).status_code == 404
    again = c.post("/api/projects/p/review").json()
    assert again["token"] != token and len(again["comments"]) == 1
    assert c.get("/api/review/not-a-real-token").status_code == 404


# ---- 4K ----

def test_4k_detail_is_set_by_the_weakest_clip():
    from bettercut import hires

    clips = [{"path": "a"}, {"path": "b"}]
    # a 2160x3840 frame from a 4K vertical clip and a 1080p one
    assert hires.sharpness(clips, 2160, 3840, {"a": (2160, 3840), "b": (2160, 3840)}) == 1.0  # clips exactly the frame's size
    assert hires.sharpness([{"path": "a"}], 1080, 1920, {"a": (2160, 3840)}) == 2.0  # twice the edit's size
    assert hires.sharpness(clips, 1080, 1920, {"a": (2160, 3840), "b": (1080, 1920)}) == 1.0  # the 1080p clip decides
    assert hires.sharpness([{"path": "a"}], 1080, 1920, {"a": (3840, 2160)}) == 1.12  # landscape 4K cropped to vertical


def test_4k_footage_is_rebuilt_from_the_clips_at_twice_the_size(tmp_path):
    import json
    import subprocess

    import pytest

    from bettercut import hires, media

    clips = []
    for i, colour in enumerate(["red", "blue"]):
        c = tmp_path / f"c{i}.mp4"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"color=c={colour}:s=640x360:d=1.5:r=30",
                        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "1.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(c)], check=True)
        clips.append(c)
    proj = tmp_path / "p"
    (proj / "work").mkdir(parents=True)
    (proj / "assets").mkdir()
    info = media.assemble(clips, proj / "assets" / "source.mp4", width=320, height=180, fps=30)
    (proj / "work" / "clips.json").write_text(json.dumps(info))
    spec = {"source": {"src": str(proj / "assets" / "source.mp4"), "width": 320, "height": 180, "fps": 30, "duration": info["duration"]}}

    logs = []
    out = hires.ensure_master(proj, spec, log=logs.append)
    got = media.probe(out)
    assert (got["width"], got["height"]) == (640, 360) and abs(got["duration"] - info["duration"]) < 0.1
    assert not any("scaled up" in l for l in logs)  # 640x360 clips are exactly twice a 320x180 edit: full detail
    assert hires.ensure_master(proj, spec, log=logs.append) == out  # made once
    hi = hires.spec_for_4k(spec, proj, log=logs.append)
    assert hi["source"]["src"] == str(out) and spec["source"]["src"].endswith("source.mp4")  # the edit's own spec is untouched

    clips[1].unlink()
    with pytest.raises(RuntimeError, match="c1.mp4"):
        hires.ensure_master(proj, {**spec, "source": {**spec["source"], "width": 200, "height": 100}})


def test_render_versions_count_every_kind_of_render(tmp_path):
    from bettercut import pipeline

    r = tmp_path / "renders"
    r.mkdir()
    assert pipeline.next_version(tmp_path) == 1
    for name in ["p-v1.mp4", "p-v1-phone.mp4", "p-v2-16x9.mp4", "p-v3-4k.mp4", "p-v4.mov", "p-v1.srt"]:
        (r / name).write_bytes(b"")
    assert pipeline.next_version(tmp_path) == 5
