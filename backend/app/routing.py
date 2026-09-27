from __future__ import annotations


def route_ticket(analysis: dict, confidence_threshold: float, blocked_threshold: float) -> dict:
    """Apply application policy to a model judgment without changing the judgment."""
    confidence = float(analysis["confidence"])
    urgency = int(analysis["urgency_score"])
    blocked = float(analysis["blocked_probability"])
    department = str(analysis["department"]).lower()
    is_priority = urgency == 3 or blocked >= blocked_threshold

    reasons = []
    if confidence < confidence_threshold:
        reasons.append(
            f"Department confidence {confidence:.0%} is below the {confidence_threshold:.0%} threshold."
        )
    else:
        reasons.append(
            f"Department confidence {confidence:.0%} meets the {confidence_threshold:.0%} threshold."
        )
    if urgency == 3:
        reasons.append("Urgency score 3/3")
    if blocked >= blocked_threshold:
        reasons.append(
            f"Customer blocked probability {blocked:.0%} meets the {blocked_threshold:.0%} threshold."
        )

    review = confidence < confidence_threshold
    queue = "human-review" if review else f"{department}{'-priority' if is_priority else ''}"
    if not review and not is_priority:
        reasons.append(f"Routed to the standard {department} queue.")
    return {
        "queue": queue,
        "status": "human_review" if review else "automatic",
        "priority": "priority" if is_priority else "normal",
        "reasons": reasons,
    }
