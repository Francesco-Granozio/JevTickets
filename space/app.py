"""OpenJev v2 ticket judgments; routing policy belongs to the application backend."""

from __future__ import annotations

import math

import gradio as gr
import spaces
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


MODEL_ID = "AlexWortega/openjev"
MODEL_SUBFOLDER = "qwen3.5-4b-nli-v2"
MODEL_NAME = f"{MODEL_ID}/{MODEL_SUBFOLDER}"
MAX_SUBJECT_LENGTH = 300
MAX_MESSAGE_LENGTH = 10_000
MAX_TOKEN_LENGTH = 4096
BATCH_SIZE = 4

DEPARTMENTS = ("billing", "technical", "account", "sales", "other")
DEPARTMENT_HYPOTHESES = (
    "The customer's request concerns billing, a charge, a payment, an invoice, or a refund.",
    "The customer's request concerns a technical problem, error, outage, or product malfunction.",
    "The customer's request concerns an account, login, password, access rights, or profile settings.",
    "The customer's request concerns a purchase decision, pricing, a plan, or a sales inquiry.",
    "The customer's request does not fit billing, technical support, account support, or sales.",
)
URGENCY_HYPOTHESES = (
    "The ticket can wait; there is no time-sensitive impact.",
    "The ticket needs a normal response in the usual support timeframe.",
    "The ticket needs attention today due to a meaningful current impact.",
    "The ticket is critical and needs immediate attention due to severe current impact.",
)
REFUND_HYPOTHESES = (
    "The customer explicitly asks to receive money back as a refund.",
    "The customer does not explicitly ask to receive money back as a refund.",
)
BLOCKED_HYPOTHESES = (
    "The customer is currently unable to use the product or an essential feature.",
    "The customer can currently use the product and its essential features.",
)
HYPOTHESES = (
    DEPARTMENT_HYPOTHESES
    + URGENCY_HYPOTHESES
    + REFUND_HYPOTHESES
    + BLOCKED_HYPOTHESES
)

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, subfolder=MODEL_SUBFOLDER)
tokenizer.padding_side = "right"
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

model = AutoModelForSequenceClassification.from_pretrained(
    MODEL_ID, subfolder=MODEL_SUBFOLDER, dtype=torch.bfloat16
).to("cuda").eval()
model.config.get_text_config().pad_token_id = tokenizer.pad_token_id

template = getattr(model.config, "nli_template", None) or (
    "Premise: {premise}\nHypothesis: {hypothesis}"
)
entailment_id = next(
    int(index)
    for index, label in model.config.id2label.items()
    if label.casefold() == "entailment"
)


def _relative_scores(scores: list[float]) -> list[float]:
    """Normalize independent NLI entailment scores within one answer set."""
    if not scores or any(not math.isfinite(value) or value < 0 for value in scores):
        raise ValueError("OpenJev returned invalid entailment scores.")
    total = sum(scores)
    if total <= 0:
        raise ValueError("OpenJev returned no support for the answer set.")
    return [value / total for value in scores]


def _entailment_scores(premise: str) -> list[float]:
    scores: list[float] = []
    for start in range(0, len(HYPOTHESES), BATCH_SIZE):
        group = HYPOTHESES[start : start + BATCH_SIZE]
        texts = [template.format(premise=premise, hypothesis=item) for item in group]
        encoded = tokenizer(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=MAX_TOKEN_LENGTH,
        )
        inputs = {key: value.to("cuda") for key, value in encoded.items()}
        with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
            logits = model(**inputs).logits.float()
        probabilities = torch.softmax(logits, dim=-1)
        scores.extend(probabilities[:, entailment_id].cpu().tolist())
    return scores


app = gr.Server(title="Support Triage · OpenJev v2")


@app.api(name="analyze")
@spaces.GPU(duration=60)
@torch.inference_mode()
def analyze(subject: str, message: str) -> dict:
    """Return OpenJev judgments for one support ticket, without routing it."""
    if not isinstance(subject, str) or not subject.strip():
        raise gr.Error("Subject is required.")
    if not isinstance(message, str) or not message.strip():
        raise gr.Error("Message is required.")
    subject = subject.strip()
    message = message.strip()
    if len(subject) > MAX_SUBJECT_LENGTH or len(message) > MAX_MESSAGE_LENGTH:
        raise gr.Error("Ticket exceeds the subject or message size limit.")

    premise = f"Customer support ticket.\nSubject: {subject}\nMessage: {message}"
    scores = _entailment_scores(premise)
    department = _relative_scores(scores[:5])
    urgency = _relative_scores(scores[5:9])
    refund = _relative_scores(scores[9:11])
    blocked = _relative_scores(scores[11:13])
    return {
        "department_probabilities": dict(zip(DEPARTMENTS, department)),
        "urgency_score": max(range(4), key=urgency.__getitem__),
        "refund_probability": refund[0],
        "blocked_probability": blocked[0],
        "model_name": MODEL_NAME,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model_name": MODEL_NAME}


app.launch()
