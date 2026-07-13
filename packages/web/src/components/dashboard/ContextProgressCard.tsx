import type { DbStats } from "@/types";
import { Card } from "../ui/card";

/** Thread-context coverage: context rows captured vs. saved items in the archive. */
export function ContextProgressCard({ stats }: { stats: DbStats | undefined }) {
  const captured = stats?.contextCount;
  const savedCount = stats?.activeCountByOrigin.saved;

  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="context-progress-card">
      <h3 className="text-sm font-semibold">Thread context</h3>
      {captured !== undefined && savedCount !== undefined ? (
        <>
          <div className="text-2xl font-semibold">{captured}</div>
          <p className="text-sm text-muted-foreground">
            context rows captured around {savedCount} saved item{savedCount === 1 ? "" : "s"}. Runs
            incrementally with each scheduled job.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </Card>
  );
}
