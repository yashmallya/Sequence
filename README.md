# Sequence Online

Multiplayer Sequence prototype for Vercel.

## Local

```bash
npm install
npx vercel dev
```

Open `http://127.0.0.1:3000`.

## Vercel Deployment

This app is serverless and expects a Redis database for persistent room state.

1. Create a Redis instance and copy its connection string into `REDIS_URL`.
2. In Vercel, add the `REDIS_URL` environment variable to the project.
3. Deploy the repo to Vercel.

Without `REDIS_URL`, multiplayer rooms are not durable on Vercel.

## Architecture

- Static frontend: `index.html`, `app.js`, `styles.css`
- Serverless API routes: `api/`
- Game rules engine: `game-engine.js`
- Room persistence: Redis in production, in-memory fallback outside Vercel
