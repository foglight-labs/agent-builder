export type Preset = { label: string; text: string };

/** Example tasks shown as one-click presets above the task field. */
export const presets: Preset[] = [
  { label: "Set up auth", text: "Add email/password and Google OAuth authentication to my app" },
  { label: "Add product analytics", text: "Add privacy-friendly product analytics to track key user actions" },
  { label: "Improve SEO", text: "Improve my website's SEO with meta tags, a sitemap, and structured data" },
  { label: "Write onboarding emails", text: "Create an automated onboarding email sequence for new signups" },
];
