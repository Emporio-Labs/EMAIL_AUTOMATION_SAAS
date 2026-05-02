export function VolumeChart({ data }: { data: Array<{ date: string; total: number | null | undefined }> }) {
  // Normalize totals to numbers; treat missing/invalid values as 0.
  const totals = data.map((item) => {
    const n = Number(item.total);
    return Number.isFinite(n) ? n : 0;
  });

  const max = totals.length ? Math.max(...totals) : 0;
  const isEmpty = max <= 0;

  if (data.length === 0 || isEmpty) {
    return (
      <div className="flex h-28 flex-col items-center justify-center gap-2">
        <p className="text-xs text-muted">No emails sent in this period yet.</p>
        <p className="text-xs text-muted opacity-60">Bars will appear here once you start sending.</p>
      </div>
    );
  }

  return (
    <div className="flex h-28 items-end gap-0.5">
      {data.map((item, idx) => {
        const total = totals[idx] ?? 0;
        const height = Math.round((total / Math.max(1, max)) * 100);
        return (
          <div key={item.date} className="group relative flex-1">
            <div
              className="w-full rounded-sm bg-accent"
              style={{ height: `${Math.max(8, height)}%` }}
            />
            {/* Tooltip on hover */}
            <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-0.5 text-[10px] text-background group-hover:block">
              {item.date}: {total}
            </div>
          </div>
        );
      })}
    </div>
  );
}
