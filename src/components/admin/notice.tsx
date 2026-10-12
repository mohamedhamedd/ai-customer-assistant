"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useToast } from "./ui";

// A message carried across a navigation as ?notice=… (after creating a
// business, or saving a new slug, the page that confirms it is a new URL).
// Shown once, then removed from the URL so a reload doesn't repeat it.
const NOTICES: Record<string, string> = {
  created: "Business created. Upload its documents so the assistant can answer.",
  saved: "Settings saved",
};

export function Notice() {
  const params = useSearchParams();
  const key = params.get("notice");
  const toast = useToast();
  const { show } = toast;
  useEffect(() => {
    if (!key || !NOTICES[key]) return;
    show(NOTICES[key]);
    const url = new URL(window.location.href);
    url.searchParams.delete("notice");
    window.history.replaceState(null, "", url);
  }, [key, show]);
  return toast.element;
}
