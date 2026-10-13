import "server-only";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import { ChatHttpError } from "@/lib/chat/turn";
import { loadServices } from "@/lib/agent/tables";
import { validateServices, type RowError, type ServiceRow } from "./service-rows";

// A business's services (the services table): listing, and saving the
// edited list.

// A list with problems: the page shows each one on its row.
export class ServicesError extends ChatHttpError {
  constructor(
    message: string,
    public readonly rows: RowError[],
  ) {
    super(400, message);
  }
}

export const listServices = (businessId: string): Promise<ServiceRow[]> => loadServices(businessId);

// The whole list, as edited: replaced in one transaction (replace_services).
export async function saveServices(businessId: string, input: unknown): Promise<ServiceRow[]> {
  const result = validateServices(input);
  if (!result.ok) throw new ServicesError(result.error, result.errors);
  const { error } = await db().rpc("replace_services", { p_business_id: businessId, p_services: result.rows as unknown as Json });
  if (error) throw new Error(`Saving services failed: ${error.message}`);
  return listServices(businessId);
}
