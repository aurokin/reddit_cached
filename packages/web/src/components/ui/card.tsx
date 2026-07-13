import { cn } from "@/lib/utils";

/** The repeated card shell: bordered, card-surfaced, rounded container. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-card", className)} {...props} />;
}
