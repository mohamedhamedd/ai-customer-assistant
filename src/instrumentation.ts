// Runs once when the Next.js server starts, before it accepts requests.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/lib/env");
    env();
  }
}
