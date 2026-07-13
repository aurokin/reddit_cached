/**
 * systemd user unit generation for the jobs pipeline (Linux). Pure functions —
 * the install command handles filesystem and systemctl side effects.
 *
 * Model mirrors launchd.ts: periodic one-shots via a .timer driving a oneshot
 * .service; stdout/stderr land in the user journal instead of log files.
 */

export const DEFAULT_JOBS_UNIT_NAME = "reddit-cached-jobs";
export { DEFAULT_JOBS_INTERVAL_SECONDS } from "./launchd";

export function buildJobsServiceUnit(opts: {
  description: string;
  execStartArguments: string[];
  workingDirectory?: string;
}): string {
  const execStart = opts.execStartArguments.map(systemdQuote).join(" ");
  return [
    "[Unit]",
    `Description=${opts.description}`,
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${execStart}`,
    ...(opts.workingDirectory ? [`WorkingDirectory=${opts.workingDirectory}`] : []),
    "",
  ].join("\n");
}

export function buildJobsTimerUnit(opts: {
  description: string;
  intervalSeconds: number;
  unitName: string;
}): string {
  const interval = Math.max(60, Math.floor(opts.intervalSeconds));
  return [
    "[Unit]",
    `Description=${opts.description}`,
    "",
    "[Timer]",
    "OnBootSec=120",
    `OnUnitActiveSec=${interval}`,
    `Unit=${opts.unitName}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

/** Quote an ExecStart argument only when needed. systemd uses its own quoting
 *  rules: double quotes with backslash escapes for backslash and `"`. */
function systemdQuote(arg: string): string {
  if (arg !== "" && !/[\s"']/.test(arg)) return arg;
  return `"${arg.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
