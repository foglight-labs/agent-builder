# Supabase: the access wall

When `ACCESS_MODE=invite`, the app walls the UI, `/api/recommend`,
`/api/search`, and `/api/mcp` behind sign-in (Google or email) plus an
allowlist. This directory holds the local stack config, the `access_list`
migration, the branded email templates, and the local seed.

## One-time setup (hosted project)

1. **Create the project** at [supabase.com/dashboard](https://supabase.com/dashboard) (any plan; the OAuth 2.1 server is in beta and included on all plans). Use a dedicated project: its OAuth tokens are accepted by `/api/mcp`, and until Supabase supports RFC 8707 resource binding, a token from a shared project would work here too.
2. **Push the schema:**
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
3. **URLs** — Authentication → URL Configuration:
   - Site URL: `https://your-app-domain` (must equal the app's `SITE_URL`)
   - Redirect URLs: add `https://your-app-domain/**`
4. **Google sign-in** — Authentication → Sign In / Up → Google: create an OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`, shown on the provider page), then enable the provider with the client ID and secret.
5. **Email sending** — verify your domain in [Resend](https://resend.com/domains), then point Supabase's SMTP at it (Authentication → Emails → SMTP settings: `smtp.resend.com`, port 465/587, user `resend`, password = Resend API key, sender = your `EMAIL_FROM`). Paste the two templates from `supabase/templates/` into Authentication → Emails → Templates (Confirm signup and Magic Link; both use subject `Sign in to Foglight`). Each template carries both the sign-in link and the 6-digit code.
6. **OAuth 2.1 server** (for MCP clients) — Authentication → OAuth Server:
   - Enable it
   - Authorization URL path: `/oauth/consent`
   - Allow dynamic client registration: on (MCP clients register themselves on first connect)
7. **Approval webhook** — store the two Vault secrets the `access_list` trigger reads (SQL editor):
   ```sql
   select vault.create_secret('https://your-app-domain', 'app_url');
   select vault.create_secret('<long random string>', 'access_webhook_secret');
   ```
   Until both exist, approvals still work; the "You're in" email is just skipped.
8. **App env vars** (Railway → Variables, all server-side, read at runtime — nothing is baked into the Docker image):
   ```
   ACCESS_MODE=invite
   SITE_URL=https://your-app-domain
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # Settings → API; no secret key needed
   ACCESS_WEBHOOK_SECRET=<same string as the Vault secret>
   RESEND_API_KEY=re_...                          # for the "You're in" email
   EMAIL_FROM="Foglight <hello@your-domain>"      # optional
   ```

## Letting people in

In the Supabase Table Editor, `public.access_list`:

- **Pre-approve silently:** insert a row with the email and status `allowed`. No email is sent; they're in when they first sign in.
- **Approve a waitlisted person:** change their row's status from `waitlisted` to `allowed`. The trigger calls the app's webhook and they get the "You're in" email.
- **Revoke:** change the status back to `waitlisted` (their existing sessions keep working until the access token expires, max 1 hour) or delete the row.

Case doesn't matter; matching is case-insensitive.

## Local development

```bash
supabase start        # Postgres, Auth, Studio (127.0.0.1:54323), Mailpit (127.0.0.1:54324)
supabase db reset     # applies migrations + seed.sql (Vault secrets for the webhook)
```

App env (e.g. in `.env.local` or inline):

```bash
ACCESS_MODE=invite \
SITE_URL=http://localhost:3000 \
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_PUBLISHABLE_KEY=$(supabase status | awk '/Publishable/ {print $3}' | tr -d '│ ') \
ACCESS_WEBHOOK_SECRET=local-access-webhook-secret \
npm run dev
```

- Sign-in emails land in **Mailpit** at http://127.0.0.1:54324 — grab the 6-digit code or click the link.
- The seeded `app_url` is `http://host.docker.internal:3000`, so the database container can reach `next dev` on your Mac when an approval fires the webhook. Without `RESEND_API_KEY`, the app logs the email instead of sending it.
- **Google sign-in locally:** put your OAuth credentials in `supabase/.env` (gitignored):
  ```
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
  SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
  ```
  set `enabled = true` under `[auth.external.google]` in `config.toml`, and restart the stack. Leave it off to test email-only.

## How it fits together

- `proxy.ts` refreshes session cookies and redirects signed-out page requests to `/login`; it never touches the database.
- `lib/viewer.ts` verifies the JWT (`getClaims`) and asks Postgres for the caller's status (`get_my_access`, a security-definer function — the table itself has RLS on and no grants).
- Sign-in always calls `join_waitlist`, which creates a `waitlisted` row for new people and links accounts to pre-approved rows.
- `/api/mcp` takes bearer tokens from the project's OAuth 2.1 server; `/.well-known/oauth-protected-resource/api/mcp` points MCP clients at it.
