# Parental Control (demo)

This folder implements a minimal TypeScript-based backend and a tiny frontend demo for the Parent-Child linking and parental control onboarding flow.

Quick start:

1. cd parental-control
2. npm install
3. npm run dev

Server runs on http://localhost:3333 and serves `/api` routes and the demo UI.

Notes:
- Verification codes are stored in the JSON DB for demo purposes. In production, send emails via an encrypted SMTP provider.
- Database is a simple file `src/database.json`.
