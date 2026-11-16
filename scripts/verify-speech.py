"""Transcribe the quality WAVs with Whisper and report word error rate.

    QUALITY=1 npx playwright test tests/e2e/quality.spec.ts
    python3 scripts/verify-speech.py
"""
import glob
import json
import os
import re
import sys

import wave

import numpy as np
from faster_whisper import WhisperModel

REFERENCE = (
    "The quiet garden wakes slowly every morning. Bees move between the lavender flowers, "
    "and the old apple tree still produces a heavy crop every second year."
)


def load_16k(path):
    """Reads a 16-bit mono WAV and resamples it to the 16 kHz float array Whisper expects."""
    with wave.open(path, "rb") as handle:
        rate = handle.getframerate()
        pcm = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    positions = np.arange(0, len(pcm), rate / 16000)
    return np.interp(positions, np.arange(len(pcm)), pcm).astype(np.float32)


def words(text):
    return re.sub(r"[^a-z' ]", " ", text.lower()).split()


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1):
        d[i][0] = i
    for j in range(len(h) + 1):
        d[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(r)][len(h)] / len(r)


model = WhisperModel("base.en", device="cpu", compute_type="int8")
results = {}
files = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "test-results", "quality", "*.wav")))
if not files:
    sys.exit("No WAVs found. Run the quality spec first.")
for path in files:
    segments, _ = model.transcribe(load_16k(path), language="en")
    text = " ".join(segment.text.strip() for segment in segments)
    score = wer(REFERENCE, text)
    results[os.path.basename(path)] = {"wer": round(score, 3), "transcript": text}
    print(f"{os.path.basename(path):24} WER {score:.1%}  “{text}”")
print(json.dumps(results, indent=2))
sys.exit(1 if any(item["wer"] > 0.15 for item in results.values()) else 0)
