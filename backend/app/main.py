from __future__ import annotations

import os
import json
import csv
from pathlib import Path
from typing import Protocol

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .model import OpenJevAnalyzer, normalize_analysis
from .routing import route_ticket
from .storage import TicketStore


class Analyzer(Protocol):
    def analyze(self, subject: str, message: str) -> dict: ...


class NewTicket(BaseModel):
    subject: str = Field(min_length=1, max_length=180)
    message: str = Field(min_length=1, max_length=10000)

    @field_validator("subject", "message")
    @classmethod
    def nonempty_after_trim(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Cannot be blank")
        return trimmed


class RoutingConfig(BaseModel):
    confidence_threshold: float = Field(ge=0, le=1)
    blocked_threshold: float = Field(ge=0, le=1)


def create_app(store: TicketStore | None = None, analyzer: Analyzer | None = None) -> FastAPI:
    project_root = Path(__file__).resolve().parents[2]
    if store is None:
        try:
            from dotenv import load_dotenv
            load_dotenv(project_root / ".env")
        except ImportError:
            pass
        db_path = Path(os.getenv("TRIAGE_DB_PATH", "backend/data/tickets.db"))
        if not db_path.is_absolute():
            db_path = project_root / db_path
        store = TicketStore(db_path)
        seed = project_root / "sample_support_tickets.csv"
        if seed.exists():
            store.import_csv(seed.read_bytes(), source="seed")
        snapshot = project_root / "backend" / "data" / "demo_analysis.json"
        if snapshot.exists():
            saved = json.loads(snapshot.read_text(encoding="utf-8"))
            for ticket in store.list_tickets():
                if ticket["source"] == "seed" and ticket["analysis"] is None:
                    import hashlib
                    key = hashlib.sha256(f"{ticket['subject']}\0{ticket['message']}".encode("utf-8")).hexdigest()
                    if key in saved:
                        store.save_analysis(ticket["id"], saved[key])
    analyzer = analyzer or OpenJevAnalyzer()
    config = RoutingConfig(confidence_threshold=0.7, blocked_threshold=0.75)
    app = FastAPI(title="Support Triage AI", version="0.1.0")
    origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if item.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PUT"], allow_headers=["*"])

    def present(ticket: dict) -> dict:
        result = dict(ticket)
        result["route"] = (
            route_ticket(ticket["analysis"], config.confidence_threshold, config.blocked_threshold)
            if ticket["analysis"] else None
        )
        return result

    def find(ticket_id: int) -> dict:
        ticket = store.get_ticket(ticket_id)
        if ticket is None:
            raise HTTPException(status_code=404, detail="Ticket not found")
        return ticket

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/config")
    def get_config():
        return config

    @app.put("/api/config")
    def put_config(updated: RoutingConfig):
        nonlocal config
        config = updated
        return config

    @app.get("/api/tickets")
    def list_tickets():
        return [present(ticket) for ticket in store.list_tickets()]

    @app.post("/api/tickets", status_code=201)
    def create_ticket(payload: NewTicket):
        return present(store.create_ticket(payload.subject.strip(), payload.message.strip()))

    @app.get("/api/tickets/{ticket_id}")
    def get_ticket(ticket_id: int):
        return present(find(ticket_id))

    @app.post("/api/tickets/{ticket_id}/analyze")
    def analyze_ticket(ticket_id: int):
        ticket = find(ticket_id)
        try:
            analysis = normalize_analysis(analyzer.analyze(ticket["subject"], ticket["message"]))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"OpenJev analysis unavailable: {type(exc).__name__}") from exc
        store.save_analysis(ticket_id, analysis)
        return present(find(ticket_id))

    @app.post("/api/import")
    async def import_tickets(file: UploadFile = File(...)):
        if not file.filename or not file.filename.lower().endswith(".csv"):
            raise HTTPException(status_code=400, detail="Choose a CSV file")
        content = await file.read(2_000_001)
        if len(content) > 2_000_000:
            raise HTTPException(status_code=413, detail="CSV must be 2 MB or smaller")
        try:
            return store.import_csv(content)
        except (UnicodeError, ValueError, KeyError, csv.Error) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/evaluation")
    def evaluation():
        labeled = [ticket for ticket in store.list_tickets() if ticket["source"] == "seed" and ticket["expected_department"]]
        result = {
            "total": len(labeled), "analyzed": 0, "correct_auto": 0,
            "incorrect_auto": 0, "human_review": 0, "pending": 0,
            "by_department": [],
        }
        department_counts: dict[str, dict] = {}
        for ticket in labeled:
            expected = ticket["expected_department"]
            bucket = department_counts.setdefault(expected, {"department": expected, "total": 0, "correct_auto": 0, "incorrect_auto": 0, "human_review": 0, "pending": 0})
            bucket["total"] += 1
            analysis = ticket["analysis"]
            if analysis is None:
                result["pending"] += 1
                bucket["pending"] += 1
                continue
            result["analyzed"] += 1
            route = present(ticket)["route"]
            category = "human_review" if route["status"] == "human_review" else (
                "correct_auto" if analysis["department"] == expected else "incorrect_auto"
            )
            result[category] += 1
            bucket[category] += 1
        result["by_department"] = sorted(department_counts.values(), key=lambda item: item["department"])
        return result

    return app


app = create_app()
