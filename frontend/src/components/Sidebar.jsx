import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Clapperboard, Moon, Sun, Workflow } from 'lucide-react'
import { STAGES } from '../data/contentProcess'
import { cn } from '../lib/cn'

export function Sidebar({
  view,
  stageId,
  onViewChange,
  onStageChange,
  stageCounts = {},
  weeklyPosted = 0,
  weeklyGoal = 5,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem('contentos-theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const next = stored === 'dark' || (stored == null && prefersDark)
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
  }, [])

  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    window.localStorage.setItem('contentos-theme', next ? 'dark' : 'light')
  }

  const processActive = view === 'process'
  const deconstructActive = view === 'deconstruct'

  return (
    <div
      className={cn(
        'group/sidebar relative flex h-full shrink-0 grow-0 flex-col items-start gap-1.5 transition-all duration-200 ease-out',
        collapsed ? 'w-12 overflow-hidden' : 'w-12 overflow-hidden sm:w-[244px] sm:overflow-visible',
      )}
    >
      <header
        className={cn(
          'relative z-10 flex w-full flex-col items-center gap-4 py-3 transition-all duration-200',
          collapsed ? 'sm:gap-4' : 'sm:flex-row sm:items-center sm:justify-between sm:pl-2 sm:pr-3 sm:pt-2',
        )}
      >
        {collapsed ? (
          <>
            <CollapseButton collapsed={collapsed} onClick={() => setCollapsed(false)} />
            <hr className="hidden w-full shrink-0 border-0 border-t border-border-darker sm:block" />
          </>
        ) : null}

        <button
          type="button"
          onClick={() => onViewChange('process')}
          className={cn('flex items-center gap-2 rounded-lg px-1.5 py-1', collapsed && 'justify-center px-1')}
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-xs font-semibold text-white">
            C
          </span>
          <span className={cn('whitespace-nowrap text-sm font-medium', collapsed ? 'hidden' : 'hidden sm:inline')}>
            contentOS
          </span>
        </button>

        {!collapsed ? <CollapseButton collapsed={collapsed} onClick={() => setCollapsed(true)} /> : null}
      </header>

      <hr
        className={cn(
          'relative z-10 w-full border-t border-border-darker',
          collapsed ? 'sm:block' : 'sm:hidden',
        )}
      />

      <nav
        className={cn(
          'relative z-10 flex w-full flex-1 flex-col gap-1 overflow-y-auto',
          !collapsed && 'sm:px-1.5 sm:pt-0',
        )}
      >
        <button
          type="button"
          aria-selected={processActive}
          title="Process"
          onClick={() => onViewChange('process')}
          className={cn(
            'button relative h-auto w-full rounded-md px-2.5 py-2',
            collapsed ? 'justify-center' : 'justify-center sm:justify-start',
            'aria-selected:bg-foreground/5',
          )}
        >
          <span className={cn('relative flex items-center gap-2', !collapsed && 'sm:w-full')}>
            <Workflow className={cn('size-4 shrink-0', processActive ? 'opacity-100' : 'opacity-60')} />
            <span className={cn('whitespace-nowrap text-sm font-medium', collapsed ? 'hidden' : 'hidden sm:inline')}>
              Process
            </span>
          </span>
        </button>

        {!collapsed && processActive ? (
          <div className="mb-1 ml-5 mt-0.5 hidden flex-col sm:flex">
            {STAGES.map((stage) => {
              const active = stageId === stage.id
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => {
                    onViewChange('process')
                    onStageChange(stage.id)
                  }}
                  className={cn(
                    'relative flex h-7 items-center gap-2 rounded-md pl-4 pr-3 text-left text-xs transition-colors',
                    'before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-px before:bg-border-darker',
                    active
                      ? 'bg-brand/10 font-medium text-brand before:!-left-px before:!w-0.5 before:!bg-brand'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {stage.number}. {stage.title}
                  </span>
                  {stageCounts[stage.id] ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 text-2xs font-medium',
                        active ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {stageCounts[stage.id]}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}

        <button
          type="button"
          aria-selected={deconstructActive}
          title="Deconstruct"
          onClick={() => onViewChange('deconstruct')}
          className={cn(
            'button relative h-auto w-full rounded-md px-2.5 py-2',
            collapsed ? 'justify-center' : 'justify-center sm:justify-start',
            'aria-selected:bg-foreground/5',
          )}
        >
          <span className={cn('relative flex items-center gap-2', !collapsed && 'sm:w-full')}>
            <Clapperboard className={cn('size-4 shrink-0', deconstructActive ? 'opacity-100' : 'opacity-60')} />
            <span className={cn('whitespace-nowrap text-sm font-medium', collapsed ? 'hidden' : 'hidden sm:inline')}>
              Deconstruct
            </span>
          </span>
        </button>
      </nav>

      <div className={cn('mt-auto flex w-full flex-col gap-1 pb-2', !collapsed && 'sm:px-1.5')}>
        {!collapsed ? (
          <p className="hidden px-2.5 pb-1 text-2xs text-muted-foreground sm:block">
            {weeklyPosted}/{weeklyGoal} posted this week
          </p>
        ) : null}
        <button
          type="button"
          onClick={toggleTheme}
          className={cn(
            'button h-auto w-full rounded-md px-2.5 py-2',
            collapsed ? 'justify-center' : 'justify-center sm:justify-start',
          )}
          title={dark ? 'Light mode' : 'Dark mode'}
        >
          <span className={cn('flex items-center gap-2', !collapsed && 'sm:w-full')}>
            {dark ? <Sun className="size-4 opacity-60" /> : <Moon className="size-4 opacity-60" />}
            <span className={cn('text-sm font-medium', collapsed ? 'hidden' : 'hidden sm:inline')}>
              {dark ? 'Light' : 'Dark'}
            </span>
          </span>
        </button>
      </div>
    </div>
  )
}

function CollapseButton({ collapsed, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-darker bg-muted p-0 hover:bg-border-darker sm:flex"
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-3" />}
    </button>
  )
}
