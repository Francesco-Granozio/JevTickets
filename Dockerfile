FROM python:3.12-slim

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend /app/backend
COPY sample_support_tickets.csv /app/sample_support_tickets.csv
ENV PYTHONPATH=/app/backend
ENV TRIAGE_DB_PATH=/app/backend/data/tickets.db
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
