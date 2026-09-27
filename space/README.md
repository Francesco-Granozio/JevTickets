---
title: Support Triage OpenJev v2
emoji: 🎫
colorFrom: blue
colorTo: purple
sdk: gradio
sdk_version: 6.28.0
app_file: app.py
python_version: "3.12"
models:
  - AlexWortega/openjev
license: mit
---

# Support Triage · OpenJev v2

Dedicated model service for the Support Triage AI portfolio app. The service evaluates a ticket; application routing policy lives in the separate backend.

## API

The queued Gradio API endpoint is `/analyze`. On a private Space, call it from the backend with a server-side Hugging Face token that has read access to this Space:

```python
import os
from gradio_client import Client

client = Client(
    os.environ["OPENJEV_SPACE"],
    token=os.environ["HF_TOKEN"],
)
result = client.predict(subject, message, api_name="/analyze")
```

Set `OPENJEV_SPACE` and `HF_TOKEN` in the backend's private environment. The Space identifier and token are never sent to the browser.

Input: `subject` and `message` as nonempty strings. Output:

```json
{
  "department_probabilities": {
    "billing": 0.5944,
    "technical": 0.0425,
    "account": 0.0056,
    "sales": 0.3241,
    "other": 0.0334
  },
  "urgency_score": 1,
  "refund_probability": 0.9336,
  "blocked_probability": 0.1934,
  "model_name": "AlexWortega/openjev/qwen3.5-4b-nli-v2"
}
```

The rounded numeric example above comes from a live inference on a synthetic duplicate-charge ticket; it is not a preset response. For each question, OpenJev scores a fixed set of natural-language hypotheses. Entailment scores are normalized within that set to obtain relative values in `[0, 1]`. These values are useful for ranking and uncertainty rules, but are **not calibrated empirical probabilities**. Urgency is the most supported value on the ordered 0–3 scale. The backend is responsible for confidence thresholds, routing, and Human Review.

The Space uses ZeroGPU and queues GPU calls. Cold starts and daily GPU quotas can add latency or temporarily prevent inference. Keep the Space token on the backend only; never put it in browser code or commit it to the repository. There is no heuristic fallback that fabricates a model result.
