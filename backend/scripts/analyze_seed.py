"""Refresh the checked-in demo snapshot from the real OpenJev Space.

Run with PYTHONPATH=backend after setting HF_TOKEN. This is deliberately an
explicit maintenance command; visitors never trigger 30 model calls on load.
"""

import csv
import hashlib
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv

from app.model import OpenJevAnalyzer, normalize_analysis


ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "backend" / "data" / "demo_analysis.json"


def fingerprint(subject: str, message: str) -> str:
    return hashlib.sha256(f"{subject}\0{message}".encode("utf-8")).hexdigest()


def main() -> None:
    load_dotenv(ROOT / ".env")
    if not os.getenv("HF_TOKEN"):
        raise SystemExit("HF_TOKEN is required to refresh the demo snapshot")
    rows = list(csv.DictReader((ROOT / "sample_support_tickets.csv").read_text(encoding="cp1252").splitlines(), delimiter=";"))
    current = json.loads(SNAPSHOT.read_text(encoding="utf-8")) if SNAPSHOT.exists() else {}
    analyzer = OpenJevAnalyzer()
    for index, row in enumerate(rows, start=1):
        key = fingerprint(row["subject"].strip(), row["message"].strip())
        if key in current:
            print(f"{index}/{len(rows)} cached: {row['subject']}", flush=True)
            continue
        for attempt in range(3):
            try:
                result = normalize_analysis(analyzer.analyze(row["subject"], row["message"]))
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(3 * (attempt + 1))
        current[key] = result
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"{index}/{len(rows)} {result['department']} {result['confidence']:.1%}: {row['subject']}", flush=True)


if __name__ == "__main__":
    main()
