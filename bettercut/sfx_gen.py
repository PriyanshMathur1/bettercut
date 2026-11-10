"""Synthesise BetterCut's sound-effect library with ffmpeg (original sounds, no licensing).

Usage: python -m bettercut.sfx_gen [out_dir]
Default out_dir: composer/public/reel-sfx
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "composer" / "public" / "reel-sfx"

# name -> (lavfi source, extra audio filter or "")
SOUNDS: dict[str, tuple[str, str]] = {
    "whoosh": ("anoisesrc=d=0.45:c=pink:a=0.9", "highpass=f=300,lowpass=f=4000,afade=t=in:d=0.2:curve=exp,afade=t=out:st=0.2:d=0.25,volume=0.8"),
    "swish": ("anoisesrc=d=0.35:c=white:a=0.7", "bandpass=f=2500:w=1800,afade=t=in:d=0.15,afade=t=out:st=0.15:d=0.2,volume=0.7"),
    "pop": ("aevalsrc='0.8*sin(2*PI*(300+3000*t)*t)*exp(-30*t)':d=0.15", ""),
    "click": ("aevalsrc='0.9*sin(2*PI*2000*t)*exp(-120*t)+0.3*(random(0)-0.5)*exp(-200*t)':d=0.06", ""),
    "ding": ("aevalsrc='0.5*sin(2*PI*1318*t)*exp(-4*t)+0.35*sin(2*PI*1975*t)*exp(-5*t)':d=0.9", ""),
    "hit": ("aevalsrc='0.95*sin(2*PI*(55+80*exp(-20*t))*t)*exp(-6*t)+0.4*(random(0)-0.5)*exp(-40*t)':d=0.7", ""),
    "riser": ("aevalsrc='0.4*sin(2*PI*(200+900*t*t)*t)*min(1\\,t)':d=1.4", "afade=t=out:st=1.25:d=0.15"),
    "swoosh_up": ("aevalsrc='0.6*sin(2*PI*(400+1600*t)*t)*exp(-3*t)':d=0.35", "afade=t=out:st=0.25:d=0.1"),
    "glitch": ("aevalsrc='0.5*(random(0)-0.5)*gt(mod(t*40\\,1)\\,0.5)+0.4*sin(2*PI*120*t)*gt(mod(t*25\\,1)\\,0.6)':d=0.35", ""),
    "shutter": ("aevalsrc='0.7*(random(0)-0.5)*(exp(-90*t)+exp(-90*max(0\\,t-0.09))*gte(t\\,0.09))':d=0.25", ""),
    "typing": ("aevalsrc='0.6*(random(0)-0.5)*exp(-160*mod(t\\,0.11))':d=0.6", "highpass=f=1500,volume=0.8"),
    "notify": ("aevalsrc='0.45*sin(2*PI*988*t)*exp(-10*t)+0.45*sin(2*PI*1319*max(0\\,t-0.12))*exp(-10*max(0\\,t-0.12))*gte(t\\,0.12)':d=0.6", ""),
    "bass_drop": ("aevalsrc='0.9*sin(2*PI*(40+40*exp(-8*t))*t)*exp(-2.5*t)':d=1.2", ""),
}


def generate(out_dir: Path = DEFAULT_OUT) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    made = []
    for name, (src, af) in SOUNDS.items():
        out = out_dir / f"{name}.wav"
        cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", src]
        if af:
            cmd += ["-af", af]
        cmd += ["-ar", "44100", "-ac", "1", str(out)]
        subprocess.run(cmd, check=True)
        made.append(out)
    return made


if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    for p in generate(out):
        print(p.name)
