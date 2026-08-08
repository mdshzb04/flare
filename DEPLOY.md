# Deploy Flare on Zerops (~20 min)

## Blocker right now

`zcli` installed, **not logged in**. Do this first:

1. Open https://app.zerops.io → Access Token (or Settings → Tokens)
2. Copy token
3. Run:

```bash
export PATH="$HOME/.local/bin:$PATH"
zcli login PASTE_TOKEN_HERE
```

4. Come back and say **"deploy now"** — agent runs import + push.

## Manual path (if you prefer UI)

1. Create project **flare** in Zerops  
2. Project → Import → paste [`import-services.yml`](./import-services.yml)  
3. Enable subdomain / public HTTP on **api** and **frontend**  
4. Note api public URL (e.g. `https://api-xxxx.zerops.app`)  
5. On **frontend** service env set:
   - `API_PUBLIC_URL` = `https://api-xxxx.zerops.app` (no slash)
   - `WS_PUBLIC_URL` = `wss://api-xxxx.zerops.app/ws`  
6. Push code:

```bash
cd /home/mohammed-shazeb/Desktop/WMD
zcli push --service api --setup api
zcli push --service worker --setup worker
zcli push --service frontend --setup frontend
```

7. Open frontend URL → create room → two-tab test  
8. Paste live URL into [`SUBMISSION.md`](./SUBMISSION.md)

## Local smoke (already verified)

```bash
docker compose up -d   # use DOCKER_CONFIG=/tmp/docker-noreds if credsStore broken
bun run check
# api + worker running → POST /api/rooms + upload → thumbUrl set
```
