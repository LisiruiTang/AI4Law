# AI4Law Simulator

A focused simulator with two activities: **Token Probabilities** and **Branching Tree**. The Codespaces interface and API use the same simulator components and probe calculations as the local `/simulator` page. Student edits are temporary and are not saved for the next person.

## Open in GitHub Codespaces

No software installation is needed on your computer.

1. Open this repository on GitHub and choose **Code → Codespaces → Create codespace on main**.
2. Wait for setup to finish. The Codespace installs the Python and web dependencies and starts both the API and the simulator page.
3. Open the forwarded port labeled **AI4Law Simulator** (port 3000). This is the page students use.

The frontend runs on port 3000. Its requests are forwarded to the FastAPI backend on port 8000. Keep the Codespace running while the page is in use. If the Codespace stops, reopen it from **Code → Codespaces**; startup will relaunch both services.

## OpenAI API key

The page can load without a key, but model requests need `OPENAI_API_KEY` or `OPENROUTER_API_KEY` on the backend. Add your chosen key as a Codespaces secret in your GitHub account and enable it for this repository, then restart the Codespace. Each person who creates their own Codespace needs a secret available to that Codespace. The key stays on the backend and is never sent to browser JavaScript or committed to this repository. Provider usage is billed separately from Codespaces.

Do not paste the key into source files, this README, or a chat message.

## Run on your computer (optional)

Install Python 3.11+ and Node.js 20+. From the repository root, install dependencies:

```bash
python -m pip install -r requirements.txt
cd frontend && npm install
```

Set `OPENAI_API_KEY` in your local environment, then start the API in one terminal:

```bash
python -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port 8000
```

Start the web page in a second terminal:

```bash
cd frontend && npm run dev
```

Open [http://localhost:3000/simulator](http://localhost:3000/simulator).
