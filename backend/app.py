import json
import logging
import math
import os
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

DEFAULT_MAX_AUDIO_BYTES = 10 * 1024 * 1024
ALLOWED_AUDIO_TYPES = {
    "audio/aac",
    "audio/aiff",
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/flac",
}
RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504]
DEFAULT_FRONTEND_ORIGINS = (
    "http://127.0.0.1:5500",
    "http://localhost:5500",
)
logger = logging.getLogger("speakflow")

app = FastAPI(title="SpeakFlow AI API", version="1.1.0")

def configured_frontend_origins() -> list[str]:
    raw_origins = os.getenv("FRONTEND_ORIGINS", "").strip()
    if not raw_origins:
        return list(DEFAULT_FRONTEND_ORIGINS)
    origins = [origin.strip().rstrip("/") for origin in raw_origins.split(",")]
    return [origin for origin in origins if origin]


app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_frontend_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def configured_audio_limit() -> int:
    raw_limit = os.getenv("MAX_AUDIO_BYTES", str(DEFAULT_MAX_AUDIO_BYTES)).strip()
    try:
        limit = int(raw_limit)
    except ValueError:
        logger.warning("Invalid MAX_AUDIO_BYTES configuration; using the default limit.")
        return DEFAULT_MAX_AUDIO_BYTES
    return limit if limit > 0 else DEFAULT_MAX_AUDIO_BYTES


def parse_json_report(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    report = json.loads(cleaned)
    if not isinstance(report, dict):
        raise ValueError("Gemini returned a report with an invalid shape.")
    return report


def normalize_audio_mime_type(content_type: str | None) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


async def validate_audio(audio: UploadFile) -> str:
    normalized_type = normalize_audio_mime_type(audio.content_type)
    if normalized_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                "Unsupported audio type. Your browser produced "
                f"{audio.content_type or 'an unknown type'}. "
                "Use a browser-supported WebM, Ogg, WAV, MP3, MP4, AAC, AIFF, or FLAC recording."
            ),
        )

    limit = configured_audio_limit()
    total = 0
    while chunk := await audio.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=(
                    "Audio is too large. The maximum size is "
                    f"{math.ceil(limit / (1024 * 1024))} MB."
                ),
            )
    await audio.seek(0)
    logger.info(
        "Validated audio upload: mime_type=%s, size_bytes=%d",
        normalized_type,
        total,
    )
    return normalized_type


def build_prompt(transcript: str, script: str, goal: str, audio_available: bool) -> str:
    audio_note = (
        "Audio is attached. Use it only for evidence-supported observations about "
        "pace, pauses, and possible pronunciation; label those observations as audio-based."
        if audio_available
        else "No audio is attached. Mark pronunciation and vocal-delivery observations as unavailable."
    )
    return f"""
You are a supportive English-speaking coach. Analyze the learner's speech without inventing
errors. If the transcript is already correct, say so. If evidence is insufficient, say so.
{audio_note}

Speaking goal: {goal}
Original script (optional):
{script or "[No original script provided]"}

Recognized transcript (may be empty when audio is provided):
{transcript or "[Transcript unavailable]"}

Return ONLY valid JSON with this exact top-level shape:
{{
  "overall_assessment": "2-3 concise sentences",
  "overall_score": 1,
  "scores": {{
    "grammar": 1, "fluency": 1, "vocabulary": 1,
    "pronunciation": null, "sentence_structure": 1
  }},
  "grammar_mistakes": [
    {{"original": "...", "correction": "...", "explanation": "..."}}
  ],
  "sentence_structure_feedback": ["..."],
  "vocabulary_improvements": [
    {{"original": "...", "suggestion": "...", "reason": "..."}}
  ],
  "fluency_observations": ["..."],
  "pronunciation_observations": ["..."],
  "strengths": ["..."],
  "areas_for_improvement": ["..."],
  "speaking_exercises": ["exactly three practical exercises"],
  "improved_speech": "A short improved version of the learner's speech",
  "script_coverage": "Approximate comparison, or state that no script was supplied."
}}

Scores must be integers from 1 to 10 when evidence supports a score; use null and explain
unavailability when it does not. Keep arrays concise. Do not claim to measure facial
expressions, body language, or vocal confidence.
"""


@app.get("/")
def home():
    return {
        "app": "SpeakFlow AI",
        "status": "running",
        "docs": "/docs",
        "endpoint": "/analyze-speaking",
        "request_format": "multipart/form-data",
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze-speaking")
async def analyze_speaking(
    transcript: str = Form(default="", max_length=30000),
    script: str = Form(default="", max_length=30000),
    goal: str = Form(default="English speaking practice", max_length=300),
    audio: Optional[UploadFile] = File(default=None),
):
    transcript = transcript.strip()
    script = script.strip()
    if not transcript and audio is None:
        raise HTTPException(
            status_code=422,
            detail="Provide a recognized transcript or an audio recording to analyze.",
        )
    if audio is not None:
        audio_mime_type = await validate_audio(audio)

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key or api_key == "paste_your_api_key_here":
        raise HTTPException(
            status_code=503,
            detail="Gemini API is not configured. Add GEMINI_API_KEY to backend/.env and restart the server.",
        )
    if not model_name:
        raise HTTPException(status_code=500, detail="Gemini model configuration is empty.")

    try:
        client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=120_000,
                retry_options=types.HttpRetryOptions(
                    attempts=3,
                    initial_delay=1,
                    max_delay=8,
                    http_status_codes=RETRYABLE_STATUS_CODES,
                ),
            ),
        )
        contents: list[Any] = [
            build_prompt(transcript, script, goal, audio is not None)
        ]
        uploaded_file = None
        if audio is not None:
            uploaded_file = client.files.upload(
                file=audio.file,
                config=types.UploadFileConfig(
                    mime_type=audio_mime_type,
                    display_name="speakflow-audio",
                ),
            )
            contents.append(uploaded_file)

        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        raw_report = (response.text or "").strip()
        if not raw_report:
            raise ValueError("Gemini returned an empty response.")
        report = parse_json_report(raw_report)
        return {
            "report": report,
            "model": model_name,
            "audio_analyzed": audio is not None,
            "analysis_mode": "audio-and-transcript" if audio is not None else "transcript-only",
        }
    except HTTPException:
        raise
    except json.JSONDecodeError:
        logger.error("Gemini returned invalid JSON.")
        raise HTTPException(
            status_code=502,
            detail="Gemini returned an invalid report. Please retry the analysis.",
        ) from None
    except Exception as exc:
        status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
        logger.error("Gemini request failed: %s (status=%s)", type(exc).__name__, status)
        if status in RETRYABLE_STATUS_CODES:
            detail = "Gemini is temporarily busy. Please wait a moment and retry."
            response_status = 503
        elif status in (400, 401, 403):
            detail = "Gemini rejected the request. Check the API key, model name, and API project permissions."
            response_status = 502
        else:
            detail = "Gemini analysis failed. Please retry later or check the backend configuration."
            response_status = 502
        raise HTTPException(status_code=response_status, detail=detail) from exc
