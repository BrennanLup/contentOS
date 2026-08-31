export function Page({ title, description, actions, children }) {
  return (
    <div className="grid h-full w-full grid-cols-[minmax(0,_1fr)] grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex min-h-12 w-full min-w-0 flex-row items-center justify-between gap-4 border-b border-b-border px-6 py-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="font-display truncate text-base font-medium">{title}</h1>
          {description ? (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="relative flex h-full w-full flex-col overflow-auto [scrollbar-gutter:stable]">
        {children}
      </div>
    </div>
  )
}
