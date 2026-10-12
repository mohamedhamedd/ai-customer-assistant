// The admin top bar: page title, the page's main action, and "Open chat ↗".
export function AdminHeader({ title, slug, children }: { title: string; slug: string; children?: React.ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 md:px-8">
      <h1 className="text-[18px] font-semibold">{title}</h1>
      <div className="flex items-center gap-4">
        {children}
        <a href={`/b/${slug}`} target="_blank" rel="noopener" className="text-[14px] text-text-muted hover:text-text">
          Open chat ↗
        </a>
      </div>
    </header>
  );
}
