import type { ContentOrigin, TodayDigest } from "@/types";
import { Link } from "@tanstack/react-router";
import { Card } from "../ui/card";

const ORIGIN_LABELS: Record<ContentOrigin, string> = {
  saved: "Saved",
  upvoted: "Upvoted",
  submitted: "Posted",
  commented: "Commented",
};

/** New-to-archive items per origin from the today digest. */
export function ActivityOverview({ digest }: { digest: TodayDigest | undefined }) {
  const active = digest?.newByOrigin.filter((o) => o.count > 0) ?? [];

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="activity-overview">
      <h3 className="text-sm font-semibold">Activity</h3>
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing new reached the archive in the last 24h.
        </p>
      ) : (
        active.map((section) => (
          <div key={section.origin}>
            <div className="mb-1 text-xs uppercase text-muted-foreground">
              {ORIGIN_LABELS[section.origin]} ({section.count})
            </div>
            <ul className="flex flex-col gap-1">
              {section.top.map((item) => (
                <li key={item.id} className="truncate text-sm">
                  <Link
                    to="/post/$id"
                    params={{ id: item.id }}
                    className="hover:underline"
                    title={item.title}
                  >
                    {item.title}
                  </Link>
                  <span className="ml-1 text-xs text-muted-foreground">
                    r/{item.subreddit} · {item.score}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
}
