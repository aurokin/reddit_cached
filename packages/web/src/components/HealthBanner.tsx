import { useAuthStatus, useJobRuns, useSessionStatus, useSyncStatus } from "@/hooks/queries";
import { cn, formatRelative } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

const STORAGE_KEY = "health-banner-dismissed";

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Surfaces broken background state the moment the app is opened: a dead
 * session (scheduled syncs will keep failing) or an errored pipeline run.
 * Dismissal is per browser session and keyed by the failing condition, so a
 * NEW failure reappears even after an old one was dismissed.
 */
export function HealthBanner() {
  const auth = useAuthStatus();
  const session = useSessionStatus();
  const sync = useSyncStatus();
  const jobs = useJobRuns();
  const [dismissedKey, setDismissedKey] = useState<string | null>(readDismissed);

  const stats = sync.data?.stats;
  const hasData = !!stats && stats.totalPosts + stats.totalComments > 0;
  const testMode = auth.data?.testMode === true;

  // Highest severity first: a broken session means every future scheduled
  // sync fails, an errored run is a symptom that may already be resolved.
  // TEST_MODE stubs auth, so session state is meaningless there.
  const sessionProblem =
    auth.data !== undefined &&
    !testMode &&
    (session.data?.blocked === true || (auth.data.authenticated === false && hasData));

  const lastJob = jobs.data?.items?.[0];
  const jobErrored = lastJob?.status === "errored";

  let key: string;
  let destructive: boolean;
  let message: string;
  let linkTo: "/login" | "/settings";
  let linkLabel: string;

  if (sessionProblem) {
    key = "session";
    destructive = true;
    message =
      "Your Reddit session is disconnected, so scheduled syncs are failing. " +
      "Open reddit.com signed in with the companion extension, or reconnect below.";
    linkTo = "/login";
    linkLabel = "Reconnect";
  } else if (jobErrored && lastJob) {
    const failedSteps = lastJob.steps.filter((s) => !s.ok).map((s) => s.step);
    const failedPart = failedSteps.length > 0 ? ` (failed steps: ${failedSteps.join(", ")})` : "";
    const when = formatRelative(Math.floor((lastJob.finishedAt ?? lastJob.startedAt) / 1000));
    key = `job-${lastJob.id}`;
    destructive = false;
    message = `The last scheduled sync failed ${when}${failedPart}. Your archive is safe — syncs will resume once the session is restored.`;
    linkTo = "/settings";
    linkLabel = "Scheduled jobs";
  } else {
    return null;
  }

  if (dismissedKey === key) return null;

  const dismiss = (): void => {
    try {
      sessionStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* private-mode storage failures just make the dismissal non-sticky */
    }
    setDismissedKey(key);
  };

  return (
    <div
      role="alert"
      data-testid="health-banner"
      className={cn(
        "border-b text-sm",
        destructive
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      <div className="mx-auto flex w-full max-w-7xl items-start gap-2 px-4 py-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="flex-1">
          {message}{" "}
          <Link to={linkTo} className="font-medium underline underline-offset-2">
            {linkLabel}
          </Link>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          data-testid="health-banner-dismiss"
          className="rounded p-0.5 hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
