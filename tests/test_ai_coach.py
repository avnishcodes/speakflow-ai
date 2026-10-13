import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import backend.app as app


class ProviderError(Exception):
    def __init__(self, status_code):
        super().__init__(f"provider error {status_code}")
        self.status_code = status_code


class MockResponse:
    def __init__(self, text):
        self.text = text


class MockModels:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error

    def generate_content(self, **kwargs):
        if self.error:
            raise self.error
        return self.response


class MockClient:
    models = None

    def __init__(self, **kwargs):
        self.models = MockClient.models


class AICoachTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app.app)

    def test_frontend_origins_are_explicit_and_configurable(self):
        with patch.dict(
            os.environ,
            {"FRONTEND_ORIGINS": "https://app.example.com/, https://studio.example.com"},
        ):
            self.assertEqual(
                app.configured_frontend_origins(),
                ["https://app.example.com", "https://studio.example.com"],
            )
        with patch.dict(os.environ, {"FRONTEND_ORIGINS": ""}):
            self.assertEqual(
                app.configured_frontend_origins(),
                ["http://127.0.0.1:5500", "http://localhost:5500"],
            )

    def test_empty_input_is_rejected_without_provider_call(self):
        with patch.object(app.genai, "Client") as client:
            response = self.client.post("/analyze-speaking", data={"transcript": "  "})
        self.assertEqual(response.status_code, 422)
        client.assert_not_called()

    def test_successful_transcript_analysis_returns_report(self):
        report = '{"overall_assessment":"Clear","overall_score":8,"scores":{"grammar":8}}'
        MockClient.models = MockModels(response=MockResponse(report))
        with patch.dict(os.environ, {"GEMINI_API_KEY": "mock-key"}), patch.object(
            app.genai, "Client", MockClient
        ):
            response = self.client.post(
                "/analyze-speaking",
                data={"transcript": "I speak clearly."},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["report"]["overall_score"], 8)
        self.assertEqual(response.json()["analysis_mode"], "transcript-only")

    def test_malformed_provider_response_is_safe_error(self):
        MockClient.models = MockModels(response=MockResponse("not json"))
        with patch.dict(os.environ, {"GEMINI_API_KEY": "mock-key"}), patch.object(
            app.genai, "Client", MockClient
        ):
            response = self.client.post(
                "/analyze-speaking",
                data={"transcript": "I speak clearly."},
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("invalid report", response.json()["detail"].lower())

    def test_missing_api_configuration_is_reported(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}, clear=False), patch.object(
            app.genai, "Client"
        ) as client:
            response = self.client.post(
                "/analyze-speaking",
                data={"transcript": "I speak clearly."},
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("not configured", response.json()["detail"])
        client.assert_not_called()

    def test_provider_transient_errors_are_mapped_to_retryable_response(self):
        for status_code in (429, 503, 504):
            with self.subTest(status_code=status_code):
                MockClient.models = MockModels(error=ProviderError(status_code))
                with patch.dict(os.environ, {"GEMINI_API_KEY": "mock-key"}), patch.object(
                    app.genai, "Client", MockClient
                ):
                    response = self.client.post(
                        "/analyze-speaking",
                        data={"transcript": "I speak clearly."},
                    )
                self.assertEqual(response.status_code, 503)
                self.assertIn("temporarily busy", response.json()["detail"])

    def test_provider_auth_errors_do_not_get_retry_message(self):
        for status_code in (401, 403):
            with self.subTest(status_code=status_code):
                MockClient.models = MockModels(error=ProviderError(status_code))
                with patch.dict(os.environ, {"GEMINI_API_KEY": "mock-key"}), patch.object(
                    app.genai, "Client", MockClient
                ):
                    response = self.client.post(
                        "/analyze-speaking",
                        data={"transcript": "I speak clearly."},
                    )
                self.assertEqual(response.status_code, 502)
                self.assertIn("rejected", response.json()["detail"])

    def test_unexpected_provider_error_is_safe(self):
        MockClient.models = MockModels(error=RuntimeError("internal provider detail"))
        with patch.dict(os.environ, {"GEMINI_API_KEY": "mock-key"}), patch.object(
            app.genai, "Client", MockClient
        ):
            response = self.client.post(
                "/analyze-speaking",
                data={"transcript": "I speak clearly."},
            )
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("internal provider detail", response.text)

    def test_invalid_audio_type_is_rejected(self):
        response = self.client.post(
            "/analyze-speaking",
            data={"transcript": "Audio test"},
            files={"audio": ("recording.exe", b"not audio", "application/octet-stream")},
        )
        self.assertEqual(response.status_code, 415)

    def test_audio_size_limit_is_enforced(self):
        with patch.dict(os.environ, {"MAX_AUDIO_BYTES": "3"}):
            response = self.client.post(
                "/analyze-speaking",
                data={"transcript": "Audio test"},
                files={"audio": ("recording.wav", b"1234", "audio/wav")},
            )
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
