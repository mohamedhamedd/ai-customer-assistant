// Allowed values of the text + CHECK columns (design doc §10, A6). The
// generated database types say `string` for these; inserts use these unions
// so a typo fails `tsc` instead of a CHECK constraint at runtime.
export const CHANNELS = ["text", "voice"] as const;
export type Channel = (typeof CHANNELS)[number];

export const MESSAGE_ROLES = ["user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const CONSULTATION_STATUSES = ["pending", "confirmed", "cancelled"] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

export const DOCUMENT_STATUSES = ["processing", "ready", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
