const LOCAL_API_ORIGINS = new Set(["localhost", "127.0.0.1", "::1"]);
const API_BASE = window.SPEAKFLOW_API_BASE
  || (LOCAL_API_ORIGINS.has(window.location.hostname) && window.location.port === "5500"
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : "");

const $ = (id) => document.getElementById(id);
const els = {
  status: $("statusPill"), workspace: $("workspace"), scriptPanel: $("scriptPanel"),
  recordingView: $("recordingView"), coachView: $("coachView"), recordingHero: $("recordingHero"),
  cameraPanel: $("cameraPanel"), scriptInput: $("scriptInput"), wordCount: $("wordCount"),
  readingPreview: $("readingPreview"), cameraVideo: $("cameraVideo"),
  cameraStage: $("cameraStage"), cameraPlaceholder: $("cameraPlaceholder"),
  enableCamera: $("enableCamera"), recordButton: $("recordButton"),
  pauseButton: $("pauseButton"), stopButton: $("stopButton"), downloadButton: $("downloadButton"),
  recordingBadge: $("recordingBadge"), timer: $("timer"), playbackWrap: $("playbackWrap"),
  playbackVideo: $("playbackVideo"), transcript: $("transcriptInput"), speechStatus: $("speechStatus"),
  analyzeButton: $("analyzeButton"), analysisResult: $("analysisResult"), overlayScript: $("overlayScript"),
  countdown: $("countdown"), recordingNote: $("recordingNote"),
  coachNavButton: $("coachNavButton"), getFeedbackButton: $("getFeedbackButton"),
  backToRecordingButton: $("backToRecordingButton")
};

let stream = null;
let recorder = null;
let audioRecorder = null;
let chunks = [];
let audioChunks = [];
let recordedBlob = null;
let recordedAudioBlob = null;
let recordedAudioMimeType = "";
let recordingState = "idle"; // idle | starting | recording | paused | stopped
let timerStartedAt = 0;
let elapsedBeforePause = 0;
let timerInterval = null;
let scrollFrame = null;
let scrollPosition = 0;
let scrollProgress = 0;
let lastScrollTimestamp = 0;
let speechRecognition = null;
let speechSupported = false;
let finalTranscript = "";
let currentObjectUrl = null;
let analysisInFlight = false;

function setStatus(message) { els.status.textContent = message; }
function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function elapsedMs() {
  return elapsedBeforePause + (recordingState === "recording" ? Date.now() - timerStartedAt : 0);
}
function updateTimer() { els.timer.textContent = formatTime(elapsedMs()); }

function updateOverlayVisibility() {
  const showOverlay = Boolean(stream) && recordingState !== "stopped";
  els.cameraStage.classList.toggle("recording", showOverlay);
  els.overlayScript.classList.toggle("hidden", !showOverlay);
}

function showPage(page) {
  const coach = page === "coach";
  els.recordingView.classList.toggle("hidden", coach);
  els.recordingHero.classList.toggle("hidden", coach);
  els.coachView.classList.toggle("hidden", !coach);
  $("settingsPanel").classList.add("hidden");
  els.coachNavButton.textContent = coach ? "Recording studio" : "AI Coach";
  if (!coach) $("settingsPanel").classList.remove("hidden");
  if (coach) {
    els.transcript.focus();
  }
}

