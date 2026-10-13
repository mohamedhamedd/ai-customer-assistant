import "server-only";
import { db } from "@/lib/db/supabase";
import type { Json } from "@/lib/db/database.types";
import { ChatHttpError } from "@/lib/chat/turn";
import { loadWeek } from "@/lib/agent/tables";
import { validateWeek, type HoursRowError, type Week } from "./hours-rows";

// A business's opening hours (the opening_hours table, and the last-start
// setting and notes on businesses): listing, and saving the edited week.

// A week with problems: the page shows each one on its range.
export class OpeningHoursError extends ChatHttpError {
  constructor(
    message: string,
    public readonly rows: HoursRowError[],
  ) {
    super(400, message);
  }
}

export const listHours = (businessId: string): Promise<Week> => loadWeek(businessId);

// The whole week, as edited: replaced in one transaction (replace_opening_hours).
export async function saveHours(businessId: string, input: unknown): Promise<Week> {
  const result = validateWeek(input);
  if (!result.ok) throw new OpeningHoursError(result.error, result.errors);
  const { error } = await db().rpc("replace_opening_hours", {
    p_business_id: businessId,
    p_hours: result.week.hours as unknown as Json,
    p_last_start_before_close: result.week.lastStartBeforeClose,
    p_notes: result.week.notes,
  });
  if (error) throw new Error(`Saving opening hours failed: ${error.message}`);
  return listHours(businessId);
}
