import { z } from "zod";
import { BUSINESS_SLUG, MAX_SLUG_CHARS } from "@/lib/chat/limits";

// A business's profile (US-10.1, 10.2): the rules shared by the admin form
// (counters, the slug suggestion) and the server (validation). The database
// enforces the same limits (migration business_profile). No server imports.

export const PROFILE_LIMITS = { name: 100, description: 500, guidelines: 2000, services: 50, serviceName: 120 } as const;

// The services customers can request a consultation for: one per line in the
// form. Trimmed, blank lines dropped, repeats (ignoring case) kept once.
export function parseServices(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter((line) => line && !seen.has(line.toLowerCase()) && seen.add(line.toLowerCase()));
}

// /admin/new is the create page, so no business can be called "new".
const RESERVED_SLUGS = new Set(["new"]);

// The form's list: every IANA timezone this browser knows. UTC isn't in
// Intl's list but is a valid choice.
export const TIMEZONES: readonly string[] = ["UTC", ...Intl.supportedValuesOf("timeZone")];

// Valid if it's a zone name ("Area/City") that Intl can use. Not "in the
// list above": a browser's list and the server's can name the same zone
// differently (Asia/Calcutta, Asia/Kolkata), and both are valid. A name, not
// an offset: Intl accepts "+05:00", which Postgres reads with the opposite
// sign.
function isTimeZone(tz: string): boolean {
  if (tz !== "UTC" && !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter the business name.").max(PROFILE_LIMITS.name, `Keep the name under ${PROFILE_LIMITS.name} characters.`),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a slug.")
    .max(MAX_SLUG_CHARS, `Keep the slug under ${MAX_SLUG_CHARS} characters.`)
    .regex(BUSINESS_SLUG, "Use lowercase letters, numbers and single dashes (e.g. acme-fitness).")
    .refine((s) => !RESERVED_SLUGS.has(s), "This slug is reserved. Choose another one."),
  description: z.string().trim().max(PROFILE_LIMITS.description, `Keep the description under ${PROFILE_LIMITS.description} characters.`),
  timezone: z.string().refine(isTimeZone, "Choose a timezone from the list."),
  guidelines: z.string().trim().max(PROFILE_LIMITS.guidelines, `Keep the guidelines under ${PROFILE_LIMITS.guidelines} characters.`),
  // One per line; stored as a list (businesses.consultation_services).
  services: z
    .string()
    .default("")
    .transform((text) => parseServices(text))
    .refine((list) => list.length <= PROFILE_LIMITS.services, `List at most ${PROFILE_LIMITS.services} services.`)
    .refine((list) => list.every((s) => s.length <= PROFILE_LIMITS.serviceName), `Keep each service under ${PROFILE_LIMITS.serviceName} characters.`)
    .transform((list) => list.join("\n")),
});

export type Profile = z.infer<typeof profileSchema>;
export type ProfileField = keyof Profile;
export type FieldErrors = Partial<Record<ProfileField, string>>;

// The first problem with each field, for showing next to it.
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as ProfileField;
    out[field] ??= issue.message;
  }
  return out;
}

// "Acme Fitness & Spa" -> "acme-fitness-spa": the suggestion while typing a
// new business's name. Accents are dropped ("Café" -> "cafe").
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, "");
}
