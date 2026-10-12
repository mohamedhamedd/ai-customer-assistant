// Runs once when the Next.js server starts, before it accepts requests.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/lib/env");
    if (env().SIMULATE_DB_FAILURE) {
      console.warn("[startup] SIMULATE_DB_FAILURE is on: save_lead and create_consultation_request will fail as if the database were down.");
    }
  }
}
