# Sequence

Sequence supports two modes:

- Local multiplayer on one device
- Online room hosting with invite links

## Local run

```bash
npm install
npm start
```

Open `http://127.0.0.1:3000`.

## Internet deployment without Redis

This repo is set up for a single long-running Node web service. Deploy it to a platform like Render instead of Vercel if you do not want Redis.

1. Push the repo to GitHub.
2. Create a new Render Web Service from the repo.
3. Use the included `render.yaml`, or set:
   - Build command: `npm install`
   - Start command: `npm start`
4. Deploy.

The app keeps room state in server memory, so it works without Redis on platforms that keep one Node process running.

## Important limitation

In-memory room state is lost when the server restarts or redeploys. That is acceptable for casual rooms, but not for durable matchmaking.
