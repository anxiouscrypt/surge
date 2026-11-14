# Priority classifier

- `synth/`  synthetic call transcripts + P1-P4 labels (synthetic only)
- `train.ipynb`  fine-tune a compact text classifier on NVIDIA Brev
- `eval.ipynb`   held-out benchmark: rules vs rules + classifier, overall accuracy and P1 recall
- `serve/`  FastAPI endpoint: `POST /classify {text} -> {priority, p1_probability}`

The backend uses this as a second opinion only: it can raise a priority to P1, never lower one.
