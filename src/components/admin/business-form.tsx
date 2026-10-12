"use client";

import { Check, Copy } from "lucide-react";
import { MAX_SLUG_CHARS } from "@/lib/chat/limits";
import { PROFILE_LIMITS, TIMEZONES, type FieldErrors, type Profile, type ProfileField } from "@/lib/admin/profile";
import { useCopy } from "./ui";

// The profile fields, shared by Settings (US-10.1) and New business
// (US-10.2). Controlled: the page owns the values and saves them.

const input =
  "w-full rounded-lg border bg-surface text-[14px] text-text placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export function ProfileFields({
  values,
  errors,
  onChange,
  slugHint,
}: {
  values: Profile;
  errors: FieldErrors;
  onChange: (field: ProfileField, value: string) => void;
  slugHint?: string;
}) {
  const border = (f: ProfileField) => (errors[f] ? "border-danger" : "border-border");
  // The business's own zone is kept even if this browser's list lacks it.
  const zones = TIMEZONES.includes(values.timezone) ? TIMEZONES : [values.timezone, ...TIMEZONES];
  return (
    <div className="flex flex-col gap-6">
      <Field id="name" label="Business name" error={errors.name}>
        <input
          id="name"
          value={values.name}
          maxLength={PROFILE_LIMITS.name}
          onChange={(e) => onChange("name", e.target.value)}
          placeholder="e.g. Acme Fitness"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "name-error" : undefined}
          className={`${input} ${border("name")} h-10 px-3`}
          required
        />
      </Field>

      <Field id="slug" label="Slug" error={errors.slug} hint={slugHint ?? "Lowercase letters, numbers and dashes."}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[14px] text-text-muted">
              /b/
            </span>
            <input
              id="slug"
              value={values.slug}
              maxLength={MAX_SLUG_CHARS}
              onChange={(e) => onChange("slug", e.target.value.toLowerCase())}
              aria-invalid={!!errors.slug}
              aria-describedby={`slug-hint${errors.slug ? " slug-error" : ""}`}
              spellCheck={false}
              autoCapitalize="none"
              className={`${input} ${border("slug")} h-10 pl-9 pr-3 font-mono`}
              required
            />
          </div>
          <CopyLink path={`/b/${values.slug}`} />
        </div>
      </Field>

      <Field id="description" label="Short description" error={errors.description} count={[values.description.length, PROFILE_LIMITS.description]}>
        <textarea
          id="description"
          rows={3}
          value={values.description}
          maxLength={PROFILE_LIMITS.description}
          onChange={(e) => onChange("description", e.target.value)}
          placeholder="One or two sentences: what the business does. The assistant introduces itself with it."
          aria-invalid={!!errors.description}
          className={`${input} ${border("description")} resize-y p-3 leading-relaxed`}
        />
      </Field>

      <Field id="timezone" label="Timezone" error={errors.timezone} hint="Times customers ask for, and the ones staff see, are in this timezone.">
        <select
          id="timezone"
          value={values.timezone}
          onChange={(e) => onChange("timezone", e.target.value)}
          aria-invalid={!!errors.timezone}
          aria-describedby="timezone-hint"
          className={`${input} ${border("timezone")} h-10 cursor-pointer px-3`}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id="guidelines"
        label="Assistant guidelines"
        error={errors.guidelines}
        hint="Rules for this business only, added to the assistant's instructions. They can't switch off the shared rules (answers only from your documents, requests are never bookings)."
        count={[values.guidelines.length, PROFILE_LIMITS.guidelines]}
      >
        <textarea
          id="guidelines"
          rows={5}
          value={values.guidelines}
          maxLength={PROFILE_LIMITS.guidelines}
          onChange={(e) => onChange("guidelines", e.target.value)}
          placeholder={"e.g. Never quote a repair price before an inspection.\nFor a suspected gas leak, tell the customer to leave the building and call the gas company."}
          aria-invalid={!!errors.guidelines}
          aria-describedby="guidelines-hint"
          className={`${input} ${border("guidelines")} resize-y p-3 leading-relaxed`}
        />
      </Field>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  count,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  count?: [number, number];
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      )}
      {(hint || count) && (
        <div className="mt-1.5 flex items-start justify-between gap-4 text-[12px] text-text-muted">
          {hint ? <p id={`${id}-hint`}>{hint}</p> : <span />}
          {count && (
            <span className="shrink-0 tabular-nums">
              {count[0].toLocaleString("en-US")} / {count[1].toLocaleString("en-US")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function CopyLink({ path }: { path: string }) {
  const { copied, copy } = useCopy();
  return (
    // Icon only on a phone, where the slug needs the width.
    <button
      type="button"
      onClick={() => copy(`${window.location.origin}${path}`)}
      aria-label={copied ? "Copied" : "Copy the chat link"}
      title="Copy the chat link"
      className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-[14px] font-medium hover:bg-surface-muted"
    >
      {copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
      <span aria-hidden className="hidden sm:inline">
        {copied ? "Copied" : "Copy link"}
      </span>
    </button>
  );
}

// After a failed submit: focus the first field with a problem, so keyboard
// and screen-reader users land on it.
const ORDER: ProfileField[] = ["name", "slug", "description", "timezone", "guidelines"];
export function focusFirstError(errors: FieldErrors) {
  const first = ORDER.find((f) => errors[f]);
  if (first) document.getElementById(first)?.focus();
}

// Sends the profile; on a form error, the server's message per field.
export async function saveProfile(url: string, method: "POST" | "PATCH", values: Profile): Promise<{ ok: true; profile: Profile } | { ok: false; error: string; fields: FieldErrors }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { profile?: Profile; business?: Profile; error?: string; fields?: FieldErrors };
    const profile = body.profile ?? body.business;
    if (res.ok && profile) return { ok: true, profile };
    // A success with no profile (a cut-off response): it may have saved.
    if (res.ok) return { ok: false, error: "The answer from the server was incomplete. Reload the page to see whether it saved.", fields: {} };
    return { ok: false, error: body.error ?? "Couldn't save. Please try again.", fields: body.fields ?? {} };
  } catch (err) {
    // It may have reached the server and saved: don't say it failed.
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { ok: false, error: "The server took too long to answer. Reload the page to see whether it saved.", fields: {} };
    }
    return { ok: false, error: "Couldn't reach the server. Please try again.", fields: {} };
  }
}
