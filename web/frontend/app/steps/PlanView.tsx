"use client";

import { resolveReading } from "@haven/backend";
import { useCrisis } from "@/components/CrisisProvider";
import { Button } from "@/components/ui";
import { describeSources, type PlanWeek, type SavedPlan } from "@/lib/plan";

function madeOn(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function names(list: string[]): string {
  return list.length <= 1
    ? (list[0] ?? "")
    : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** One week as plain activity cards. Also used while a private plan is still being written. */
export function WeekBlock({ w }: { w: PlanWeek }) {
  return (
    <section aria-label={`Week ${w.n}`}>
      <h3 className="text-lg font-medium">
        Week {w.n}
        {w.theme && <span className="text-muted"> · {w.theme}</span>}
      </h3>
      <ul className="mt-2 space-y-3">
        {w.activities.map((a, i) => (
          <li key={i} className="rounded-lg border border-line bg-bg px-4 py-3">
            <p className="font-medium">{a.title}</p>
            {a.what && <p className="mt-0.5 leading-relaxed">{a.what}</p>}
            <dl className="mt-2 space-y-1 text-sm text-muted">
              {a.why && (
                <div>
                  <dt className="inline font-medium text-ink">Why: </dt>
                  <dd className="inline">{a.why}</dd>
                </div>
              )}
              {a.firstStep && (
                <div>
                  <dt className="inline font-medium text-ink">First step: </dt>
                  <dd className="inline">{a.firstStep}</dd>
                </div>
              )}
              {a.often && (
                <div>
                  <dt className="inline font-medium text-ink">How often: </dt>
                  <dd className="inline">{a.often}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A few general pages about what the plan was written for. Each opens the publisher's own site. */
function ReadMore({ ids }: { ids: string[] }) {
  const links = resolveReading(ids);
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="read-more-h" className="mt-3">
      <h3 id="read-more-h" className="text-sm font-medium text-ink">
        Read more
      </h3>
      <p className="text-xs text-muted">General reading from public health and university sites.</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {links.map((l) => (
          <li key={l.id}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-accent focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent"
            >
              {l.title}
            </a>
            <span className="text-muted"> · {l.publisher}</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The saved plan: four weeks of activities (or, for older plans, a few steps or plain text). */
export default function PlanView({ plan, onDelete }: { plan: SavedPlan; onDelete: () => void }) {
  const { triggerCrisis } = useCrisis();
  return (
    <section aria-labelledby="plan-h" className="mt-8">
      {plan.lowMood && (
        <div role="note" className="mb-4 rounded-xl bg-warn-bg p-4 text-warn-ink">
          <p>
            It looks like it&apos;s been a hard stretch. Talking to someone you trust, or a
            counselor, can really help.
          </p>
        </div>
      )}
      <article className="rounded-xl border border-line bg-surface p-5">
        <h2 id="plan-h" className="text-xl">
          Your plan
        </h2>
        <p className="mt-1 text-sm text-muted">
          Made {madeOn(plan.madeAt)} from {describeSources(plan.sources)} (last {plan.days} days)
        </p>

        {plan.weeks?.length ? (
          <div className="mt-5 space-y-6">
            {plan.weeks.map((w) => (
              <WeekBlock key={w.n} w={w} />
            ))}
          </div>
        ) : plan.steps.length > 0 ? (
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-lg leading-relaxed marker:text-muted">
            {plan.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-lg leading-relaxed whitespace-pre-wrap">{plan.text}</p>
        )}

        {plan.closing && <p className="mt-6 leading-relaxed text-muted">{plan.closing}</p>}
        <Button
          variant="secondary"
          size="xs"
          className="mt-3"
          onClick={() => triggerCrisis("browse")}
        >
          Find a support line
        </Button>

        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm text-muted">
            {plan.mode === "private"
              ? "Written privately on your device. A simpler plan, written by a small model on your device."
              : "Written with the cloud, with your permission."}
          </p>
          {plan.reading?.length ? (
            <ReadMore ids={plan.reading} />
          ) : plan.basedOn?.length ? (
            <p className="mt-1 text-xs text-muted">
              Written with the help of general guidance from {names(plan.basedOn)}.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-xs text-muted">
              A few ideas from an AI, built on general wellbeing guidance. It isn&apos;t a treatment
              plan, and it can be wrong. It&apos;s saved only on this device.
            </p>
            <button
              type="button"
              onClick={onDelete}
              className="rounded px-2 py-2 text-sm text-muted underline-offset-4 hover:text-danger-ink hover:underline focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-accent"
            >
              Delete plan
            </button>
          </div>
        </div>
      </article>
    </section>
  );
}
