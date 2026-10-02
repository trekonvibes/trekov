import { CompassIcon, PlusIcon, RouteIcon, SaveIcon, UserIcon } from './Icons'

// To Visit moved inside Trips: saving a place and planning the trip you save
// it for are the same job, and six tabs does not fit a phone.
const TABS = [
  { id: 'map',      label: 'Map',      Icon: CompassIcon },
  { id: 'discover', label: 'Discover', Icon: SaveIcon },
  { id: 'post',     label: 'Post',     Icon: PlusIcon, primary: true },
  { id: 'trips',    label: 'Trips',    Icon: RouteIcon },
  { id: 'profile',  label: 'You',      Icon: UserIcon },
]

export default function TabBar({ tab, onChange, savedCount, unread, requests = 0 }) {
  return (
    <nav className="shrink-0 flex items-stretch border-t border-line bg-ink/90 backdrop-blur-xl
                    pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ id, label, Icon, primary }) => {
        const active = tab === id
        if (primary) {
          return (
            <button key={id} onClick={() => onChange(id)} aria-label="Post a photo"
                    className="flex-1 flex items-center justify-center py-2">
              <span className="grid place-items-center size-11 rounded-2xl bg-brand text-ink shadow-lg shadow-brand/20 active:scale-95 transition">
                <Icon size={24} />
              </span>
            </button>
          )
        }
        return (
          <button key={id} onClick={() => onChange(id)} aria-current={active ? 'page' : undefined}
                  className={`relative flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] transition
                              ${active ? 'text-brand' : 'text-mist hover:text-white'}`}>
            <span className="relative">
              <Icon size={23} filled={active && id === 'discover'} />
              {id === 'discover' && unread > 0 && (
                <span className="absolute -top-1 -right-2 size-2.5 rounded-full bg-rose" />
              )}
              {/* Someone waiting to be let onto a trip is a job for you, so it
                  takes the badge over the saved-places count while it lasts —
                  and wears the same amber as the request itself. */}
              {id === 'trips' && requests > 0 && (
                <span aria-label={`${requests} waiting to join`}
                      className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-sun text-ink
                                 text-[9px] font-bold grid place-items-center tabular-nums">{requests}</span>
              )}
              {id === 'trips' && requests === 0 && savedCount > 0 && (
                <span className="absolute -top-1 -right-2 min-w-4 h-4 px-1 rounded-full bg-brand text-ink
                                 text-[9px] font-bold grid place-items-center tabular-nums">{savedCount}</span>
              )}
            </span>
            {label}
          </button>
        )
      })}
    </nav>
  )
}
