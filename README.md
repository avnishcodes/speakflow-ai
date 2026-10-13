# SpeakFlow AI — Teleprompter & AI Speaking Coach 🎙️

**Practise confidently. Record naturally. Improve with AI.**

SpeakFlow AI is a web application that helps users practise speeches, presentations, and communication skills using a teleprompter, webcam recording, speech transcription, and AI-powered feedback.

## 🌐 Live Demo

- **Live Application:** https://speakflow-ai.netlify.app/
- **Backend API:** https://speakflow-ai-backend.onrender.com
- **API Documentation:** https://speakflow-ai-backend.onrender.com/docs

> Note: The backend is hosted on Render. On the free tier, it may take some time to respond after a period of inactivity.

## ✨ Features

### 📝 Teleprompter
- Write and edit your speaking script.
- Estimate script word count.
- Choose between split-screen and script-overlay layouts.
- Position the script panel on the left or right.
- Adjust font size and scrolling speed.

### 🎥 Recording Studio
- Access your webcam and microphone.
- Select available camera and microphone devices.
- Preview your camera before recording.
- Start recording with a countdown.
- Pause, resume, and stop recordings.
- Play back and download recordings in `.webm` format.

### 🎤 Speech Transcription
- Capture spoken words using browser speech recognition when supported.
- Review, edit, or paste your transcript manually.
- Practise speaking using your own script or topic.

### 🤖 AI Speaking Coach
- Generate feedback using Google's Gemini API.
- Review grammar and sentence structure.
- Get feedback on fluency and vocabulary.
- Receive pronunciation-related feedback based on the available transcript or audio input.
- Use suggestions to improve your next practice session.

### 🔒 Privacy Considerations
- Video recordings are processed and stored locally in the browser unless you choose to download them.
- When you request AI analysis, the configured backend may send the transcript and optional audio input to Google's Gemini API.
- Avoid submitting confidential or sensitive information during practice.

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Python, FastAPI |
| AI Integration | Google Gemini API |
| API Server | Uvicorn |
| Frontend Deployment | Netlify |
| Backend Deployment | Render |
| Browser APIs | MediaRecorder, Speech Recognition |

## 🏗️ Project Structure

```text
speakflow_ai/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   ├── .env.example
│   └── .env
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── style.css
├── tests/
├── .gitignore
└── README.md
```

The `.env` file contains local secrets and must not be committed to GitHub.

## ⚙️ Run the Project Locally

### Prerequisites

- Python 3.10 or a compatible version supported by your dependencies.
- Google Gemini API key.
- A recent version of Google Chrome or another supported browser.
- Git.

### 1. Clone the repository

```bash
git clone https://github.com/avnishcodes/speakflow-ai.git
cd speakflow-ai
```

### 2. Create and activate a virtual environment

On Windows:

```bash
python -m venv .venv
.venv\Scripts\activate
```

### 3. Install backend dependencies

```bash
pip install -r backend/requirements.txt
```

### 4. Configure environment variables

Create `backend/.env` using `backend/.env.example` as a reference.

Configure the variables expected by your backend, including:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=your_supported_gemini_model
```

Use the model name configured and supported by your deployed application. Do not publish your actual API key.

### 5. Start the backend

```bash
cd backend
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Backend API:

http://127.0.0.1:8000

Interactive API documentation:

http://127.0.0.1:8000/docs

### 6. Run the frontend

Open a second terminal from the project root and start a local development server for the `frontend` directory.

For example, if you use the VS Code Live Server extension, open `frontend/index.html` and select **Open with Live Server**.

The frontend's local API configuration should point to the backend running on port `8000`. If you change the frontend or backend ports, update the corresponding API configuration.

## 🔌 API Endpoints

The backend provides the following endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Basic backend response |
| GET | `/health` | Health check |
| POST | `/analyze-speaking` | Request AI speaking feedback |

For request schemas and response details, open the interactive API documentation:

https://speakflow-ai-backend.onrender.com/docs

## 🧪 Testing

The project includes a `tests/` directory for automated tests.

Run the tests from the project root after installing the required dependencies:

```bash
python -m pytest
```

You can also verify that the deployed backend responds by opening:

https://speakflow-ai-backend.onrender.com/health

## 🩺 Troubleshooting

### AI analysis fails
- Confirm that the backend is running and reachable.
- Verify the Gemini API key and configured model.
- Check the Render service logs for API errors.
- Confirm that the deployed frontend origin is included in the backend's CORS configuration.
- Check API quota, model availability, and network errors.

### Speech recognition is unavailable
- Use an up-to-date browser that supports the Web Speech API.
- Allow microphone access.
- Check your browser's microphone permissions.
- You can manually paste or edit the transcript and still use AI feedback.

### Camera or microphone does not work
- Allow camera and microphone permissions in the browser.
- Close other applications that may be using the camera.
- Use HTTPS for the deployed application or localhost during local development.

### Backend responds slowly
- The Render free-tier service may sleep after inactivity.
- Allow time for the backend to start before retrying analysis.

## 🔐 Security

- Never commit `.env` files, API keys, passwords, or other secrets.
- Keep the Gemini API key on the backend; do not expose it in frontend JavaScript.
- Configure CORS to allow only the frontend origins you trust.
- Do not upload confidential recordings or transcripts to third-party services without understanding their data-handling policies.

## 🚀 Future Improvements

Potential enhancements include:

- Speaking pace and filler-word analysis.
- Improved transcript accuracy and editing.
- Practice history and progress tracking.
- More detailed coaching suggestions.
- Additional export options and accessibility improvements.

These are potential future enhancements and may not be implemented in the current version.

## 👨‍💻 Author

**Avnish Singh**

- GitHub: https://github.com/avnishcodes
- Project Repository: https://github.com/avnishcodes/speakflow-ai

---

*SpeakFlow AI — Your practice space for clearer, more confident speaking.*
