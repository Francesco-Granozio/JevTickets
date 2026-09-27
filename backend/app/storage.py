from __future__ import annotations

import csv
import hashlib
import io
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class TicketStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tickets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    subject TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    fingerprint TEXT,
                    expected_department TEXT,
                    expected_urgency INTEGER,
                    expected_refund_requested INTEGER,
                    expected_customer_blocked INTEGER,
                    expected_human_review INTEGER,
                    notes TEXT,
                    analysis_json TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tickets_source_fingerprint ON tickets (source, fingerprint)")

    def _connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _as_dict(row: sqlite3.Row) -> dict:
        item = dict(row)
        item["analysis"] = json.loads(item.pop("analysis_json")) if item.get("analysis_json") else None
        item.pop("fingerprint", None)
        return item

    def create_ticket(self, subject: str, message: str, source: str = "manual", **labels) -> dict:
        created_at = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            cursor = conn.execute(
                """INSERT INTO tickets (
                    subject, message, created_at, source, fingerprint,
                    expected_department, expected_urgency, expected_refund_requested,
                    expected_customer_blocked, expected_human_review, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    subject, message, created_at, source, labels.get("fingerprint"),
                    labels.get("expected_department"), labels.get("expected_urgency"),
                    labels.get("expected_refund_requested"), labels.get("expected_customer_blocked"),
                    labels.get("expected_human_review"), labels.get("notes"),
                ),
            )
            ticket_id = cursor.lastrowid
        return self.get_ticket(ticket_id)

    def get_ticket(self, ticket_id: int) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        return self._as_dict(row) if row else None

    def list_tickets(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM tickets ORDER BY id").fetchall()
        return [self._as_dict(row) for row in rows]

    def save_analysis(self, ticket_id: int, analysis: dict) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE tickets SET analysis_json = ? WHERE id = ?",
                (json.dumps(analysis), ticket_id),
            )

    def import_csv(self, content: bytes, source: str = "import") -> dict:
        try:
            decoded = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            decoded = content.decode("cp1252")
        reader = csv.DictReader(io.StringIO(decoded), delimiter=";")
        required = {"subject", "message"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("CSV must contain subject and message columns separated by semicolons")

        validated = []
        for line, row in enumerate(reader, start=2):
            subject = (row.get("subject") or "").strip()
            message = (row.get("message") or "").strip()
            if not subject or not message:
                raise ValueError(f"Line {line}: subject and message are required")
            if len(subject) > 180 or len(message) > 10_000:
                raise ValueError(f"Line {line}: subject must be at most 180 characters and message at most 10,000")
            fingerprint = hashlib.sha256(f"{subject}\0{message}".encode("utf-8")).hexdigest()

            def optional_int(key: str) -> int | None:
                value = (row.get(key) or "").strip()
                return int(value) if value else None

            validated.append((subject, message, fingerprint, {
                "expected_department": (row.get("expected_department") or "").strip().lower() or None,
                "expected_urgency": optional_int("expected_urgency"),
                "expected_refund_requested": optional_int("expected_refund_requested"),
                "expected_customer_blocked": optional_int("expected_customer_blocked"),
                "expected_human_review": optional_int("expected_human_review"),
                "notes": (row.get("notes") or "").strip() or None,
            }))

        imported = skipped = 0
        for subject, message, fingerprint, labels in validated:
            with self._connect() as conn:
                exists = conn.execute(
                    "SELECT id FROM tickets WHERE fingerprint = ?",
                    (fingerprint,),
                ).fetchone()
            if exists:
                skipped += 1
                continue
            self.create_ticket(subject, message, source=source, fingerprint=fingerprint, **labels)
            imported += 1
        return {"imported": imported, "skipped": skipped}
