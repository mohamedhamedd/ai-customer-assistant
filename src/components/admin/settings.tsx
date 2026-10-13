"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { initials } from "@/lib/initials";
import { fieldErrors, profileSchema, type FieldErrors, type Profile, type ProfileField } from "@/lib/admin/profile";
import { focusFirstError, ProfileFields, saveProfile, type SuggestResult } from "./business-form";
import { AdminHeader } from "./header";
import { useToast } from "./ui";

// Settings: the business profile (US-10.1). Saved changes apply to the next
// customer message, no redeploy. A new slug moves the admin and the chat to
// the new URL.
export function Settings({ slug, initial }: { slug: string; initial: Profile }) {
  const api = `/api/admin/${encodeURIComponent(slug)}/settings`;
  const router = useRouter();
  const toast = useToast();
  // What is stored, and what the form shows.
  const [saved, setSaved] = useState(initial);
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const dirty = (Object.keys(values) as ProfileField[]).some((k) => values[k] !== saved[k]);

  const change = (field: ProfileField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  // A list from the business's documents, into the form (not saved).
  const suggestServices = async (): Promise<SuggestResult> => {
    const failed = "Couldn't read your documents just now. Try again.";
    try {
      const res = await fetch(`${api}/services`, { method: "POST", signal: AbortSignal.timeout(70_000) });
      const body = (await res.json().catch(() => ({}))) as { services?: string[]; error?: string };
      return res.ok && Array.isArray(body.services) ? { ok: true, services: body.services } : { ok: false, error: body.error ?? failed };
    } catch {
      return { ok: false, error: failed };
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    // Same rules as the server: most mistakes are caught without a round trip.
    const local = profileSchema.safeParse(values);
    if (!local.success) {
      const errs = fieldErrors(local.error);
      setErrors(errs);
      return focusFirstError(errs);
    }
    setSaving(true);
    const result = await saveProfile(api, "PATCH", values);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fields);
      focusFirstError(result.fields);
      toast.show(result.error, "danger");
      return;
    }
    if (result.profile.slug !== slug) {
      // The admin lives under the slug: move to the new one (the sidebar
      // and every link follow).
      router.replace(`/admin/${result.profile.slug}/settings?notice=saved`);
      return;
    }
    setSaved(result.profile);
    setValues(result.profile);
    toast.show("Settings saved");
    // The sidebar shows the name: refresh the server-rendered shell.
    router.refresh();
  };

  return (
    <>
      <AdminHeader title="Settings" slug={slug} />
      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-8">
        <div className="flex max-w-[952px] flex-col items-start gap-8 lg:flex-row">
          <form onSubmit={save} noValidate className="w-full max-w-[640px] rounded-2xl border border-border bg-surface">
            <div className="border-b border-border p-6">
              <h2 className="text-[16px] font-semibold">Business profile</h2>
              <p className="mt-1 text-[14px] text-text-muted">Changes apply to the next customer message.</p>
            </div>
            <div className="p-6">
              <ProfileFields
                values={values}
                errors={errors}
                onChange={change}
                onSuggestServices={suggestServices}
                slugHint="Changing it moves the chat to a new link; the old link stops working."
              />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => {
                  setValues(saved);
                  setErrors({});
                }}
                className="h-10 rounded-lg px-4 text-[14px] font-medium text-text-muted hover:text-text disabled:opacity-50"
              >
                Discard changes
              </button>
              <button
                type="submit"
                disabled={!dirty || saving}
                aria-busy={saving}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
                Save changes
              </button>
            </div>
          </form>
          <HeaderPreview name={values.name} slug={saved.slug} />
        </div>
      </main>
      {toast.element}
    </>
  );
}

// How the chat's header will look with this name (the live chat changes on
// save). The link is the saved slug's: the new one doesn't exist yet.
function HeaderPreview({ name, slug }: { name: string; slug: string }) {
  const avatar = initials(name) || "?";
  return (
    <aside className="flex w-full flex-col gap-3 lg:w-[280px] lg:shrink-0">
      <span className="px-1 text-[12px] font-medium uppercase tracking-wider text-text-muted">Chat header preview</span>
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between rounded-xl border border-border bg-bg p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-contrast">
              {avatar}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-tight">{name || "Business name"}</p>
              <p className="mt-0.5 text-[12px] leading-tight text-text-muted">AI assistant</p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2 text-[12px]">
          <span className="truncate font-mono text-text-muted">/b/{slug}</span>
          <a href={`/b/${slug}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-text-muted hover:text-text">
            Open <ExternalLink aria-hidden className="size-3" />
          </a>
        </div>
      </div>
    </aside>
  );
}
