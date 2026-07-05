"""
NVIDIA-powered chatbot backend.

Serves the mobile frontend and proxies chat requests to NVIDIA's
OpenAI-compatible inference API (https://integrate.api.nvidia.com),
streaming tokens back to the browser over Server-Sent Events (SSE).
"""

import json
import os

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
NVIDIA_API_KEY = os.environ.get("NVIDIA_API_KEY", "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").strip()
NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
DEFAULT_MODEL = os.environ.get("NVIDIA_MODEL", "meta/llama-3.1-70b-instruct")
DEFAULT_TEMPERATURE = float(os.environ.get("NVIDIA_TEMPERATURE", "0.6"))
DEFAULT_MAX_TOKENS = int(os.environ.get("NVIDIA_MAX_TOKENS", "1024"))
SYSTEM_PROMPT = os.environ.get(
    "SYSTEM_PROMPT",
    "You are a helpful, friendly assistant speaking to someone on their phone. "
    "Keep answers clear, well formatted, and no longer than they need to be.",
)
MAX_HISTORY_MESSAGES = int(os.environ.get("MAX_HISTORY_MESSAGES", "30"))

FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend"
)

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(FRONTEND_DIR, path)


# ---------------------------------------------------------------------------
# Health / config check (frontend uses this to show a "not configured" state)
# ---------------------------------------------------------------------------
@app.route("/api/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "configured": bool(NVIDIA_API_KEY),
            "model": DEFAULT_MODEL,
        }
    )


# ---------------------------------------------------------------------------
# Chat endpoint — streams NVIDIA's response back as SSE
# ---------------------------------------------------------------------------
def build_payload(messages, model, temperature, max_tokens):
    """Trim history, prepend the system prompt, shape the NVIDIA payload."""
    trimmed = messages[-MAX_HISTORY_MESSAGES:]
    chat_messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in trimmed:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            chat_messages.append({"role": role, "content": content})

    return {
        "model": model or DEFAULT_MODEL,
        "messages": chat_messages,
        "temperature": temperature,
        "top_p": 0.9,
        "max_tokens": max_tokens,
        "stream": True,
    }


@app.route("/api/chat", methods=["POST"])
def chat():
    if not NVIDIA_API_KEY:
        return (
            jsonify(
                {
                    "error": "Server is missing NVIDIA_API_KEY. "
                    "Add it to backend/.env and restart the server."
                }
            ),
            500,
        )

    body = request.get_json(force=True, silent=True) or {}
    messages = body.get("messages", [])
    model = body.get("model") or DEFAULT_MODEL
    temperature = float(body.get("temperature", DEFAULT_TEMPERATURE))
    max_tokens = int(body.get("max_tokens", DEFAULT_MAX_TOKENS))

    if not messages:
        return jsonify({"error": "No messages provided."}), 400

    payload = build_payload(messages, model, temperature, max_tokens)
    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }

    def generate():
        try:
            with requests.post(
                NVIDIA_API_URL, headers=headers, json=payload, stream=True, timeout=60
            ) as resp:
                if resp.status_code != 200:
                    detail = resp.text[:300]
                    yield _sse(
                        {"error": f"NVIDIA API error {resp.status_code}: {detail}"}
                    )
                    yield "data: [DONE]\n\n"
                    return

                for line in resp.iter_lines(decode_unicode=True):
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[len("data: "):].strip()
                    if data_str == "[DONE]":
                        yield "data: [DONE]\n\n"
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = chunk["choices"][0]["delta"].get("content", "")
                        if delta:
                            yield _sse({"content": delta})
                    except (KeyError, IndexError, json.JSONDecodeError):
                        continue

        except requests.exceptions.RequestException as exc:
            yield _sse({"error": f"Connection error: {exc}"})
            yield "data: [DONE]\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
