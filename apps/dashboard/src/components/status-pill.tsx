const statusStyles: Record<string, string> = {
  queued: "bg-[#fff7e6] text-[#a87412]",
  delivered: "bg-accent-soft text-accent-dark",
  failed: "bg-[#fde8e8] text-[#b42318]",
};

export function StatusPill({ status }: { status: string }) {
  const style = statusStyles[status] ?? "bg-surface-muted text-muted";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{status}</span>
  );
}
