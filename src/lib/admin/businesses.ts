import "server-only";
import { db } from "@/lib/db/supabase";
import { ChatHttpError, forgetBusiness } from "@/lib/chat/turn";
import { EVAL_SLUG_PREFIX, profileSchema, fieldErrors, type FieldErrors, type Profile } from "./profile";

// Businesses (US-10.1, 10.2): the home page cards, the admin switcher, and
// creating or editing a profile. One assistant per business, many
// businesses as data: nothing here is specific to one of them.

// A form error the page shows next to its fields.
export class ProfileError extends ChatHttpError {
  constructor(
    status: number,
    message: string,
    public readonly fields: FieldErrors,
  ) {
    super(status, message);
  }
}

const SLUG_TAKEN: FieldErrors = { slug: "This slug is already used by another business." };

export function parseProfile(input: unknown): Profile {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) throw new ProfileError(400, "Some fields need fixing.", fieldErrors(parsed.error));
  return parsed.data;
}

export interface BusinessCard {
  slug: string;
  name: string;
  description: string;
  // Ready documents: what its assistant can answer from.
  documents: number;
}

// Oldest first: the demo business stays first. Bounded like the other lists.
export async function listBusinesses(): Promise<BusinessCard[]> {
  const { data, error } = await db()
    .from("businesses")
    .select("slug, name, description, documents(count)")
    .eq("documents.status", "ready")
    // The guard eval's throwaway copies never show.
    .not("slug", "like", `${EVAL_SLUG_PREFIX}%`)
    .order("created_at")
    .limit(200);
  if (error) throw new Error(`Loading businesses failed: ${error.message}`);
  return (data ?? []).map((b) => ({ slug: b.slug, name: b.name, description: b.description, documents: b.documents[0]?.count ?? 0 }));
}

// Just the names, for the admin's switcher and /admin: no document counts.
export async function listBusinessLinks(): Promise<{ slug: string; name: string }[]> {
  const { data, error } = await db().from("businesses").select("slug, name").not("slug", "like", `${EVAL_SLUG_PREFIX}%`).order("created_at").limit(200);
  if (error) throw new Error(`Loading businesses failed: ${error.message}`);
  return data ?? [];
}

export async function businessProfile(businessId: string): Promise<Profile> {
  const { data, error } = await db().from("businesses").select("slug, name, description, timezone, assistant_guidelines").eq("id", businessId).single();
  if (error) throw new Error(`Loading profile failed: ${error.message}`);
  return { slug: data.slug, name: data.name, description: data.description, timezone: data.timezone, guidelines: data.assistant_guidelines };
}

const toRow = (p: Profile) => ({ slug: p.slug, name: p.name, description: p.description, timezone: p.timezone, assistant_guidelines: p.guidelines });

// Postgres unique_violation: the slug is taken (two admins racing included).
const isSlugTaken = (error: { code?: string; message: string }) => error.code === "23505" && error.message.includes("slug");

export async function createBusiness(input: unknown): Promise<Profile> {
  const profile = parseProfile(input);
  const { error } = await db().from("businesses").insert(toRow(profile));
  if (error) {
    if (isSlugTaken(error)) throw new ProfileError(409, "Choose another slug.", SLUG_TAKEN);
    throw new Error(`Creating business failed: ${error.message}`);
  }
  return profile;
}

// Applies to the next customer message: the cached profile is dropped under
// both slugs. A new slug means a new chat URL; the old one stops working
// (conversations are kept: they belong to the business, not the URL).
export async function updateBusiness(business: { id: string; slug: string }, input: unknown): Promise<Profile> {
  const profile = parseProfile(input);
  const { error } = await db().from("businesses").update(toRow(profile)).eq("id", business.id);
  if (error) {
    if (isSlugTaken(error)) throw new ProfileError(409, "Choose another slug.", SLUG_TAKEN);
    throw new Error(`Saving profile failed: ${error.message}`);
  }
  forgetBusiness(business.slug, profile.slug);
  return profile;
}
