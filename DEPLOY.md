# Talkfree Deploy

## 1) Deploy Backend (Render)
- Create a new **Web Service** from this repo.
- Root Directory: `talkfree`
- Build Command: `npm install`
- Start Command: `npm start`
- Add env var:
  - `FRONTEND_ORIGIN=https://YOUR_NETLIFY_SITE.netlify.app`

After deploy, copy your backend URL, example:
- `https://talkfree-socket-server.onrender.com`

## 2) Configure Frontend Socket URL
Edit `talkfree/index.html` and set:

```html
<meta name="backend-url" content="https://talkfree-socket-server.onrender.com" />
```

## 3) Deploy Frontend (Netlify)
- New site from repo.
- Base directory: `talkfree`
- Build command: *(leave empty)*
- Publish directory: `talkfree`

Netlify will read `netlify.toml`.

## 4) Verify
- Open Netlify URL in 2 browsers/devices.
- Register two users and test private/group chat.

## Notes
- Current storage is in-memory. Data resets when backend restarts.
- For production, add a database and stronger auth/session persistence.
