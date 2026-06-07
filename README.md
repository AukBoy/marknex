# MarkNex — AI-Based Personal Teacher Assistant

MarkNex automates marking of answer scripts (MCQ and essay/written) using a
multimodal LLM, flags low-confidence results for manual review, and generates
student reports and class analytics.

- **Backend:** Node.js + Express + SQLite, OpenAI (`gpt-4o`) for evaluation.
- **Frontend:** React + Vite.

## Prerequisites

- Node.js 18+ and npm
- An OpenAI API key

## Setup

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env        # then edit .env and set OPENAI_API_KEY + JWT_SECRET

# 2. Frontend
cd ../frontend
npm install
cp .env.example .env        # optional; only needed to point at a non-local API
```

## Run (development)

Run the backend and frontend in two terminals:

```bash
# Terminal 1
cd backend && npm start      # http://localhost:5000

# Terminal 2
cd frontend && npm run dev   # http://localhost:5173
```

A demo account is auto-created in development: **username `teacher`, password `password123`**
(disabled when `NODE_ENV=production`). You can also register a new account from the UI.

## Build & release (single port)

Build the frontend, then run the backend — it serves the built frontend from the
same port, so the whole app is available at `http://localhost:5000`.

```bash
cd frontend && npm run build
cd ../backend && NODE_ENV=production npm start
```

On Windows PowerShell, set the env var separately:

```powershell
cd backend
$env:NODE_ENV = "production"; npm start
```

## Configuration

### Backend (`backend/.env`)
| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | **Required.** Key for AI evaluation. |
| `JWT_SECRET` | Secret for signing auth tokens. Set a long random value in production. |
| `PORT` | Backend port (default `5000`). |
| `NODE_ENV` | `production` disables the auto-seeded demo account. |
| `CORS_ORIGIN` | Allowed origin(s), comma-separated. Unset = allow all (dev only). |

### Frontend (`frontend/.env`)
| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend base URL. Defaults to `http://localhost:5000`. |

## Security notes

- **Never commit `.env`.** It is gitignored. Rotate any key that has been exposed.
- Uploaded files and the SQLite database (`backend/marknex.db`) hold student data —
  keep them out of version control (already gitignored) and back them up securely.
