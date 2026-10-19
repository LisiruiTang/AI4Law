import os
from typing import Optional

import aiohttp
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from probes.token_probs import classify, compare
from probes.beam_search import beam_search, beam_variations
import portal

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


class PasswordBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class AdminLoginBody(PasswordBody):
    username: str = Field(min_length=1, max_length=40)


class ExampleBody(BaseModel):
    kind: str
    name: str
    note: str = ""
    config: dict
    version: Optional[int] = None


def set_session_cookie(response: Response, token: str, ttl: int):
    response.set_cookie(
        portal.COOKIE_NAME, token, max_age=ttl, httponly=True, samesite="lax",
        secure=os.getenv("AI4LAW_SECURE_COOKIES") == "1", path="/",
    )


@app.get("/api/auth/session")
async def auth_session(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    session = portal.get_session(request)
    required = portal.password_required()
    return {"access": bool(session) or not required,
            "role": session["role"] if session else ("public" if not required else None),
            "username": session["username"] if session else None,
            "password_required": required}


@app.post("/api/auth/student")
async def student_login(body: PasswordBody, request: Request, response: Response):
    portal.same_origin(request)
    if not portal.password_required():
        raise HTTPException(409, "A simulator password has not been configured yet.")
    key = "student:" + portal.client_identity(request)
    portal.check_login_limit(key)
    if not portal.verify_student_password(body.password):
        portal.record_login_failure(key)
        raise HTTPException(401, "Incorrect simulator password.")
    portal.clear_login_failures(key)
    portal.delete_session(request.cookies.get(portal.COOKIE_NAME))
    token, ttl = portal.create_session("student")
    set_session_cookie(response, token, ttl)
    response.headers["Cache-Control"] = "no-store"
    return {"access": True, "role": "student"}


@app.post("/api/auth/admin")
async def admin_login(body: AdminLoginBody, request: Request, response: Response):
    portal.same_origin(request)
    key = "admin:" + body.username + ":" + portal.client_identity(request)
    portal.check_login_limit(key)
    admin_id = portal.verify_admin(body.username, body.password)
    if admin_id is None:
        portal.record_login_failure(key)
        raise HTTPException(401, "Incorrect administrator username or password.")
    portal.clear_login_failures(key)
    portal.delete_session(request.cookies.get(portal.COOKIE_NAME))
    token, ttl = portal.create_session("admin", admin_id)
    set_session_cookie(response, token, ttl)
    response.headers["Cache-Control"] = "no-store"
    return {"access": True, "role": "admin", "username": body.username}


@app.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    portal.same_origin(request)
    portal.delete_session(request.cookies.get(portal.COOKIE_NAME))
    response.delete_cookie(portal.COOKIE_NAME, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"access": False}


@app.get("/api/examples")
async def examples(response: Response, kind: Optional[str] = None,
                   _session=Depends(portal.require_access)):
    response.headers["Cache-Control"] = "no-store"
    return portal.list_examples(kind)


@app.post("/api/admin/examples")
async def add_example(body: ExampleBody, request: Request,
                      _session=Depends(portal.require_admin)):
    portal.same_origin(request)
    return portal.create_example(body.kind, body.name, body.note, body.config)


@app.put("/api/admin/examples/{example_id}")
async def edit_example(example_id: int, body: ExampleBody, request: Request,
                       _session=Depends(portal.require_admin)):
    portal.same_origin(request)
    if body.version is None:
        raise HTTPException(422, "Example version is required.")
    return portal.update_example(example_id, body.version, body.kind, body.name,
                                 body.note, body.config)


@app.delete("/api/admin/examples/{example_id}")
async def remove_example(example_id: int, version: int, request: Request,
                         _session=Depends(portal.require_admin)):
    portal.same_origin(request)
    portal.delete_example(example_id, version)
    return {"deleted": True}


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
    k: int = 3
    temperature: float = Field(default=1.0, gt=0, le=2)
    top_p: float = Field(default=0.9, gt=0, le=1)
    depth: int = 6
    beam_width: int = 10
    min_length: int = 2
    model: Optional[str] = None


@app.get("/health")
async def health():
    return {"status": "ok", "service": "AI4Law Simulator API"}


@app.get("/api/probes/availability")
async def availability(_session=Depends(portal.require_access)):
    backend = logprobs_backend()
    available = backend is not None
    return {"available": available,
            "reason": "The backend needs an OPENAI_API_KEY or OPENROUTER_API_KEY." if not available else "",
            "problem": "none" if available else "no_key", "backend": backend,
            "models": OPENROUTER_MODELS if backend == "openrouter" else OPENAI_MODELS,
            "models_are_suggestions": backend == "openrouter", "model": default_model(backend)}


@app.post("/api/probes/classify")
async def classify_route(body: ClassifyBody, _session=Depends(portal.require_access)):
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
async def compare_route(body: CompareBody, _session=Depends(portal.require_access)):
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


@app.post("/api/probes/beam")
async def beam_route(body: BeamBody, _session=Depends(portal.require_access)):
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


@app.post("/api/probes/beam/variations")
async def beam_variations_route(body: BeamBody, _session=Depends(portal.require_access)):
    backend = logprobs_backend()
    if not backend:
        raise HTTPException(503, "Branching Tree needs an OPENAI_API_KEY or OPENROUTER_API_KEY.")
    try:
        return await beam_variations(
            gateway, prompt=body.prompt, k=body.k, depth=body.depth, beam_width=body.beam_width,
            min_length=body.min_length, model=body.model or default_model(backend),
            backend=backend,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc
