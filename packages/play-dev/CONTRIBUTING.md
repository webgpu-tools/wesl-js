# Contributing to play-dev

`play-dev` is the source for **wgsl-play.dev**: a static SPA (Vite +
Preact) plus a small Cloudflare **Worker** (`play-auth`) that performs the
GitHub OAuth token exchange. The two are **independent deploy targets**.
The SPA talks to the *deployed* Worker over HTTPS. Its URL is hardcoded
in `src/auth/Callback.ts` (`workerUrl`).

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Run the SPA locally on http://localhost:9111 (Vite) |
| `pnpm deploy:site` | Build the SPA and deploy it to Cloudflare Pages (`wgsl-play`) |
| `pnpm deploy:auth` | Deploy the `play-auth` Worker (`auth/wrangler.toml`) |
| `pnpm dev:auth` | Run the Worker locally on http://localhost:8787 |

## Local development

`pnpm dev` is all you need for day-to-day work, **including GitHub
sign-in**: because the SPA points at the deployed Worker, OAuth works
end-to-end on localhost:9111 without running the Worker locally.

Run `pnpm dev:auth` only when developing the Worker itself. To route the
local SPA at your local Worker you must also add secrets to
`auth/.dev.vars` (gitignored) and temporarily change `workerUrl` in
`src/auth/Callback.ts` to `http://localhost:8787` (there is no env switch
for this yet).

## Deploying

- **Front-end change** -> `pnpm deploy:site`. The Worker is already live;
  don't redeploy it for SPA changes.
- **Worker code or `auth/wrangler.toml` change** -> `pnpm deploy:auth`.
- **Adding/rotating a Worker secret** ->
  `pnpm wrangler secret put <NAME> --config auth/wrangler.toml`. Applies
  to the live Worker immediately; no `deploy:auth` needed.

If you change both the SPA and the Worker, deploy the Worker first so the
live SPA never calls an endpoint that isn't up yet.