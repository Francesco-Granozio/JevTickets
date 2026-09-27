import pytest

from app.model import OpenJevAnalyzer, normalize_analysis


def test_normalizes_model_probabilities_and_preserves_scores():
    result = normalize_analysis({
        "department_probabilities": {"billing": 7, "technical": 2, "account": 1, "sales": 0, "other": 0},
        "urgency_score": 3,
        "refund_probability": 0.85,
        "blocked_probability": 0.15,
        "model_name": "openjev-v2",
    })
    assert result["department"] == "billing"
    assert result["confidence"] == 0.7
    assert sum(result["department_probabilities"].values()) == pytest.approx(1)
    assert result["urgency_score"] == 3


def test_rejects_incomplete_model_result():
    with pytest.raises(ValueError):
        normalize_analysis({"department_probabilities": {"billing": 1}})


def test_space_must_be_configured_for_new_analysis(monkeypatch):
    monkeypatch.delenv("OPENJEV_SPACE", raising=False)
    analyzer = OpenJevAnalyzer()
    with pytest.raises(RuntimeError, match="OPENJEV_SPACE is not configured"):
        analyzer.analyze("Subject", "Message")
