export function MetricCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string | number;
  trend?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-4 card-shadow">
      <p className="text-xs uppercase tracking-[0.2em] text-muted">{label}</p>
      <div className="mt-3 flex items-end justify-between">
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        {trend ? <span className="text-xs text-accent-dark">{trend}</span> : null}
      </div>
    </div>
  );
}
