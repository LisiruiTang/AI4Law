import os
from pathlib import Path
from typing import Optional

import aiohttp
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from probes.token_probs import classify
from probes.beam_search import beam_search

ROOT = Path(__file__).resolve().parents[1]
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


class OpenAIGateway:
    async def chat_completion(self, *, messages, backend="openai", model=None, max_tokens=1,
                              temperature=1.0, logprobs=False, top_logprobs=None, **kwargs):
        key = os.getenv("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("Server is missing OPENAI_API_KEY.")
        payload = {"model": model or MODEL, "messages": messages, "max_tokens": max_tokens,
                   "temperature": temperature}
        if logprobs:
            payload.update(logprobs=True, top_logprobs=top_logprobs or 20)
        timeout = aiohttp.ClientTimeout(total=120)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post("https://api.openai.com/v1/chat/completions", json=payload,
                                    headers={"Authorization": f"Bearer {key}"}) as response:
                data = await response.json()
                if response.status >= 400:
                    message = data.get("error", {}).get("message", f"OpenAI returned {response.status}")
                    raise RuntimeError(message)
                return data


gateway = OpenAIGateway()
app = FastAPI(title="AI4Law Simulator", docs_url=None, redoc_url=None)
app.mount("/assets", StaticFiles(directory=ROOT / "web"), name="assets")


class ClassifyBody(BaseModel):
    text: str
    labels: list[str]
    instruction: Optional[str] = None


class CompareBody(BaseModel):
    text: str
    labels: list[str]
    context: str = ""


class BeamBody(BaseModel):
    prompt: str
    temperature: float = Field(default=1.0, ge=0.01, le=2.0)
    k: int = 3
    top_p: float = 0.9
    depth: int = 6
    beam_width: int = 10
    min_length: int = 2


@app.get("/")
@app.get("/simulator")
async def simulator():
    return FileResponse(ROOT / "web" / "index.html")


@app.get("/api/probes/availability")
async def availability():
    return {"available": bool(os.getenv("OPENAI_API_KEY")),
            "reason": "Server is missing OPENAI_API_KEY." if not os.getenv("OPENAI_API_KEY") else "",
            "model": MODEL}


@app.post("/api/probes/classify")
async def classify_route(body: ClassifyBody):
    try:
        return await classify(gateway, text=body.text, labels=body.labels,
                              instruction=body.instruction, model=MODEL)
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/probes/compare")
async def compare_route(body: CompareBody):
    try:
        a, b = await __import__("asyncio").gather(
            classify(gateway, text=body.text, labels=body.labels, model=MODEL),
            classify(gateway, text=body.text, labels=body.labels,
                     instruction=body.context, model=MODEL),
        )
        return {"a": a, "b": b, "label_a": "Context off", "label_b": "Context on"}
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/probes/beam")
async def beam_route(body: BeamBody):
    try:
        return await beam_search(gateway, prompt=body.prompt, k=3,
                                 temperature=body.temperature, top_p=0.9,
                                 depth=body.depth, beam_width=body.beam_width,
                                 min_length=body.min_length, model=MODEL)
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc
