from fastapi.testclient import TestClient

from app.main import create_app
from app.storage import TicketStore


class FakeAnalyzer:
    def analyze(self, subject: str, message: str) -> dict:
        return {
            "department_probabilities": {
                "billing": 0.72, "technical": 0.15, "account": 0.08,
                "sales": 0.03, "other": 0.02,
            },
            "urgency_score": 2,
            "refund_probability": 0.95,
            "blocked_probability": 0.1,
            "model_name": "test-openjev",
        }


def client(tmp_path):
    store = TicketStore(tmp_path / "tickets.db")
    app = create_app(store=store, analyzer=FakeAnalyzer())
    return TestClient(app)


def test_create_analyze_and_reconfigure_route(tmp_path):
    api = client(tmp_path)
    created = api.post("/api/tickets", json={"subject": "Double charge", "message": "Refund me"})
    assert created.status_code == 201
    ticket_id = created.json()["id"]
    assert created.json()["analysis"] is None

    analyzed = api.post(f"/api/tickets/{ticket_id}/analyze")
    assert analyzed.status_code == 200
    assert analyzed.json()["analysis"]["department"] == "billing"
    assert analyzed.json()["route"]["status"] == "automatic"

    changed = api.put("/api/config", json={"confidence_threshold": 0.8, "blocked_threshold": 0.75})
    assert changed.status_code == 200
    rerouted = api.get(f"/api/tickets/{ticket_id}").json()
    assert rerouted["route"]["status"] == "human_review"
    assert rerouted["analysis"]["confidence"] == 0.72


def test_health_does_not_expose_model_service(tmp_path):
    api = client(tmp_path)
    assert api.get("/api/health").json() == {"status": "ok"}


def test_import_evaluation_and_no_duplicate_rows(tmp_path):
    api = client(tmp_path)
    csv = (
        "subject;message;expected_department;expected_urgency;expected_refund_requested;"
        "expected_customer_blocked;expected_human_review;notes\n"
        "Refund;Please refund my payment;billing;2;1;0;0;clear\n"
    ).encode("utf-8")
    first = api.post("/api/import", files={"file": ("tickets.csv", csv, "text/csv")})
    second = api.post("/api/import", files={"file": ("tickets.csv", csv, "text/csv")})
    assert first.json() == {"imported": 1, "skipped": 0}
    assert second.json() == {"imported": 0, "skipped": 1}
    assert api.get("/api/evaluation").json()["total"] == 0
    seeded = TicketStore(tmp_path / "tickets.db").create_ticket(
        "Second refund", "Please reverse this charge", source="seed", expected_department="billing"
    )
    assert api.get("/api/evaluation").json()["pending"] == 1
    api.post(f"/api/tickets/{seeded['id']}/analyze")
    evaluation = api.get("/api/evaluation").json()
    assert evaluation["total"] == 1
    assert evaluation["correct_auto"] == 1
    assert evaluation["incorrect_auto"] == 0


def test_invalid_config_and_missing_ticket(tmp_path):
    api = client(tmp_path)
    assert api.put("/api/config", json={"confidence_threshold": 1.2, "blocked_threshold": 0.75}).status_code == 422
    assert api.post("/api/tickets", json={"subject": "  ", "message": "Some message"}).status_code == 422
    assert api.get("/api/tickets/999").status_code == 404
    assert api.post("/api/tickets/999/analyze").status_code == 404


def test_fresh_database_loads_labeled_seed_and_real_model_snapshot(tmp_path, monkeypatch):
    monkeypatch.setenv("TRIAGE_DB_PATH", str(tmp_path / "fresh.db"))
    seeded = TestClient(create_app())
    tickets = seeded.get("/api/tickets").json()
    assert len(tickets) == 30
    assert all(ticket["analysis"] is not None for ticket in tickets)
    assert seeded.get("/api/evaluation").json()["pending"] == 0
