import { AlertTriangle, CalendarDays, CheckCircle2, RefreshCw } from "lucide-react";
import { maskEmail, maskPhone, type Action } from "./thread";

// What the assistant did, from tool results (never from the model's text).
// A request is shown as Pending: it must never look like a confirmed booking.
export function ActionCard({ action, businessName, onTryAgain }: { action: Action; businessName: string; onTryAgain?: () => void }) {
  if (action.kind === "lead_saved") {
    const d = action.details as { name?: string; email?: string; phone?: string };
    const contact = d.email ? maskEmail(d.email) : d.phone ? maskPhone(d.phone) : null;
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="min-w-0">
          <p className="text-[14px] font-medium">Details shared with {businessName}</p>
          <p className="mt-0.5 text-[13px] text-text-muted break-words">{[d.name, contact].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
    );
  }

  if (action.kind === "consultation_requested") {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays aria-hidden className="size-4 text-text-muted" />
            <p className="text-[15px] font-semibold">
              {action.changedFrom ? "Consultation request changed" : action.alreadyRequested ? "Consultation already requested" : "Consultation requested"}
            </p>
          </div>
          <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-[12px] font-medium text-warning">Pending</span>
        </div>
        <div className="flex flex-col gap-1 border-t border-border pt-3 text-[14px]">
          <p className="font-medium break-words">{action.service}</p>
          <p className="text-text-muted">{action.preferredTime}</p>
          {action.changedFrom && (
            <p className="mt-1 text-[13px] text-text-muted break-words">
              Was: {action.changedFrom.service !== action.service ? `${action.changedFrom.service}, ` : ""}
              {action.changedFrom.preferredTime}
            </p>
          )}
        </div>
        <p className="border-t border-border pt-2.5 text-[13px] text-text-muted">{businessName} will confirm with you.</p>
      </div>
    );
  }

  return (
    <div role="alert" className="flex flex-col gap-2.5 rounded-xl border border-danger/40 bg-danger/5 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
        <div>
          <p className="text-[14px] font-semibold text-danger">{action.tool === "save_lead" ? "Couldn't save your details" : "Couldn't save your request"}</p>
          <p className="text-[13px] text-text-muted">{action.message} Please try again in a moment.</p>
        </div>
      </div>
      {onTryAgain && (
        <div className="pl-6.5">
          <button
            type="button"
            onClick={onTryAgain}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-muted"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
