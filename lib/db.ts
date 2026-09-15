import postgres from "postgres";

// One DATABASE_URL works for both targets:
//   local:    postgres://skills_reader:<pw>@localhost:5432/skills
//   Supabase: postgres://skills_reader.<ref>:<pw>@aws-<region>.pooler.supabase.com:6543/postgres?sslmode=require
// postgres.js reads `sslmode` from the URL; `prepare: false` is required by
// Supabase's transaction pooler and harmless elsewhere.

declare global {
  // eslint-disable-next-line no-var
  var __skillsSql: postgres.Sql | undefined;
}

export function getSql(): postgres.Sql {
  if (!globalThis.__skillsSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__skillsSql = postgres(url, { prepare: false, max: 5 });
  }
  return globalThis.__skillsSql;
}
