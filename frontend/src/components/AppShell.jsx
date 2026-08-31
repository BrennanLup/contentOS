export function AppShell({ sidebar, children }) {
  return (
    <div className="flex h-full w-full flex-row items-stretch justify-center gap-1 overflow-hidden bg-muted p-1 sm:gap-2 sm:p-2">
      <div className="relative flex h-full min-w-0 shrink-0">
        {sidebar}
      </div>
      <div className="relative h-full min-w-0 flex-grow overflow-hidden rounded-md border-[0.5px] border-border-darker bg-background sm:rounded-lg">
        {children}
      </div>
    </div>
  )
}
