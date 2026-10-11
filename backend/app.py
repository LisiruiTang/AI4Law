import os
from typing import Optional

import aiohttp
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from probes.token_probs import classify, compare
from probes.name_contexts import name_contexts
from probes.beam_search import beam_search

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"]
OPENROUTER_MODELS = [OPENROUTER_MODEL, "mistralai/mistral-nemo"]

def logprobs_backend():
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    if os.getenv("OPENROUTER_API_KEY"):
        return "openrouter"
    return None

def default_model(backend):
    return OPENROUTER_MODEL if backend == "openrouter" else OPENAI_MODEL


class OpenAIGateway:
    async def chat_completion(self, *, messages, backend="openai", model=None, max_tokens=1,
                              temperature=1.0, logprobs=False, top_logprobs=None, **kwargs):
        if backend == "openrouter":
            key = os.getenv("OPENROUTER_API_KEY")
            endpoint = "https://openrouter.ai/api/v1/chat/completions"
            model = model or OPENROUTER_MODEL
        else:
            key = os.getenv("OPENAI_API_KEY")
            endpoint = "https://api.openai.com/v1/chat/completions"
            model = model or OPENAI_MODEL
        if not key:
            raise RuntimeError(f"Server is missing the {backend} API key.")
        payload = {"model": model, "messages": messages, "max_tokens": max_tokens,
                   "temperature": temperature}
        if logprobs:
            payload.update(logprobs=True, top_logprobs=top_logprobs or 20)
        if backend == "openrouter" and (logprobs or top_logprobs):
            payload["provider"] = {"require_parameters": True}
        timeout = aiohttp.ClientTimeout(total=120)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(endpoint, json=payload,
                                    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}) as response:
                data = await response.json()
                if response.status >= 400:
                    message = data.get("error", {}).get("message", f"{backend} returned {response.status}")
                    raise RuntimeError(message)
                return data


gateway = OpenAIGateway()
app = FastAPI(title="AI4Law Simulator", docs_url=None, redoc_url=None)

class ClassifyBody(BaseModel):
    text: str
    labels: list[str]
    instruction: Optional[str] = None
    model: Optional[str] = None


class CompareBody(BaseModel):
    text: str
    labels: list[str]
    instruction: Optional[str] = None
    model: Optional[str] = None
    block_text: str = ""
    block_text_b: Optional[str] = None
    model_b: Optional[str] = None


class BeamBody(BaseModel):
    prompt: str
    temperature: float = Field(default=1.0, ge=0.01, le=2.0)
    k: int = 3
    top_p: float = 0.9
    depth: int = 6
    beam_width: int = 10
    min_length: int = 2
    model: Optional[str] = None


@app.get("/health")
async def health():
    return {"status": "ok", "service": "AI4Law Simulator API"}


@app.get("/api/probes/availability")
async def availability():
    backend = logprobs_backend()
    available = backend is not None
    return {"available": available,
            "reason": "The backend needs an OPENAI_API_KEY or OPENROUTER_API_KEY." if not available else "",
            "problem": "none" if available else "no_key", "backend": backend,
            "models": OPENROUTER_MODELS if backend == "openrouter" else OPENAI_MODELS,
            "models_are_suggestions": backend == "openrouter", "model": default_model(backend)}


@app.post("/api/probes/classify")
async def classify_route(body: ClassifyBody):
    backend = logprobs_backend()
    if not backend:
        raise HTTPException(503, "Token probabilities need an OPENAI_API_KEY or OPENROUTER_API_KEY.")
    try:
        return await classify(gateway, text=body.text, labels=body.labels,
                              instruction=body.instruction, model=body.model or default_model(backend),
                              backend=backend)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/probes/compare")
async def compare_route(body: CompareBody):
    backend = logprobs_backend()
    if not backend:
        raise HTTPException(503, "Token probabilities need an OPENAI_API_KEY or OPENROUTER_API_KEY.")
    try:
        return await compare(gateway, text=body.text, labels=body.labels,
                             instruction=body.instruction, model=body.model or default_model(backend),
                             block_text=body.block_text, block_text_b=body.block_text_b,
                             model_b=body.model_b, backend=backend)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/probes/name-contexts")
async def name_contexts_route(body: dict):
    try:
        return await name_contexts(gateway, body.get("context_a", ""), body.get("context_b", ""))
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/probes/beam")
async def beam_route(body: BeamBody):
    backend = logprobs_backend()
    if not backend:
        raise HTTPException(503, "Branching Tree needs an OPENAI_API_KEY or OPENROUTER_API_KEY.")
    try:
        return await beam_search(gateway, prompt=body.prompt, k=body.k,
                                 temperature=body.temperature, top_p=body.top_p,
                                 depth=body.depth, beam_width=body.beam_width,
                                 min_length=body.min_length, model=body.model or default_model(backend),
                                 backend=backend)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc
