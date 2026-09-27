from app.storage import TicketStore
import pytest


def test_csv_seed_reads_windows_1252_and_is_idempotent(tmp_path):
    db = TicketStore(tmp_path / "tickets.db")
    csv_path = tmp_path / "tickets.csv"
    csv_path.write_bytes(
        b"subject;message;expected_department;expected_urgency;expected_refund_requested;expected_customer_blocked;expected_human_review;notes\n"
        b"Duplicate charge;Refund \x8010;billing;2;1;0;0;sample\n"
    )
    assert db.import_csv(csv_path.read_bytes(), source="seed") == {"imported": 1, "skipped": 0}
    assert db.import_csv(csv_path.read_bytes(), source="seed") == {"imported": 0, "skipped": 1}
    ticket = db.list_tickets()[0]
    assert ticket["message"] == "Refund €10"
    assert ticket["expected_department"] == "billing"


def test_bad_csv_line_does_not_partially_import(tmp_path):
    db = TicketStore(tmp_path / "tickets.db")
    content = b"subject;message\nValid;Something\nInvalid;\n"
    with pytest.raises(ValueError, match="Line 3"):
        db.import_csv(content)
    assert db.list_tickets() == []


def test_import_rejects_ticket_exceeding_analyzer_limits(tmp_path):
    db = TicketStore(tmp_path / "tickets.db")
    with pytest.raises(ValueError, match="Line 2"):
        db.import_csv(f"subject;message\nLong;{'x' * 10001}\n".encode())
    assert db.list_tickets() == []
