// The chat API's input rules, shared by the route (validation) and the
// browser (composer limit, which slugs are worth a lookup). No server imports,
// so client components can use it.

export const MAX_MESSAGE_CHARS = 2000;

// The shape of a business slug: lowercase words joined by hyphens.
export const BUSINESS_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SLUG_CHARS = 64;

export const isBusinessSlug = (s: string) => s.length <= MAX_SLUG_CHARS && BUSINESS_SLUG.test(s);
