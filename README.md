# AI4Law Simulator

A standalone teaching simulator with two views: Token Probabilities and Branching Tree. Students can select and edit the included prompts for a session; edits are held in the browser and are never saved to a shared list.

## Run locally

1. Install Python 3.11 or newer.
2. Create an environment and install dependencies: `python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`.
3. Set `OPENAI_API_KEY` in your shell (or copy `.env.example` to `.env` and export its values).
4. Start the app: `PYTHONPATH=backend uvicorn app:app --app-dir backend --reload`.
5. Open [http://localhost:8000/simulator](http://localhost:8000/simulator).

The backend uses OpenAI Chat Completions with log probabilities. `OPENAI_MODEL` defaults to `gpt-4o-mini`. Keep API credentials on the server; do not put them in browser code.

## Docker

Set `OPENAI_API_KEY`, then run `docker build -t ai4law-simulator . && docker run --rm -p 8000:8000 -e OPENAI_API_KEY ai4law-simulator`.
