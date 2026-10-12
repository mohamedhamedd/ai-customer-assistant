"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed.");
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">
        Password
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-10 rounded-lg border border-border bg-surface px-3 text-[16px] font-normal focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !password} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-medium text-accent-contrast hover:opacity-90 disabled:opacity-60">
        {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
        Sign in
      </button>
    </form>
  );
}
