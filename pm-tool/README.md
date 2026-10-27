# Tidewell — project management tool
React (Vite) + Express + SQLite (better-sqlite3) + Socket.IO + JWT. Requires Node 18+.

## Local setup
```bash
cd server && cp .env.example .env     # set JWT_SECRET to a long random string
npm install && npm run seed           # optional demo data (DEV ONLY: alice@demo.local / bob@demo.local, password demo1234)
npm run dev                           # API + sockets on :4000
# second terminal
cd client && npm install && npm run dev   # http://localhost:5173
```
Test real-time + isolation: log in as Alice and Bob in two browsers, move a card in one and watch the other update; register a third user and confirm they cannot see the project (404).

## Deploy (Render, one web service; supports WebSockets)
1. Push to GitHub: `git init && git add . && git commit -m "init" && git branch -M main && git remote add origin <url> && git push -u origin main`
2. Render → New Web Service → repo. Build: `npm run build`. Start: `npm start`.
3. Add a persistent disk mounted at `/var/data`. Env: `JWT_SECRET` (random), `DB_FILE=/var/data/data.db`, `CLIENT_ORIGIN=https://<your-service>.onrender.com`.
4. The server serves the built client, so frontend and API share one URL.

## API (all under /api, JWT in `Authorization: Bearer`)
Auth: POST /auth/register, POST /auth/login, GET|PATCH /me · GET /dashboard
Projects: GET|POST /projects (?q,limit,offset) · GET|PATCH|DELETE /projects/:id · POST /projects/:id/members
Columns: POST /projects/:id/columns · DELETE /columns/:id
Tasks: POST /projects/:id/tasks · PATCH|DELETE /tasks/:id (PATCH with column_id+position moves/reorders)
Comments: GET|POST /tasks/:id/comments · DELETE /comments/:id
Notifications: GET /notifications · POST /notifications/read
Roles: owner > admin > member > viewer (viewer is read-only; columns/invites need admin).

## Troubleshooting
- `JWT_SECRET` error on start: create `server/.env`.
- `better-sqlite3` build errors: use Node 18/20 LTS.
- Sockets not connecting in dev: run the API on :4000 (Vite proxies `/socket.io`).
