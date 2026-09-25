import { requirePageAccess } from "@/lib/viewer";
import Builder from "./builder";

export default async function Page() {
  // In open mode this is a pass-through (viewer is null). In invite mode it
  // redirects signed-out visitors to /login and waitlisted ones to /waitlist.
  const viewer = await requirePageAccess("/");
  return <Builder viewer={viewer} />;
}
