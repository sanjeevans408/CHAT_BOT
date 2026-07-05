# Nemo — NVIDIA-powered mobile chatbot

A mobile-first AI chat app. Python (Flask) backend streams responses from
NVIDIA's hosted inference API (build.nvidia.com); the frontend is plain
HTML/CSS/JS with no build step.

## Project structure

```
nvidia-chatbot/
├── backend/
│   ├── app.py            Flask server + NVIDIA API proxy (streaming)
│   ├── requirements.txt
│   └── .env.example      Copy to .env and fill in your key
└── frontend/
    ├── index.html
    ├── style.css
    └── script.js
```

## 1. Get an NVIDIA API key

1. Go to https://build.nvidia.com
2. Sign in and open any model page
3. Click **Get API Key** — copy the key (starts with `nvapi-`)

## 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` and paste your key:

```
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxx
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
```

You can swap `NVIDIA_MODEL` for any model id listed on build.nvidia.com
(e.g. `nvidia/llama-3.1-nemotron-70b-instruct`, `mistralai/mixtral-8x22b-instruct-v0.1`).

## 3. Install & run

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python3 app.py
```

Open **http://localhost:5000** — on a phone this is a full-screen chat app;
on desktop it renders as a centered phone-sized frame (mobile is the only
supported layout by design).

To try it on your actual phone while developing, run the server, then
visit `http://<your-computer's-LAN-IP>:5000` from your phone (same Wi-Fi).

## How it works

- **Frontend** sends the full message history to `POST /api/chat`.
- **Backend** prepends a system prompt, forwards the request to
  `https://integrate.api.nvidia.com/v1/chat/completions` with `stream: true`,
  and re-streams tokens to the browser as Server-Sent Events.
- The browser renders tokens as they arrive (typewriter effect), shown with
  a small animated "compute meter" while waiting for the first token.
- Chat history is kept in the browser's `localStorage` so it survives a
  refresh; use the reset button in the header to start a new conversation.

## Notes on "advanced design"

- Streaming proxy (not a blocking request) for a responsive feel on mobile networks.
- Server-side history trimming (`MAX_HISTORY_MESSAGES`) to control token usage.
- Central `/api/health` check so the UI can tell the user if the key is missing,
  instead of failing silently on first message.
- Clean separation: backend never ships the API key to the browser.

## Deploying

Any host that runs Python works (Render, Railway, Fly.io, a VPS, etc.).
For production, run with gunicorn instead of the Flask dev server:

```bash
gunicorn -w 2 -k gthread --threads 4 -b 0.0.0.0:5000 app:app
```

Make sure `NVIDIA_API_KEY` is set as an environment variable on the host
(don't commit your `.env` file).
