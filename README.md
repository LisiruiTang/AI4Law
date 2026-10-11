# AI4Law Simulator

AI4Law Simulator is a browser-based teaching tool with two views: **Token Probabilities** and **Branching Tree**. You can edit prompts during a session; your edits stay in your browser and are not saved for the next person.

## Open the simulator in GitHub Codespaces

You do not need to install anything on your computer. Codespaces runs the app in a GitHub-hosted development environment, which you open in your browser.

1. Sign in to GitHub and open this repository.
2. Select **Code**, then **Codespaces**.
3. Select **Create codespace on main** and wait for the Codespaces window to finish loading.
4. In the Codespaces window, open **Terminal → New Terminal**.
5. Copy and run these commands in the terminal:

   ```bash
   python -m pip install -r requirements.txt
   python -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port 8000
   ```

6. When GitHub asks whether to make port **8000** available, select **Open in Browser**. If no message appears, select the **Ports** tab at the bottom of the Codespaces window, then select the globe icon next to port **8000**.
7. The simulator opens in a new browser tab. Keep the Codespaces window running while you use it.

### Using model features

The pages can open without an API key, but actions that request model output need an OpenAI API key. Each person running their own Codespace must provide their own key; this repository does not contain one.

To add your key securely, open your GitHub **Settings → Codespaces → Secrets**, create a secret named `OPENAI_API_KEY`, and grant it access to this repository. Then stop and restart your Codespace, open a new terminal, and run the commands above. Do not paste an API key into this README, a source file, or a message to other people. OpenAI API usage is billed separately from GitHub Codespaces.

### If the Codespace stops

Codespaces may stop after being idle. Return to the repository, select **Code → Codespaces**, and reopen your Codespace. If the app is no longer running, open a new terminal and run:

```bash
python -m uvicorn app:app --app-dir backend --host 0.0.0.0 --port 8000
```

Then open port **8000** from the **Ports** tab again. GitHub Codespaces usage is subject to the monthly allowance and spending settings on the account that created the Codespace.

## Access to this repository

If this repository is private, you must be invited to access it before you can create a Codespace. For a repository owned by a personal GitHub account, collaborators have read and write access to the repository. If you only need to use the simulator and do not need to see or edit its code, ask the repository owner for a direct simulator link instead.

## Run locally (optional)

If you prefer to run the app on your own computer, install Python 3.11 or newer, then run:

```bash
python -m pip install -r requirements.txt
OPENAI_API_KEY="your-key" python -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000
```

Open [http://localhost:8000/simulator](http://localhost:8000/simulator). Keep your API key private and replace `your-key` only in your local terminal; do not commit it to GitHub.

## Docker (optional)

```bash
docker build -t ai4law-simulator .
docker run --rm -p 8000:8000 -e OPENAI_API_KEY ai4law-simulator
```

The backend uses OpenAI Chat Completions with log probabilities. `OPENAI_MODEL` defaults to `gpt-4o-mini`. Keep API credentials on the server; do not put them in browser code.
