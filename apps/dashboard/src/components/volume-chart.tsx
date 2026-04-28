export function VolumeChart({ data }: { data: Array<{ date: string; total: number }> }) {
  const max = Math.max(1, ...data.map((item) => item.total));

  return (
    <div className="flex h-28 items-end gap-1">
      {data.map((item) => {
        const height = Math.round((item.total / max) * 100);
        return (
          <div key={item.date} className="flex-1">
            <div
              className="w-full rounded-full bg-accent/70"
              style={{ height: `${Math.max(6, height)}%` }}
              title={`${item.date}: ${item.total}`}
            />
          </div>
        );
      })}
    </div>
  );
}
