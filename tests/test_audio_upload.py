import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import backend.app as app


class _Response:
    text = (
        '{"overall_assessment":"Good","overall_score":7,'
        '"scores":{"grammar":7,"fluency":7,"vocabulary":7,'
        '"pronunciation":7,"sentence_structure":7},'
        '"grammar_mistakes":[],"speaking_exercises":["one","two","three"]}'
    )


class _Models:
    def generate_content(self, **kwargs):
        return _Response()


class _Files:
    def upload(self, **kwargs):
        return {"name": "mock-audio"}


class _Client:
    def __init__(self, **kwargs):
        self.models = _Models()
        self.files = _Files()


class AudioUploadTests(unittest.TestCase):
    def test_browser_audio_mime_parameters_are_normalized(self):
        client = TestClient(app.app)
        browser_types = [
            "audio/webm;codecs=opus",
            "audio/ogg;codecs=opus",
            "audio/mp4",
            "audio/wav",
        ]
        with patch.dict(os.environ, {"GEMINI_API_KEY": "mock-key"}), patch.object(
            app.genai, "Client", _Client
        ):
            for content_type in browser_types:
                with self.subTest(content_type=content_type):
                    response = client.post(
                        "/analyze-speaking",
                        data={"transcript": "This is a browser MIME test."},
                        files={"audio": ("recording", b"audio-data", content_type)},
                    )
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertTrue(response.json()["audio_analyzed"])

    def test_video_mime_is_not_accepted_as_audio(self):
        response = TestClient(app.app).post(
            "/analyze-speaking",
            data={"transcript": "This should reject video."},
            files={"audio": ("recording.webm", b"video-data", "video/webm")},
        )
        self.assertEqual(response.status_code, 415)


if __name__ == "__main__":
    unittest.main()
