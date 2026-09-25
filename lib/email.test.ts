import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendAccessGrantedEmail } from "@/lib/email";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.SITE_URL;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendAccessGrantedEmail", () => {
  it("logs and skips when RESEND_API_KEY is not set", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendAccessGrantedEmail("user@example.com", "User");

    expect(result).toEqual({ ok: false, reason: "no_api_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the branded email to Resend", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.SITE_URL = "https://try.foglight.co/";
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendAccessGrantedEmail("user@example.com", "User Name");

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: "Foglight <hello@foglight.co>",
      to: "user@example.com",
      subject: "You're in — Foglight",
    });
    expect(body.html).toContain("https://try.foglight.co"); // sign-in button, trailing slash stripped
    expect(body.html).toContain("User Name");
    expect(body.html).toContain("user@example.com");
    expect(body.text).toContain("https://try.foglight.co");
  });

  it("honours EMAIL_FROM and omits the button when SITE_URL is unset", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Foglight <noreply@example.com>";
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendAccessGrantedEmail("user@example.com", null);

    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.from).toBe("Foglight <noreply@example.com>");
    expect(body.html).not.toContain("Open Foglight</a>");
    expect(body.text).toContain("Hi,");
  });

  it("reports Resend failures instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 422 })));

    const result = await sendAccessGrantedEmail("user@example.com", null);

    expect(result).toEqual({ ok: false, reason: "resend_422" });
  });
});
