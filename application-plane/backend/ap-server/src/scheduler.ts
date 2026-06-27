// Scheduler. setInterval timers per scheduler_intervals fire the scheduled-job
// triggers into ap-civic (collection_schedule warm, city_alerts, city_events fetches)
// and ap-utility (power outage fetch, bill due-date reminder evaluation).
//
// The civic/utility scheduled paths run server-side with no per-user request.
// ap-civic reads the city it runs as from process.env (CIVIC_SCHEDULER_CITY_TENANT_ID),
// which index.ts populates from config before construction. ap-utility enumerates
// its own residents from the store. Neither carries a request token.

import type { civic_handler } from "ap-civic";
import type { utility_handler } from "ap-utility";
import type { reminders_handler } from "ap-reminders";

import type { scheduler_intervals } from "./types.js";

export interface scheduler_deps {
  civic: civic_handler;
  utility: utility_handler;
  reminders: reminders_handler;
  intervals: scheduler_intervals;
}

export interface scheduler_handle {
  stop(): void;
}

// Run a job now and on the interval, swallowing per-tick errors so one failure
// does not stop the timer.
function run_on_interval(
  interval_ms: number,
  job: () => Promise<void>,
): NodeJS.Timeout {
  const tick = () => {
    void job().catch((err) => {
      // per-tick failure: log and ignore, next tick retries
      console.error("[ap-server] scheduled job failed:", err);
    });
  };
  tick(); // run once on startup so the DB is populated before the first interval
  return setInterval(tick, interval_ms);
}

export function start_scheduler(deps: scheduler_deps): scheduler_handle {
  const { civic, utility, reminders, intervals } = deps;
  const timers: NodeJS.Timeout[] = [];

  timers.push(
    run_on_interval(intervals.collection_schedule_interval_ms, () =>
      civic.run_scheduled_fetch("collection_schedule"),
    ),
    run_on_interval(intervals.city_alerts_interval_ms, () =>
      civic.run_scheduled_fetch("city_alerts"),
    ),
    run_on_interval(intervals.city_events_interval_ms, () =>
      civic.run_scheduled_fetch("city_events"),
    ),
    run_on_interval(intervals.power_outage_interval_ms, () => utility.run_outage_fetch()),
    run_on_interval(intervals.bill_reminder_interval_ms, () =>
      utility.run_reminder_evaluation(),
    ),
    run_on_interval(intervals.reminder_eval_interval_ms, () =>
      reminders.run_reminder_evaluation(),
    ),
  );

  return {
    stop(): void {
      for (const t of timers) clearInterval(t);
    },
  };
}
