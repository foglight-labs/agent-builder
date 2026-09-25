import { afterEach, describe, expect, it, vi } from "vitest";
import { accessMode, safeNext, siteUrl, supabaseEnv } from "@/lib/access";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("accessMode", () => {
  it("defaults to open when ACCESS_MODE is unset", () => {
    delete process.env.ACCESS_MODE;
    expect(accessMode()).toBe("open");
  });

  it("reads open and invite case-insensitively", () => {
    process.env.ACCESS_MODE = "Invite";
    expect(accessMode()).toBe("invite");
    process.env.ACCESS_MODE = "open";
    expect(accessMode()).toBe("open");
  });

  it("fails closed as invite on unknown values", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.ACCESS_MODE = "public";
    expect(accessMode()).toBe("invite");
  });
});

describe("supabaseEnv", () => {
  it("is null unless both values are set", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect(supabaseEnv()).toBeNull();

    process.env.SUPABASE_URL = "http://localhost:54321";
    expect(supabaseEnv()).toBeNull();
  });

  it("returns both values with the URL's trailing slash stripped", () => {
    process.env.SUPABASE_URL = "https://abc.supabase.co/";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    expect(supabaseEnv()).toEqual({ url: "https://abc.supabase.co", publishableKey: "sb_publishable_x" });
  });
});

describe("siteUrl", () => {
  it("throws when unset so invite mode fails closed", () => {
    delete process.env.SITE_URL;
    expect(() => siteUrl()).toThrow(/SITE_URL/);
  });

  it("strips trailing slashes", () => {
    process.env.SITE_URL = "https://try.foglight.co/";
    expect(siteUrl()).toBe("https://try.foglight.co");
  });
});

describe("safeNext", () => {
  it("passes through relative paths with query strings", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/waitlist")).toBe("/waitlist");
    expect(safeNext("/oauth/consent?authorization_id=abc")).toBe("/oauth/consent?authorization_id=abc");
  });

  it("rejects missing and non-path values", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("evil.example")).toBe("/");
  });

  it("rejects protocol-relative and backslash host tricks", () => {
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/\\\\evil.example")).toBe("/");
  });

  it("rejects /login so sign-in can never redirect in a loop", () => {
    expect(safeNext("/login")).toBe("/");
    expect(safeNext("/login?next=/")).toBe("/");
    expect(safeNext("/login/extra")).toBe("/");
  });

  it("rejects overlong values", () => {
    expect(safeNext(`/${"a".repeat(600)}`)).toBe("/");
  });
});
