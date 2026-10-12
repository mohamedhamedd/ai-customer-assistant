// Display helpers for the admin. Times are stored in UTC and always shown in
// the business's timezone, labelled, so staff and customers mean the same
// "3:00 PM" whatever timezone the staff member's laptop is in.

// "Tue, Oct 20 · 3:00 PM PDT". The zone abbreviation is for that date, so a
// list spanning the clock change labels each row right (PDT, then PST).
export function formatInZone(iso: string, timeZone: string): string {
  const at = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
  return `${date} · ${time}`;
}

// "just now", "12 min ago", "3 h ago", "2 days ago", then the date.
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
