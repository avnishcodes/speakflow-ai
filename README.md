# SpeakFlow AI — Teleprompter & Speaking Coach

A beginner-friendly local web app with a split-screen or script-overlay teleprompter, webcam recording, pause/resume, local video download, speech transcription, and Gemini-powered transcript feedback.

## Features in this MVP

- Editable script and word-count estimate
- Split-screen and script-overlay layouts
- Choose whether the script panel is left or right in split-screen mode
- Font-size and scrolling-speed settings
- Camera and microphone selectors
- Webcam preview, countdown, record, pause/resume, stop, playback and `.webm` download
- Chrome speech recognition for transcript capture
- FastAPI endpoint that asks Gemini for structured feedback on grammar, fluency, vocabulary, pronunciation and sentence structure
- Recordings stay in the browser; only the transcript and optional audio-only recording are sent when you choose analysis
- The frontend uses same-origin API requests by default in a hosted deployment; local port 5500 automatically targets the backend on port 8000. Set `window.SPEAKFLOW_API_BASE` before `script.js` when the frontend and backend use different production hosts.

## Requirements

- Windows 10/11
- Python 3.10+ (Python 3.11 or 3.12 recommended)
- Google Chrome
- Gemini API key

## 1. Set up the backend (PowerShell)

Open PowerShell in the `speakflow_ai` project folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
```

Open `backend\.env` and replace `paste_your_api_key_here` with your Gemini API key. Keep this file private; do not commit it to a public repository.

For a hosted deployment, also set `FRONTEND_ORIGINS` to the exact comma-separated HTTPS origin(s) serving the frontend. Do not include `null` or wildcard origins.

Run the API:

```powershell
uvicorn backend.app:app --reload
```

Test in your browser:
- http://127.0.0.1:8000/
- http://127.0.0.1:8000/docs

The analysis endpoint accepts `multipart/form-data` with `transcript`, optional `script`,
optional `goal`, and an optional audio-only file. Supported audio MIME types include WebM,
Ogg, WAV, MP3, MP4 and AAC. Uploads are limited by `MAX_AUDIO_BYTES` (10 MB by default);
the separate video recording is never uploaded for analysis.

## 2. Run the frontend

Keep the backend terminal running.

In VS Code, install the **Live Server** extension if you do not already have it. Open `frontend/index.html`, right-click it, and select **Open with Live Server**. It commonly opens at `http://127.0.0.1:5500`.

You can also use a second PowerShell terminal from the project root:

```powershell
py -m http.server 5500 --directory frontend
```

Then open http://127.0.0.1:5500.

Use `localhost` or `127.0.0.1` for camera permission. Do not open the HTML as a `file://` URL.

## 3. Use the app

1. Click **Settings** to choose camera/microphone, layout position, text size and scroll speed.
2. Paste your script.
3. Click **Enable camera** and allow camera/microphone permissions.
4. Choose **Split screen** or **Script overlay**. In split screen, use Settings → Script position to move the script left/right.
5. Click **Start recording**. A short countdown runs before recording.
6. Pause/resume or stop the recording. Preview it and click **Download video** to save a `.webm` file.
7. Review the transcript in the AI coach section. Correct speech-recognition mistakes if needed, then click **Analyze speech**. This is when the optional audio-only recording is sent to the configured Gemini API.

## Notes and limitations

- The app is a local MVP, not yet a production-hosted service.
- Camera/microphone access requires browser permission and a secure context such as `localhost` or HTTPS.
- `MediaRecorder` support and output codecs vary by browser; Chrome generally supports WebM.
- Web Speech API availability and language accuracy vary. This MVP uses `en-IN`; change `recognition.lang` in `frontend/script.js` if needed (for example, `en-US`).
- Browser speech recognition may use a browser/vendor speech service. Check your browser's privacy settings before using sensitive content.
- Gemini receives the transcript, script and optional audio-only recording only after you click **Analyze speech**.
- Transcript-only analysis marks pronunciation and vocal-delivery observations as unavailable. Audio analysis can provide evidence-supported observations about pace, pauses and possible pronunciation, but cannot measure facial expressions, body language or vocal confidence.
- Do not expose your Gemini API key in frontend JavaScript or a public repository.
- Before public deployment, add authentication, request limits, stronger CORS settings, privacy disclosures and secure hosting.

## Troubleshooting

**Camera button does not work**
- Use `http://127.0.0.1:5500` or `http://localhost:5500`, not a `file://` URL.
- Check the camera icon in Chrome's address bar and Windows privacy settings.
- Close other apps using the camera.

**AI analysis fails**
- Confirm the backend is running at `http://127.0.0.1:8000`.
- Confirm `backend/.env` contains a valid API key and model name.
- Restart Uvicorn after editing `.env`.
- Visit `http://127.0.0.1:8000/docs` to verify the API is running.
- Temporary Gemini 429/5xx responses use one bounded SDK retry policy and then return a safe retry message. Invalid keys and permission errors are not retried.

**Speech recognition is unavailable**
- Use a current version of Google Chrome and allow microphone access.
- You can still paste the transcript manually and use AI feedback.
