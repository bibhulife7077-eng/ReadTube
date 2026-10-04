# Deploy ReadTube

Production build command: `npm run build`.

The build writes the Vercel Build Output API to `.vercel/output`. Leave the Output Directory empty. Do not commit secrets or a `.env` file. Set the variables below in the host before the first deploy. `DATABASE_URL` must be present during the build, because that is when database migrations run.

## Vercel project settings

| Setting | Value |
|---|---|
| Framework | Other (`vercel.json` already sets this) |
| Node.js | 22 |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output Directory | empty |

## Required environment variables

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. A Neon pooled URL is fine. |
| `BETTER_AUTH_SECRET` | Random string, at least 32 characters. Signs the session cookie. |
| `BETTER_AUTH_URL` | Public site origin only, such as `https://your-domain.vercel.app`. No path and no trailing slash. |
| `GROK_AUTH_ISSUER` | Auth broker. Use `https://auth.grok.me` unless you were given another issuer. Required for Google sign-in. |
| `GROK_AUTH_CLIENT_ID` | Per-app OAuth client. The preview client does not accept a deployed callback. Required for Google sign-in. |
| `GROK_AUTH_CLIENT_SECRET` | Secret for that client. Required for Google sign-in. |

## Optional environment variables

| Name | Purpose |
|---|---|
| `VITE_AUTH_ENABLED` | Leave unset. Set to `false` only to turn sign-in off. |
| `YOUTUBE_PROXY_URL` | HTTP proxy for YouTube caption requests. Vercel cannot run yt-dlp, and YouTube often blocks Vercel’s servers. |
| `WEBSHARE_PROXY_USERNAME` | Used with `WEBSHARE_PROXY_PASSWORD` when `YOUTUBE_PROXY_URL` is not set. |
| `WEBSHARE_PROXY_PASSWORD` | Password for the Webshare proxy. |

## Injected by Vercel — do not set these

`VERCEL`, `VERCEL_URL`, and `VERCEL_PROJECT_PRODUCTION_URL` are set by the platform. If `BETTER_AUTH_URL` is missing, sign-in falls back to the project’s production host.

## Auth callback

Google sign-in returns to:

```
https://YOUR_DOMAIN/api/auth/oauth2/callback/grok-google
```

`YOUR_DOMAIN` is the host in `BETTER_AUTH_URL`. Open the site on that exact origin. After you attach a custom domain, change `BETTER_AUTH_URL` to the new origin and redeploy.

## Checklist

1. Create a Postgres database and copy its connection string.
2. Push this repository to GitHub.
3. Import it on Vercel with the settings above.
4. Add the required environment variables.
5. Deploy.
6. Open `BETTER_AUTH_URL`.
7. Sign in with Google once.
8. Paste a public YouTube link and generate a transcript.

A plan that rejects a 60-second function timeout will fail the deploy. The timeout is set in `vite.config.ts` (`vercel.functions.maxDuration`). Lower it to the plan’s cap and deploy again.
