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

## Configure the model API key

The Simulator page opens without an API key, but model requests need either `OPENAI_API_KEY` or `OPENROUTER_API_KEY` in the backend environment. Token-probability probes require token log-probabilities; Anthropic models do not provide them for these measurements.

The person who owns and runs the Codespace should add the key once. Students using that same running Simulator page do not need to enter a key or create their own Codespaces.

1. Create an API key with your chosen provider (OpenAI or OpenRouter).
2. Open [GitHub Codespaces secrets](https://github.com/settings/codespaces) while signed in to the GitHub account that owns the Codespace.
3. Under **Secrets and variables → Codespaces**, choose **New secret** (or **New repository secret**).
4. For **Name**, enter exactly `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. For **Value**, paste your provider key.
5. Set repository access to **Selected repositories**, select **LisiruiTang/AI4Law**, and save the secret.
6. Stop the current Codespace, then start it again from **Code → Codespaces**. The key is injected when the Codespace starts; restarting only the backend process will not load a newly added secret.
7. Open the forwarded **AI4Law Simulator** port (3000) and try the model request again.

GitHub keeps this secret outside the repository. Never put the real key in source files, this README, a Codespaces terminal command, or a chat message. Provider API usage is billed separately from Codespaces. If each person creates a separate Codespace, each Codespace owner must configure a key available to that Codespace, and provider usage is billed to that key's account.

See [GitHub's guide to managing Codespaces secrets](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces) for details.

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
