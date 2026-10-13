import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db/supabase";
import type { Database } from "@/lib/db/database.types";
import type { Week } from "@/lib/admin/hours-rows";
import type { ServiceRow } from "@/lib/admin/service-rows";
import type { BusinessTables } from "./prompt";

// Reading a business's tables (Admin > Services, Admin > Opening hours): one
// place for the admin pages, the prompt (text and voice) and the
// consultation tool. No imports from the chat or admin modules, so any of
// them can use it.

type Client = SupabaseClient<Database>;

export async function loadServices(businessId: string, client: Client = db()): Promise<ServiceRow[]> {
  const { data, error } = await client.from("services").select("name, category, price, duration, description, requestable").eq("business_id", businessId).order("position");
  if (error) throw new Error(`Loading services failed: ${error.message}`);
  return data ?? [];
}

export async function loadWeek(businessId: string, client: Client = db()): Promise<Week> {
  const [hours, business] = await Promise.all([
    client.from("opening_hours").select("day, opens, closes").eq("business_id", businessId).order("day").order("opens"),
    client.from("businesses").select("last_start_before_close, hours_notes").eq("id", businessId).single(),
  ]);
  if (hours.error || business.error) throw new Error(`Loading opening hours failed: ${(hours.error ?? business.error)!.message}`);
  return {
    // Postgres returns "09:00:00".
    hours: hours.data.map((r) => ({ day: r.day, opens: r.opens.slice(0, 5), closes: r.closes.slice(0, 5) })),
    lastStartBeforeClose: business.data.last_start_before_close,
    notes: business.data.hours_notes,
  };
}

export async function loadTables(businessId: string): Promise<BusinessTables> {
  const [services, week] = await Promise.all([loadServices(businessId), loadWeek(businessId)]);
  return { services, week };
}
