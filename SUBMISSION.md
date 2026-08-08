# Submission pack — Flare

## Form fields (copy)

- **Project name:** Flare  
- **What it does:** Live multiplayer incident war-room. Share a link; severity, timeline notes, and presence sync across browsers. Screenshots go to object storage; a worker generates thumbnails.  
- **Live URL:** _(paste frontend Zerops URL)_  
- **API URL:** _(paste api Zerops URL)_  
- **Repository:** https://github.com/mdshzb04/flare  
- **How Zerops is used:** Six services — `frontend` (static), `api` (Bun/Hono + WebSocket), `worker` (Sharp thumbnails), `db` (PostgreSQL), `redis` (Valkey pub/sub + queue), `storage` (S3). Private networking between backends; only frontend + api public. Deploy via `zerops.yaml` + `import-services.yml`.  
- **AI tools used:** Cursor (Composer). Disclosed. Participant owns architecture and can explain every service.

## Social post (paste + edit URLs)

```
Built Flare for @WeMakeDevs @zeropsio — The Zerops Challenge

Live incident war-room: open two tabs, type once, both timelines sync. Severity flips live. Screenshots → object storage → worker thumbnails.

Stack on Zerops (6 services):
frontend · api (WS) · worker · Postgres · Valkey · object storage

Live: [URL]
Repo: [URL]
Demo: [video]

#ZeropsChallenge #WeMakeDevs
```

## Demo video script (~60s)

1. Home → “Open war-room”  
2. Copy link → open second tab, join as other name  
3. Type update in tab A → show tab B  
4. Change sev1 in A → show B  
5. Upload screenshot → wait for thumb  
6. Flash Architecture page (6 services)  
7. End card: live URL + repo  

Record with OBS / phone. Upload to YouTube unlisted or X/LinkedIn.

## Checklist

- [ ] Repo public (or judges invited)  
- [ ] Live URL stays up through judging  
- [ ] Social post with @WeMakeDevs @zeropsio  
- [ ] Official form submitted  
- [ ] AI disclosure checked  
- [ ] You can explain architecture out loud (practice 2 min)
