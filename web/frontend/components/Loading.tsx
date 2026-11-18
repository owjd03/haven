/** A calm "working on it" line: three softly pulsing dots and a plain sentence. The dots hold still for reduced motion. */
export default function Loading({
  label,
  progress,
  className = "",
}: {
  label: string;
  /** 0 to 1: shows a thin bar (a model download). Leave out when the length isn't known. */
  progress?: number;
  className?: string;
}) {
  const pct = progress === undefined ? undefined : Math.round(progress * 100);
  return (
    <div role="status" className={className}>
      <div className="flex items-center gap-3 text-muted">
        <span aria-hidden="true" className="flex items-center gap-1.5">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </span>
        <span>{label}</span>
      </div>
      {pct !== undefined && (
        <div
          role="progressbar"
          aria-label="Preparing the private model"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full bg-accent transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
