// "Lakeside Dental Clinic" -> "LD": the avatar of a business (chat header,
// home cards, admin switcher, settings preview).
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