const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/wav"
];
const SUPPORTED_ANALYSIS_AUDIO_TYPES = new Set([
  "audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav",
  "audio/mpeg", "audio/aac", "audio/aiff", "audio/flac"
]);
function normalizeAudioMimeType(type) {
  return (type || "").split(";", 1)[0].trim().toLowerCase();
}
function audioExtension(type) {
  return {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3",
    "audio/aac": "aac", "audio/aiff": "aiff", "audio/flac": "flac"
  }[normalizeAudioMimeType(type)] || "audio";
}
function supportedAudioMimeType() {
  if (!window.MediaRecorder) return "";
  return AUDIO_MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function updateScript() {
  const previousMax = Math.max(0, els.readingPreview.scrollHeight - els.readingPreview.clientHeight);
  if (previousMax > 0) scrollProgress = els.readingPreview.scrollTop / previousMax;
  const text = els.scriptInput.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  els.wordCount.textContent = `${words} words · ~${Math.ceil(words / 130)} min`;
  els.readingPreview.textContent = text || "Your script preview will appear here.";
  els.overlayScript.textContent = text || "Your script will appear here.";
  els.readingPreview.style.fontSize = `${$("fontSize").value}px`;
  els.overlayScript.style.fontSize = `${Math.max(16, Number($("fontSize").value) - 2)}px`;
  els.overlayScript.classList.toggle("mirror-text", $("mirrorScript").checked);
  els.overlayScript.classList.toggle("flip-text", $("flipScript").checked);
  syncScrollContainers();
  updateScriptPosition();
}
function updateScriptPosition() {
  const right = $("scriptPosition").value === "right";
  els.workspace.classList.toggle("script-right", right);
  if (right && els.workspace.firstElementChild === els.scriptPanel && els.workspace.children.length > 1) {
    els.workspace.insertBefore(els.cameraPanel, els.scriptPanel);
  } else if (!right && els.workspace.firstElementChild === els.cameraPanel && els.workspace.children.length > 1) {
    els.workspace.insertBefore(els.scriptPanel, els.cameraPanel);
  }
}
function setLayout(mode) {
  const overlay = mode === "overlay";
  els.workspace.classList.toggle("overlay-mode", overlay);
  $("splitMode").classList.toggle("active", !overlay);
  $("overlayMode").classList.toggle("active", overlay);
  updateOverlayVisibility();
  updateScriptPosition();
}
function updateWpmLabel() {
  $("wpmOutput").textContent = `${Number($("wpm").value)} WPM`;
}
function pixelsPerSecondForWpm() {
  const words = els.scriptInput.value.trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  const renderedHeight = Math.max(els.readingPreview.scrollHeight, els.readingPreview.clientHeight);
  const pixelsPerWord = renderedHeight / words;
  return Math.max(1, pixelsPerWord * Number($("wpm").value) / 60);
}
function syncScrollContainers() {
  const readingMax = Math.max(0, els.readingPreview.scrollHeight - els.readingPreview.clientHeight);
  const overlayMax = Math.max(0, els.overlayScript.scrollHeight - els.overlayScript.clientHeight);
  scrollProgress = Math.max(0, Math.min(1, scrollProgress));
  scrollPosition = readingMax * scrollProgress;
  els.readingPreview.scrollTop = scrollPosition;
  els.overlayScript.scrollTop = scrollProgress * overlayMax;
}
function startScrolling() {
  stopScrolling();
  if (!els.scriptInput.value.trim()) return;
  lastScrollTimestamp = performance.now();
  const tick = (timestamp) => {
    const elapsed = Math.min(100, Math.max(0, timestamp - lastScrollTimestamp));
    lastScrollTimestamp = timestamp;
    scrollPosition += pixelsPerSecondForWpm() * elapsed / 1000;
    const readingMax = Math.max(0, els.readingPreview.scrollHeight - els.readingPreview.clientHeight);
    scrollPosition = Math.min(scrollPosition, readingMax);
    scrollProgress = readingMax ? scrollPosition / readingMax : 0;
    syncScrollContainers();
    if (scrollPosition >= readingMax && readingMax > 0) {
      stopScrolling();
      return;
    }
    scrollFrame = requestAnimationFrame(tick);
  };
  scrollFrame = requestAnimationFrame(tick);
  $("scrollToggle").textContent = "Stop scrolling";
}
function stopScrolling() {
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
  scrollFrame = null;
  lastScrollTimestamp = 0;
  $("scrollToggle").textContent = "Start scrolling";
}
function resetScroll() {
  stopScrolling();
  scrollPosition = 0;
  scrollProgress = 0;
  syncScrollContainers();
}
function getSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    speechSupported = false;
    els.speechStatus.textContent = "Speech recognition unavailable in this browser";
    return null;
  }
  speechSupported = true;
  const recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-IN";
  recognition.onstart = () => { els.speechStatus.textContent = "Listening… speak naturally"; };
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const phrase = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += phrase.trim() + " ";
      else interim += phrase;
    }
    els.transcript.value = (finalTranscript + interim).trim();
  };
  recognition.onerror = (event) => {
    els.speechStatus.textContent = `Speech recognition: ${event.error}`;
  };
  recognition.onend = () => {
    if (recordingState === "recording") {
      try { recognition.start(); } catch (_) {}
    } else {
      els.speechStatus.textContent = "Transcription stopped";
    }
  };
  return recognition;
}
async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");
    const mics = devices.filter(d => d.kind === "audioinput");
    populateSelect($("cameraSelect"), cams, "Default camera");
    populateSelect($("micSelect"), mics, "Default microphone");
  } catch (_) {}
}
function populateSelect(select, devices, defaultLabel) {
  const previous = select.value;
  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = defaultLabel;
  select.appendChild(defaultOption);
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${device.kind === "videoinput" ? "Camera" : "Microphone"} ${index + 1}`;
    select.appendChild(option);
  });
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}
async function enableCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Camera access is unavailable. Open this app on localhost or use a supported browser.");
    return;
  }
  const previousStream = stream;
  let nextStream = null;
  try {
    const videoId = $("cameraSelect").value;
    const audioId = $("micSelect").value;
    nextStream = await navigator.mediaDevices.getUserMedia({
      video: videoId ? { deviceId: { exact: videoId } } : true,
      audio: audioId ? { deviceId: { exact: audioId } } : true
    });
    els.cameraVideo.srcObject = nextStream;
    await els.cameraVideo.play();
    stream = nextStream;
    if (previousStream && previousStream !== stream) {
      previousStream.getTracks().forEach(track => track.stop());
    }
    els.cameraStage.classList.add("has-camera");
    els.cameraStage.classList.toggle("mirror", $("mirrorCamera").checked);
    els.recordButton.disabled = false;
    els.enableCamera.textContent = "Camera enabled";
    setStatus("Camera ready");
    recordingState = "idle";
    updateOverlayVisibility();
    setRecordingControls();
    await refreshDevices();
  } catch (error) {
    console.error(error);
    if (nextStream && nextStream !== previousStream) {
      nextStream.getTracks().forEach(track => track.stop());
    }
    const reason = error?.name === "NotAllowedError"
      ? "Camera permission was blocked. Allow camera and microphone access, then try again."
      : error?.name === "NotFoundError"
        ? "No camera or microphone was found. Connect one and try again."
        : "Camera setup failed. Check permissions and make sure another app is not using the camera.";
    els.recordingNote.textContent = reason;
    setStatus("Camera unavailable");
    stream = previousStream;
    if (stream) {
      els.cameraVideo.srcObject = stream;
      els.cameraStage.classList.add("has-camera");
    } else {
      els.cameraStage.classList.remove("has-camera", "recording");
      els.cameraVideo.srcObject = null;
    }
    updateOverlayVisibility();
    setRecordingControls();
  }
}
function setRecordingControls() {
  const active = recordingState === "recording";
  const paused = recordingState === "paused";
  els.recordButton.disabled = !stream || active || paused;
  els.recordButton.innerHTML = recordingState === "stopped" ? '<span class="record-dot"></span> Record again' : '<span class="record-dot"></span> Start recording';
  els.pauseButton.disabled = !active && !paused;
  els.pauseButton.textContent = paused ? "Resume" : "Pause";
  els.stopButton.disabled = !active && !paused;
  els.downloadButton.disabled = !recordedBlob;
  els.recordingBadge.classList.toggle("live", active);
  els.recordingBadge.innerHTML = `<span></span> ${active ? "Recording" : paused ? "Paused" : recordingState === "stopped" ? "Recording saved" : "Not recording"}`;
}
async function startRecording() {
  if (!stream || recordingState === "starting" || recordingState === "recording" || recordingState === "paused") return;
  recordingState = "starting";
  setRecordingControls();
  try {
    const countdownEnabled = true;
    if (countdownEnabled) {
      els.countdown.classList.remove("hidden");
      for (let n = 3; n > 0; n--) {
        els.countdown.textContent = n;
        await new Promise(resolve => setTimeout(resolve, 650));
      }
      els.countdown.classList.add("hidden");
    }
    chunks = [];
    audioChunks = [];
    recordedBlob = null;
    recordedAudioBlob = null;
    recordedAudioMimeType = "";
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const type = recorder.mimeType || "video/webm";
      recordedBlob = new Blob(chunks, { type });
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = URL.createObjectURL(recordedBlob);
      els.playbackVideo.src = currentObjectUrl;
      els.playbackWrap.classList.remove("hidden");
      els.downloadButton.disabled = false;
      els.recordingNote.textContent = "Recording ready. Download it to save a copy.";
      setStatus("Recording ready");
      setRecordingControls();
    };
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length && window.MediaRecorder) {
      const audioMimeType = supportedAudioMimeType();
      audioRecorder = new MediaRecorder(
        new MediaStream(audioTracks),
        audioMimeType ? { mimeType: audioMimeType } : undefined
      );
      audioRecorder.ondataavailable = event => {
        if (event.data?.size) {
          if (!recordedAudioMimeType && event.data.type) recordedAudioMimeType = event.data.type;
          audioChunks.push(event.data);
        }
      };
      audioRecorder.onstop = () => {
        recordedAudioMimeType = audioRecorder.mimeType || recordedAudioMimeType;
        recordedAudioBlob = new Blob(audioChunks, { type: recordedAudioMimeType });
        console.info("SpeakFlow audio recording:", {
          mimeType: recordedAudioMimeType || "unknown",
          sizeBytes: recordedAudioBlob.size
        });
      };
      audioRecorder.start(1000);
    }
    recorder.start(1000);
    recordingState = "recording";
    timerStartedAt = Date.now();
    elapsedBeforePause = 0;
    timerInterval = setInterval(updateTimer, 250);
    finalTranscript = els.transcript.value.trim();
    speechRecognition = getSpeechRecognition();
    if (speechRecognition) {
      try { speechRecognition.start(); } catch (_) {}
    }
    if ($("autoScroll").checked) startScrolling();
    updateOverlayVisibility();
    setStatus("Recording in progress");
    els.recordingNote.textContent = "Keep this tab open while recording.";
    setRecordingControls();
  } catch (error) {
    console.error(error);
    recordingState = "idle";
    els.countdown.classList.add("hidden");
    if (recorder && recorder.state !== "inactive") recorder.stop();
    if (audioRecorder && audioRecorder.state !== "inactive") audioRecorder.stop();
    setRecordingControls();
    setStatus("Recording unavailable");
    alert("Unable to start recording in this browser.");
  }
}
function pauseRecording() {
  if (recordingState === "recording" && recorder?.state === "recording") {
    recorder.pause();
    if (audioRecorder?.state === "recording") audioRecorder.pause();
    elapsedBeforePause += Date.now() - timerStartedAt;
    recordingState = "paused";
    if (speechRecognition) { try { speechRecognition.stop(); } catch (_) {} }
    stopScrolling();
    setStatus("Recording paused");
  } else if (recordingState === "paused" && recorder?.state === "paused") {
    recorder.resume();
    if (audioRecorder?.state === "paused") audioRecorder.resume();
    timerStartedAt = Date.now();
    recordingState = "recording";
    if (speechRecognition) { try { speechRecognition.start(); } catch (_) {} }
    if ($("autoScroll").checked) startScrolling();
    setStatus("Recording in progress");
  }
  setRecordingControls();
  updateOverlayVisibility();
  updateTimer();
}
function stopRecording() {
  if (recorder && (recorder.state === "recording" || recorder.state === "paused")) recorder.stop();
  if (audioRecorder && (audioRecorder.state === "recording" || audioRecorder.state === "paused")) audioRecorder.stop();
  recordingState = "stopped";
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  stopScrolling();
  if (speechRecognition) { try { speechRecognition.onend = null; speechRecognition.stop(); } catch (_) {} }
  updateOverlayVisibility();
  updateTimer();
  setRecordingControls();
  els.recordingNote.textContent = "Finishing recording…";
}
function downloadVideo() {
  if (!recordedBlob) return;
  const url = URL.createObjectURL(recordedBlob);
  const a = document.createElement("a");
  a.href = url;
  const extension = recordedBlob.type.includes("mp4") ? "mp4"
    : recordedBlob.type.includes("ogg") ? "ogv"
      : recordedBlob.type.includes("quicktime") ? "mov" : "webm";
  a.download = `speakflow-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function analyzeSpeech() {
  if (analysisInFlight) return;
  const transcript = els.transcript.value.trim();
  if (transcript.length < 1 && !recordedAudioBlob) {
    showAnalysisError("Add a transcript or finish a recording with audio before analyzing.");
    return;
  }
  analysisInFlight = true;
  els.analyzeButton.disabled = true;
  els.analyzeButton.textContent = "Analyzing…";
  setStatus(recordedAudioBlob
    ? "Sending transcript and audio to the AI coach…"
    : "Sending transcript to the AI coach…");
  try {
    const formData = new FormData();
    formData.append("transcript", transcript);
    formData.append("script", els.scriptInput.value.trim());
    formData.append("goal", "English communication practice for a social media video");
    if (recordedAudioBlob?.size) {
      const normalizedType = normalizeAudioMimeType(recordedAudioMimeType || recordedAudioBlob.type);
      if (!SUPPORTED_ANALYSIS_AUDIO_TYPES.has(normalizedType)) {
        showAnalysisError(
          `Your browser recorded audio as ${recordedAudioMimeType || "an unknown format"}, which this analysis service cannot accept. You can still use transcript-only analysis, or try Chrome/Edge for WebM audio.`
        );
        return;
      }
      console.info("Uploading SpeakFlow audio:", {
        mimeType: normalizedType,
        sizeBytes: recordedAudioBlob.size
      });
      formData.append(
        "audio",
        recordedAudioBlob,
        `speakflow-audio.${audioExtension(recordedAudioMimeType || recordedAudioBlob.type)}`
      );
    }
    const response = await fetch(`${API_BASE}/analyze-speaking`, {
      method: "POST",
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Analysis request failed.");
    renderReport(data.report, data.model, data.audio_analyzed);
    setStatus("Analysis ready");
  } catch (error) {
    showAnalysisError(`${error.message} You can retry when the backend is available.`);
  } finally {
    analysisInFlight = false;
    els.analyzeButton.disabled = false;
    els.analyzeButton.textContent = "Analyze speech";
  }
}
function showAnalysisError(message) {
  const previousError = els.analysisResult.querySelector(".analysis-error");
  if (previousError) previousError.remove();
  const error = document.createElement("p");
  error.className = "analysis-error";
  error.textContent = message;
  if (els.analysisResult.childElementCount) {
    els.analysisResult.prepend(error);
  } else {
    els.analysisResult.appendChild(error);
  }
  setStatus("Analysis needs attention");
}
function appendTextList(parent, title, values) {
  if (!Array.isArray(values) || !values.length) return;
  const heading = document.createElement("h4");
  heading.textContent = title;
  parent.appendChild(heading);
  const list = document.createElement("ul");
  values.forEach(value => {
    const item = document.createElement("li");
    item.textContent = typeof value === "string" ? value : JSON.stringify(value);
    list.appendChild(item);
  });
  parent.appendChild(list);
}
function renderReport(report, model, audioAnalyzed) {
  if (!report || typeof report !== "object") {
    showAnalysisError("The AI returned an invalid report. Please retry the analysis.");
    return;
  }
  els.analysisResult.replaceChildren();
  const modelLine = document.createElement("p");
  modelLine.className = "hint";
  modelLine.textContent = `Generated with ${model || "Gemini"} · ${audioAnalyzed ? "audio and transcript evidence" : "transcript-only evidence"}`;
  els.analysisResult.appendChild(modelLine);
  const overall = document.createElement("p");
  overall.textContent = report.overall_assessment || "No overall assessment was returned.";
  els.analysisResult.appendChild(overall);
  const scores = document.createElement("div");
  scores.className = "score-grid";
  Object.entries({ Overall: report.overall_score, ...(report.scores || {}) }).forEach(([name, score]) => {
    const card = document.createElement("div");
    card.className = "score-card";
    const label = document.createElement("span");
    label.textContent = name.replaceAll("_", " ");
    const value = document.createElement("strong");
    value.textContent = score == null ? "N/A" : `${score}/10`;
    card.append(label, value);
    scores.appendChild(card);
  });
  els.analysisResult.appendChild(scores);
  appendTextList(els.analysisResult, "Fluency observations", report.fluency_observations);
  appendTextList(els.analysisResult, `Pronunciation observations${audioAnalyzed ? "" : " (unavailable without audio)"}`, report.pronunciation_observations);
  appendTextList(els.analysisResult, "Sentence structure and clarity", report.sentence_structure_feedback);
  appendTextList(els.analysisResult, "Strengths", report.strengths);
  appendTextList(els.analysisResult, "Areas for improvement", report.areas_for_improvement);
  appendTextList(els.analysisResult, "Speaking exercises", report.speaking_exercises);
  const sections = [
    ["Grammar corrections", report.grammar_mistakes],
    ["Vocabulary improvements", report.vocabulary_improvements]
  ];
  sections.forEach(([title, entries]) => {
    if (!Array.isArray(entries) || !entries.length) return;
    const heading = document.createElement("h4");
    heading.textContent = title;
    els.analysisResult.appendChild(heading);
    entries.forEach(entry => {
      const item = document.createElement("p");
      item.textContent = `${entry.original || "Observation"} → ${entry.correction || entry.suggestion || ""} ${entry.explanation || entry.reason || ""}`.trim();
      els.analysisResult.appendChild(item);
    });
  });
  const improved = document.createElement("p");
  improved.textContent = `Improved speech: ${report.improved_speech || "Not provided."}`;
  els.analysisResult.appendChild(improved);
  const coverage = document.createElement("p");
  coverage.textContent = `Script coverage: ${report.script_coverage || "Not provided."}`;
  els.analysisResult.appendChild(coverage);
}
$("settingsToggle").addEventListener("click", () => $("settingsPanel").classList.toggle("hidden"));
$("closeSettings").addEventListener("click", () => $("settingsPanel").classList.add("hidden"));
$("splitMode").addEventListener("click", () => setLayout("split"));
$("overlayMode").addEventListener("click", () => setLayout("overlay"));
$("scriptInput").addEventListener("input", updateScript);
$("fontSize").addEventListener("input", () => { $("fontSizeOutput").textContent = `${$("fontSize").value} px`; updateScript(); });
$("wpm").addEventListener("input", () => {
  updateWpmLabel();
  savePreferences();
});
$("scriptPosition").addEventListener("change", updateScriptPosition);
$("mirrorCamera").addEventListener("change", () => els.cameraStage.classList.toggle("mirror", $("mirrorCamera").checked));
$("mirrorScript").addEventListener("change", updateScript);
$("flipScript").addEventListener("change", updateScript);
$("autoScroll").addEventListener("change", () => {
  if (!$("autoScroll").checked) {
    stopScrolling();
    if (recordingState !== "recording" && recordingState !== "paused") {
      els.overlayScript.classList.add("hidden");
    }
  } else if (recordingState === "recording") {
    startScrolling();
  }
});
$("clearScript").addEventListener("click", () => { els.scriptInput.value = ""; updateScript(); resetScroll(); });
$("resetScroll").addEventListener("click", resetScroll);
$("scrollToggle").addEventListener("click", () => scrollFrame !== null ? stopScrolling() : startScrolling());
els.readingPreview.addEventListener("scroll", () => {
  if (scrollFrame !== null) return;
  const readingMax = Math.max(0, els.readingPreview.scrollHeight - els.readingPreview.clientHeight);
  scrollProgress = readingMax ? els.readingPreview.scrollTop / readingMax : 0;
  syncScrollContainers();
});
$("enableCamera").addEventListener("click", enableCamera);
$("cameraSelect").addEventListener("change", () => { if (stream && recordingState !== "recording" && recordingState !== "paused") enableCamera(); });
$("micSelect").addEventListener("change", () => { if (stream && recordingState !== "recording" && recordingState !== "paused") enableCamera(); });
els.recordButton.addEventListener("click", startRecording);
els.pauseButton.addEventListener("click", pauseRecording);
els.stopButton.addEventListener("click", stopRecording);
els.downloadButton.addEventListener("click", downloadVideo);
els.analyzeButton.addEventListener("click", analyzeSpeech);
$("clearTranscript").addEventListener("click", () => { els.transcript.value = ""; finalTranscript = ""; });
els.coachNavButton.addEventListener("click", () => showPage(els.coachView.classList.contains("hidden") ? "coach" : "recording"));
els.getFeedbackButton.addEventListener("click", () => showPage("coach"));
els.backToRecordingButton.addEventListener("click", () => showPage("recording"));
els.scriptInput.addEventListener("input", () => sessionStorage.setItem("speakflow-script", els.scriptInput.value));
els.transcript.addEventListener("input", () => sessionStorage.setItem("speakflow-transcript", els.transcript.value));
function savePreferences() {
  const preferences = {
    scriptPosition: $("scriptPosition").value,
    fontSize: $("fontSize").value,
    wpm: $("wpm").value,
    mirrorCamera: $("mirrorCamera").checked,
    autoScroll: $("autoScroll").checked,
    mirrorScript: $("mirrorScript").checked,
    flipScript: $("flipScript").checked
  };
  try { localStorage.setItem("speakflow-preferences", JSON.stringify(preferences)); } catch (_) {}
}
function loadPreferences() {
  try {
    const preferences = JSON.parse(localStorage.getItem("speakflow-preferences") || "{}");
    ["scriptPosition", "fontSize", "wpm"].forEach(id => {
      if ((typeof preferences[id] === "string" || typeof preferences[id] === "number") && $(id)) {
        $(id).value = preferences[id];
      }
    });
    ["mirrorCamera", "autoScroll", "mirrorScript", "flipScript"].forEach(id => {
      if (typeof preferences[id] === "boolean" && $(id)) $(id).checked = preferences[id];
    });
  } catch (_) {}
}
["scriptPosition", "fontSize", "wpm", "mirrorCamera", "autoScroll", "mirrorScript", "flipScript"]
  .forEach(id => $(id).addEventListener("change", savePreferences));
window.addEventListener("beforeunload", () => {
  stopScrolling();
  if (stream) stream.getTracks().forEach(track => track.stop());
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
});

loadPreferences();
updateScript();
updateWpmLabel();
setLayout("split");
setRecordingControls();
els.scriptInput.value = sessionStorage.getItem("speakflow-script") || "";
els.transcript.value = sessionStorage.getItem("speakflow-transcript") || "";
updateScript();
updateOverlayVisibility();
refreshDevices();
