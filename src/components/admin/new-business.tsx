"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fieldErrors, profileSchema, slugify, type FieldErrors, type Profile, type ProfileField } from "@/lib/admin/profile";
import { focusFirstError, ProfileFields, saveProfile } from "./business-form";
import { useToast } from "./ui";

// New business (US-10.2): the same fields as Settings. The slug follows the
// name until it's edited by hand. On create, the admin opens the new
// business's knowledge base, empty, to upload its documents.
export function NewBusiness() {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Profile>({ name: "", slug: "", description: "", timezone: "America/Los_Angeles", guidelines: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const change = (field: ProfileField, value: string) => {
    if (field === "slug") setSlugEdited(value !== "");
    setValues((v) => ({ ...v, [field]: value, ...(field === "name" && !slugEdited ? { slug: slugify(value) } : {}) }));
    setErrors((e) => ({ ...e, [field]: undefined, ...(field === "name" && !slugEdited ? { slug: undefined } : {}) }));
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const local = profileSchema.safeParse(values);
    if (!local.success) {
      const errs = fieldErrors(local.error);
      setErrors(errs);
      return focusFirstError(errs);
    }
    setSaving(true);
    const result = await saveProfile("/api/businesses", "POST", values);
    if (!result.ok) {
      // The form keeps what was typed.
      setSaving(false);
      setErrors(result.fields);
      focusFirstError(result.fields);
      toast.show(result.error, "danger");
      return;
    }
    router.push(`/admin/${result.profile.slug}/knowledge-base?notice=created`);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 md:px-8">
        <Link href="/admin" aria-label="Back to the admin" className="inline-flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text">
          <ArrowLeft aria-hidden className="size-4" />
        </Link>
        <h1 className="text-[18px] font-semibold">New business</h1>
        <span className="ml-auto rounded bg-surface-muted px-2 py-1 text-[12px] text-text-muted">Demo mode · no login</span>
      </header>
      <main className="flex-1 p-4 md:p-8">
        <form onSubmit={create} noValidate className="mx-auto w-full max-w-[640px] rounded-2xl border border-border bg-surface">
          <div className="border-b border-border p-6">
            <h2 className="text-[16px] font-semibold">Business profile</h2>
            <p className="mt-1 text-[14px] text-text-muted">Create a business, then upload its documents. Its assistant answers only from those documents.</p>
          </div>
          <div className="p-6">
            <ProfileFields
              values={values}
              errors={errors}
              onChange={change}
              slugHint={`Lowercase letters, numbers and dashes. ${slugEdited ? "" : "Suggested from the name. "}Chat link: /b/${values.slug || "…"}`}
            />
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            <Link href="/admin" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-[14px] font-medium hover:bg-surface-muted">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-[14px] font-medium text-accent-contrast hover:opacity-90 disabled:opacity-60"
            >
              {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Create business
            </button>
          </div>
        </form>
      </main>
      {toast.element}
    </div>
  );
}
