import io
import json
import os
import threading
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pypinyin import lazy_pinyin

MODEL_DIR = Path(
    os.environ.get(
        "SVS_MODEL_DIR",
        "/models/qixuan/Qixuan_v2.7.0_DiffSinger_OpenUtau",
    )
)
VOCODER_PATH = Path(
    os.environ.get(
        "SVS_VOCODER",
        "/models/vocoder/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.onnx",
    )
)
STEPS = int(os.environ.get("SVS_STEPS", "20"))
DEPTH = float(os.environ.get("SVS_DEPTH", "0.6"))
SAMPLE_RATE = 44100
HOP = 512
FRAME_SEC = HOP / SAMPLE_RATE

app = FastAPI(title="QQBot SVS", version="1.0")
_lock = threading.Lock()

with open(MODEL_DIR / "0101_qixuan_muon1_acoustic.phonemes.json", encoding="utf-8") as f:
    TOKEN_MAP = json.load(f)
with open(MODEL_DIR / "dsdur/dsdict-zh.yaml", encoding="utf-8") as f:
    DICTIONARY = {e["grapheme"]: e["phonemes"] for e in yaml.safe_load(f)["entries"]}

providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
_acoustic = ort.InferenceSession(
    str(MODEL_DIR / "0101_qixuan_muon1_acoustic.qixuan.onnx"),
    providers=providers,
)
_vocoder = ort.InferenceSession(str(VOCODER_PATH), providers=providers)
PROVIDERS = _acoustic.get_providers()


class Note(BaseModel):
    midi: int = Field(60, ge=36, le=96)
    duration: float = Field(0.55, gt=0.1, le=4.0)


class SingRequest(BaseModel):
    lyrics: str = Field(..., min_length=1, max_length=120)
    notes: list[Note] = Field(default_factory=list)
    steps: int = Field(STEPS, ge=4, le=80)
    depth: float = Field(DEPTH, ge=0.0, le=1.0)


def _notes_for(lyrics: str, notes: list[Note]) -> list[Note]:
    chars = [ch for ch in lyrics if "\u4e00" <= ch <= "\u9fff"]
    if not chars:
        raise HTTPException(status_code=400, detail="lyrics 里没有可唱的中文")
    if not notes:
        return [Note(midi=60, duration=0.55)] * len(chars)
    result = []
    for i in range(len(chars)):
        note = notes[min(i, len(notes) - 1)]
        result.append(note)
    return result


def _render(lyrics: str, notes: list[Note], steps: int, depth: float) -> bytes:
    chars = [ch for ch in lyrics if "\u4e00" <= ch <= "\u9fff"]
    notes = _notes_for(lyrics, notes)
    syllables = []
    for char, note in zip(chars, notes):
        pinyin = lazy_pinyin(char)[0]
        phonemes = DICTIONARY.get(pinyin)
        if not phonemes:
            raise HTTPException(status_code=400, detail=f"声库不支持拼音：{pinyin}（{char}）")
        syllables.append((phonemes, note))

    tokens = [TOKEN_MAP["SP"]]
    durations = [8]
    first_freq = 440.0 * 2 ** ((notes[0].midi - 69) / 12)
    f0 = [first_freq] * 8

    for phonemes, note in syllables:
        total = max(len(phonemes), round(note.duration / FRAME_SEC))
        remaining = total
        for i, phoneme in enumerate(phonemes):
            if i < len(phonemes) - 1:
                frames = min(4, remaining - (len(phonemes) - i - 1))
            else:
                frames = remaining
            frames = max(1, frames)
            tokens.append(TOKEN_MAP[phoneme])
            durations.append(frames)
            f0.extend([440.0 * 2 ** ((note.midi - 69) / 12)] * frames)
            remaining -= frames

    tokens.append(TOKEN_MAP["SP"])
    durations.append(8)
    last_freq = 440.0 * 2 ** ((notes[-1].midi - 69) / 12)
    f0.extend([last_freq] * 8)

    token_arr = np.asarray(tokens, dtype=np.int64).reshape(1, -1)
    duration_arr = np.asarray(durations, dtype=np.int64).reshape(1, -1)
    f0_arr = np.asarray(f0, dtype=np.float32).reshape(1, -1)
    frames = f0_arr.shape[1]
    zeros = np.zeros((1, frames), dtype=np.float32)
    inputs = {
        "tokens": token_arr,
        "languages": np.full(token_arr.shape, 3, dtype=np.int64),
        "durations": duration_arr,
        "f0": f0_arr,
        "breathiness": zeros,
        "voicing": zeros,
        "gender": zeros,
        "velocity": np.ones((1, frames), dtype=np.float32),
        "depth": np.asarray(depth, dtype=np.float32),
        "steps": np.asarray(steps, dtype=np.int64),
    }

    with _lock:
        mel = _acoustic.run(["mel"], inputs)[0]
        audio = _vocoder.run(["waveform"], {"mel": mel, "f0": f0_arr})[0]
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    peak = float(np.max(np.abs(audio))) or 1.0
    audio = audio / peak * 0.95
    # 10 ms fade in/out, avoids clicks at the record start/end
    fade = min(441, len(audio) // 2)
    if fade:
        audio[:fade] *= np.linspace(0, 1, fade)
        audio[-fade:] *= np.linspace(1, 0, fade)

    pcm = np.clip(audio * 32767, -32768, 32767).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


@app.get("/health")
def health():
    return {
        "ok": True,
        "voice": "Qixuan",
        "engine": "DiffSinger",
        "providers": PROVIDERS,
        "steps": STEPS,
    }


@app.post("/sing")
def sing(request: SingRequest):
    wav = _render(request.lyrics, request.notes, request.steps, request.depth)
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={"X-Voice": "Qixuan / DiffSinger", "X-AI-Generated": "true"},
    )
