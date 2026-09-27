from app.routing import route_ticket


def analysis(confidence=0.9, urgency=1, blocked=0.1, department="billing"):
    return {
        "department": department,
        "confidence": confidence,
        "urgency_score": urgency,
        "blocked_probability": blocked,
    }


def test_low_confidence_goes_to_human_review_even_when_critical():
    result = route_ticket(analysis(confidence=0.61, urgency=3), 0.7, 0.75)
    assert result["status"] == "human_review"
    assert result["queue"] == "human-review"
    assert result["priority"] == "priority"
    assert any("70%" in reason for reason in result["reasons"])


def test_critical_ticket_goes_to_department_priority_queue():
    result = route_ticket(analysis(urgency=3, department="technical"), 0.7, 0.75)
    assert result["status"] == "automatic"
    assert result["queue"] == "technical-priority"
    assert "Urgency score 3/3" in result["reasons"]


def test_blocked_customer_gets_priority():
    result = route_ticket(analysis(blocked=0.81), 0.7, 0.75)
    assert result["queue"] == "billing-priority"


def test_normal_ticket_uses_department_queue():
    result = route_ticket(analysis(), 0.7, 0.75)
    assert result["queue"] == "billing"
    assert result["priority"] == "normal"


def test_threshold_boundary_is_automatic():
    result = route_ticket(analysis(confidence=0.7), 0.7, 0.75)
    assert result["status"] == "automatic"
