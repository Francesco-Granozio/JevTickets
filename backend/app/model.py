from __future__ import annotations

import math
import os
from datetime import datetime, timezone

DEPARTMENTS = ("billing", "technical", "account", "sales", "other")


def _probability(value: object) -> float:
    number = float(value)
    if not math.isfinite(number) or not 0 <= number <= 1:
        raise ValueError("Model returned a probability outside 0–1")
    return number


def normalize_analysis(raw: dict) -> dict:
    """Validate the service response and expose one stable UI/API contract."""
    if not isinstance(raw, dict):
        raise ValueError("Model response must be a JSON object")
    scores = raw["department_probabilities"]
    if not isinstance(scores, dict) or set(scores) != set(DEPARTMENTS):
        raise ValueError("Model response must include all five departments")
    numeric = {key: float(scores[key]) for key in DEPARTMENTS}
    if any(not math.isfinite(value) or value < 0 for value in numeric.values()):
        raise ValueError("Invalid department scores")
    total = sum(numeric.values())
    if total <= 0:
        raise ValueError("Department scores add up to zero")
    probabilities = {key: value / total for key, value in numeric.items()}
    department = max(DEPARTMENTS, key=lambda key: probabilities[key])
    urgency = int(raw["urgency_score"])
    if urgency not in range(4) or float(raw["urgency_score"]) != urgency:
        raise ValueError("Urgency must be an integer from 0 to 3")
    return {
        "department_probabilities": probabilities,
        "department": department,
        "confidence": probabilities[department],
        "urgency_score": urgency,
        "refund_probability": _probability(raw["refund_probability"]),
        "blocked_probability": _probability(raw["blocked_probability"]),
        "model_name": str(raw["model_name"]),
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }


class OpenJevAnalyzer:
    def __init__(self, space: str | None = None, token: str | None = None):
        self.space = (space if space is not None else os.getenv("OPENJEV_SPACE", "")).strip()
        self.token = token or os.getenv("HF_TOKEN")
        self._client = None

    def analyze(self, subject: str, message: str) -> dict:
        if not self.space:
            raise RuntimeError("OPENJEV_SPACE is not configured")
        # Gradio's client uses the Space queue, which is required for ZeroGPU allocation.
        from gradio_client import Client

        if self._client is None:
            self._client = Client(self.space, token=self.token)
        result = self._client.predict(subject, message, api_name="/analyze")
        if not isinstance(result, dict):
            raise ValueError("OpenJev returned an unexpected response")
        return result
