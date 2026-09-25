-- Local development seeds. Runs after migrations on `supabase db reset`.

-- Vault secrets the notify_access_granted trigger reads. The database runs in
-- a container, so the app URL points at host.docker.internal (the Mac) rather
-- than localhost. Start the app with the same webhook secret:
--   ACCESS_WEBHOOK_SECRET=local-access-webhook-secret npm run dev
delete from vault.secrets where name in ('app_url', 'access_webhook_secret');
select vault.create_secret('http://host.docker.internal:3000', 'app_url', 'URL of the app for the access-granted webhook');
select vault.create_secret('local-access-webhook-secret', 'access_webhook_secret', 'Bearer secret for the access-granted webhook');
