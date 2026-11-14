"""Classifier server stub. Replace the heuristic with the fine-tuned model."""
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Req(BaseModel):
    text: str


@app.post("/classify")
def classify(req: Req):
    # TODO: load the fine-tuned model and run inference
    return {"priority": 4, "p1_probability": 0.0}
