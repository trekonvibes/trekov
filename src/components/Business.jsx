import { useEffect, useMemo, useState } from 'react'
import { hasSupabase } from '../lib/auth'
import { useStore } from '../lib/store'
import { CATEGORIES } from '../lib/nearby'
import { MAX_LISTINGS, deleteListing, myListings, saveListing, validPhone } from '../lib/listings'
import {
  PRODUCTS_PLAN_INR, UNITS, activationMailto, deleteProduct, formatInr, myProducts, planActive, saveProduct,
} from '../lib/products'
import { getFix, gpsMessage } from '../lib/gps'
import { CATEGORY_ICONS } from './Nearby'
import Camera from './Camera'
import PinMap from './PinMap'
import { BackIcon, CameraIcon, CloseIcon, MountainIcon, TrashIcon } from './Icons'

const field = 'w-full bg-raised rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-mist focus:ring-2 focus:ring-brand/50'
const heading = 'block text-[11px] uppercase tracking-[0.14em] text-mist mb-1.5'
const EMPTY = { category: 'hotel', name: '', phone: '', address: '', description: '', url: '', lat: null, lng: null, photo_path: '' }
const kind = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? id

/**
 * Free business listings: a stay, dhaba, garage, fuel stop or rental puts
 * itself on the riders' map. No sign-up fee — joining Trekov is free for
 * everyone; the only things ever sold are optional extras.
 */
export default function Business({ onClose, onAuth }) {
  const account = useStore((s) => s.account)
  const [list, setList] = useState(null)     // null while loading
  const [draft, setDraft] = useState(null)   // the listing being added or edited
  const [note, setNote] = useState('')

  const load = () => myListings().then(setList).catch((e) => { setList([]); setNote(e.message) })
  useEffect(() => { if (account) { setList(null); load() } }, [account?.id])

  const title = draft ? (draft.id ? 'Edit listing' : 'List your business') : 'Your business on Trekov'
  const back = () => (draft ? setDraft(null) : onClose())

  return (
    <div className="fixed inset-0 z-[1200] bg-black flex justify-center" role="dialog" aria-label={title}>
      <div className="relative tk-shell h-full w-full flex flex-col bg-ink sm:border-x sm:border-line">
        <header className="flex items-center gap-3 px-3 h-14 border-b border-line shrink-0">
          <button onClick={back} aria-label={draft ? 'Back' : 'Close'} className="p-2 text-mist hover:text-white">
            {draft ? <BackIcon size={20} /> : <CloseIcon size={20} />}
          </button>
          <h1 className="text-base font-semibold">{title}</h1>
        </header>

        <div className="flex-1 overflow-y-auto">
          {!hasSupabase ? (
            <p className="p-5 text-sm text-mist">Business listings need the Trekov server, which isn't set up in this build.</p>
          ) : !account ? (
            <Intro onAuth={onAuth} />
          ) : draft ? (
            <ListingForm initial={draft} onCancel={() => setDraft(null)}
                         onSaved={(msg) => { setDraft(null); setNote(msg); load() }} />
          ) : (
            <div className="p-4 space-y-3">
              {note && <p className="rounded-xl bg-brand/10 border border-brand/30 text-brand text-sm px-3 py-2">{note}</p>}
              {list === null ? (
                <p className="text-sm text-mist py-2">Loading your listings…</p>
              ) : list.length === 0 ? (
                <div className="py-2">
                  <p className="text-base font-semibold">No listings yet</p>
                  <p className="text-sm text-mist mt-1 leading-relaxed">
                    Add your stay, dhaba, garage, fuel stop or rental. Riders nearby will find it in
                    Discover, call you with one tap and navigate to your door. It's free.
                  </p>
                </div>
              ) : (
                list.map((l) => (
                  <ListingCard key={l.id} listing={l} onEdit={() => { setNote(''); setDraft({ ...l, removePhoto: false }) }}
                               onDeleted={() => { setNote('Listing removed.'); load() }} />
                ))
              )}
              {list && (
                <button onClick={() => { setNote(''); setDraft({ ...EMPTY }) }} disabled={list.length >= MAX_LISTINGS}
                        className="w-full rounded-full bg-brand text-ink py-3 text-sm font-semibold disabled:opacity-40">
                  {list.length ? '+ Add another business' : '+ List a business — free'}
                </button>
              )}
              {list && list.length >= MAX_LISTINGS && (
                <p className="text-xs text-mist text-center">You can list up to {MAX_LISTINGS} businesses.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Intro({ onAuth }) {
  return (
    <div className="p-5 space-y-6">
      <div>
        <h2 className="text-2xl font-semibold leading-tight">Put your business on the riders' map</h2>
        <p className="text-sm text-mist mt-2 leading-relaxed">
          Stays, dhabas, garages, fuel and rentals on riding routes — shown to travellers right when they
          need you, with tap-to-call and turn-by-turn directions to your door.
        </p>
      </div>
      <ul className="space-y-2.5 text-sm">
        {['Free — no sign-up fee, no commission', 'Shows in Discover and trip planning near you',
          'Edit or remove it any time',
          `Optional: show rooms, rentals or a menu with prices — ${formatInr(PRODUCTS_PLAN_INR)}/month`].map((t) => (
          <li key={t} className="flex gap-2.5"><span className="text-brand font-bold">✓</span>{t}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button onClick={() => onAuth?.('signup')} className="flex-1 rounded-full bg-brand text-ink py-3 text-sm font-semibold">
          Sign up free
        </button>
        <button onClick={() => onAuth?.('signin')}
                className="flex-1 rounded-full border border-line py-3 text-sm font-semibold hover:border-brand hover:text-brand">
          Sign in
        </button>
      </div>
      <p className="text-xs text-mist">Your Trekov account is the same one riders use — one sign-up for both.</p>
    </div>
  )
}

function ListingCard({ listing: l, onEdit, onDeleted }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const Icon = CATEGORY_ICONS[l.category] ?? MountainIcon

  async function remove() {
    setBusy(true); setError('')
    try { await deleteListing(l); onDeleted() } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface overflow-hidden">
      {l.photo && <img src={l.photo} alt="" className="w-full h-32 object-cover bg-raised" />}
      <div className="p-3.5">
        <div className="flex items-start gap-2">
          <Icon size={16} className="text-brand mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">{l.name}</p>
            <p className="text-xs text-mist mt-0.5">{kind(l.category)}{l.address ? ` · ${l.address}` : ''}</p>
          </div>
          {l.verified && <span className="rounded-full bg-brand text-ink text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5">Verified</span>}
        </div>
        <p className={`text-xs mt-2 ${l.hidden ? 'text-rose' : 'text-brand'}`}>
          {l.hidden ? 'Hidden by Trekov — contact us if you think this is a mistake.' : '● Live in Discover'}
        </p>
        <ProductsSection listing={l} />
        {error && <p className="text-xs text-rose mt-2">{error}</p>}
        {confirm ? (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-mist flex-1">Remove this listing?</span>
            <button onClick={() => setConfirm(false)} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">Keep</button>
            <button onClick={remove} disabled={busy} className="rounded-full bg-rose text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        ) : (
          <div className="flex gap-2 mt-3">
            <button onClick={onEdit} className="flex-1 rounded-full border border-line py-1.5 text-xs font-semibold hover:border-brand hover:text-brand">Edit</button>
            <button onClick={() => setConfirm(true)} aria-label={`Remove ${l.name}`}
                    className="rounded-full border border-line px-3 py-1.5 text-mist hover:border-rose hover:text-rose">
              <TrashIcon size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ListingForm({ initial, onCancel, onSaved }) {
  const [f, setF] = useState(initial)
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }))
  const [photo, setPhoto] = useState(null)          // a new camera capture
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : ''), [photo])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const shown = preview || (!f.removePhoto && f.photo) || ''
  const [camera, setCamera] = useState(false)
  const [locating, setLocating] = useState(false)
  const [pinKey, setPinKey] = useState(0)            // remounts the map when the pin jumps
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function locate() {
    setLocating(true); setError('')
    try {
      const fix = await getFix()
      setF((v) => ({ ...v, lat: +fix.lat.toFixed(5), lng: +fix.lng.toFixed(5) })); setPinKey((k) => k + 1)
    } catch (e) {
      setError(gpsMessage(e.code))
    } finally { setLocating(false) }
  }
  const pinOnMap = () => { setF((v) => ({ ...v, lat: 22.5, lng: 79.0 })); setPinKey((k) => k + 1) }

  const problem = f.name.trim().length < 2 ? 'Add the name of your business.'
    : f.lat == null ? 'Set where your business is, so riders can navigate to it.'
    : !validPhone(f.phone) ? 'That phone number doesn’t look right — digits, spaces and + only.'
    : ''

  async function submit(e) {
    e.preventDefault()
    if (problem) return setError(problem)
    setBusy(true); setError('')
    try {
      await saveListing(f, photo)
      onSaved(initial.id ? 'Changes saved.' : "You're on Trekov. Riders nearby can now find you in Discover.")
    } catch (err) {
      setError(err.message); setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="p-4 space-y-5">
      <div>
        <span className={heading}>What kind of place?</span>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICONS[c.id] ?? MountainIcon
            const on = f.category === c.id
            return (
              <button type="button" key={c.id} onClick={() => setF((v) => ({ ...v, category: c.id }))} aria-pressed={on}
                      className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 text-[11px] font-semibold transition
                                  ${on ? 'border-brand bg-brand/10 text-brand' : 'border-line text-mist hover:border-mist'}`}>
                <Icon size={18} /> {c.label}
              </button>
            )
          })}
        </div>
      </div>

      <label className="block">
        <span className={heading}>Business name</span>
        <input className={field} value={f.name} onChange={set('name')} maxLength={80} placeholder="e.g. Snow View Guest House" />
      </label>

      <label className="block">
        <span className={heading}>Phone</span>
        <input className={field} value={f.phone} onChange={set('phone')} type="tel" inputMode="tel" maxLength={16} placeholder="+91 98765 43210" />
        <span className="block text-[11px] text-mist mt-1">Shown publicly, so riders can call you with one tap.</span>
      </label>

      <label className="block">
        <span className={heading}>Area or address</span>
        <input className={field} value={f.address} onChange={set('address')} maxLength={120} placeholder="Near the bus stand, Leh" />
      </label>

      <label className="block">
        <span className={heading}>About</span>
        <textarea className={`${field} min-h-24 resize-none`} value={f.description} onChange={set('description')} maxLength={300}
                  placeholder="Rooms with hot water, covered parking for bikes, open late…" />
        <span className="block text-[11px] text-mist mt-1 text-right tabular-nums">{f.description.length}/300</span>
      </label>

      <label className="block">
        <span className={heading}>Website or Instagram <span className="normal-case tracking-normal">(optional)</span></span>
        <input className={field} value={f.url} onChange={set('url')} inputMode="url" maxLength={200} placeholder="instagram.com/yourplace" />
      </label>

      <div>
        <span className={heading}>Location</span>
        {f.lat == null ? (
          <div className="flex gap-2">
            <button type="button" onClick={locate} disabled={locating}
                    className="flex-1 rounded-xl bg-brand/10 border border-brand/40 text-brand py-2.5 text-sm font-semibold disabled:opacity-50">
              {locating ? 'Finding you…' : 'Use my location'}
            </button>
            <button type="button" onClick={pinOnMap}
                    className="flex-1 rounded-xl border border-line py-2.5 text-sm font-semibold hover:border-mist">
              Pin it on a map
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <PinMap key={pinKey} lat={f.lat} lng={f.lng} onMove={(a, b) => setF((v) => ({ ...v, lat: a, lng: b }))} />
            <div className="flex items-center justify-between text-[11px] text-mist">
              <span className="tabular-nums">{f.lat}, {f.lng} · tap the map to move the pin</span>
              <button type="button" onClick={locate} disabled={locating} className="text-brand font-semibold">
                {locating ? 'Finding…' : 'Use my location'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <span className={heading}>Photo <span className="normal-case tracking-normal">(optional)</span></span>
        {shown ? (
          <div className="space-y-2">
            <img src={shown} alt="" className="w-full h-44 object-cover rounded-2xl bg-raised" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setCamera(true)} className="flex-1 rounded-full border border-line py-2 text-xs font-semibold">Retake</button>
              <button type="button" onClick={() => { setPhoto(null); setF((v) => ({ ...v, removePhoto: true })) }}
                      className="flex-1 rounded-full border border-line py-2 text-xs font-semibold hover:border-rose hover:text-rose">Remove</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setCamera(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-line py-4 text-sm text-mist hover:border-brand hover:text-brand">
            <CameraIcon size={18} /> Take a photo of your place
          </button>
        )}
        <span className="block text-[11px] text-mist mt-1">Taken with the camera, so riders see the real place.</span>
      </div>

      {error && <p className="text-sm text-rose">{error}</p>}

      <div className="space-y-2 pb-4">
        <button type="submit" disabled={busy} className="w-full rounded-full bg-brand text-ink py-3 text-sm font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : initial.id ? 'Save changes' : 'List my business — free'}
        </button>
        <button type="button" onClick={onCancel} className="w-full rounded-full border border-line py-2.5 text-sm font-semibold text-mist">Cancel</button>
        <p className="text-[11px] text-mist text-center leading-relaxed">
          Free — no sign-up fee, no commission. Trekov removes listings that are fake or misleading.
        </p>
      </div>

      {camera && <Camera onCapture={(file) => { setPhoto(file); setF((v) => ({ ...v, removePhoto: false })); setCamera(false) }}
                         onCancel={() => setCamera(false)} />}
    </form>
  )
}

const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const BLANK_PRODUCT = { name: '', price_inr: '', unit: '', description: '', available: true }

/**
 * Products and prices on a listing. The listing itself is free; products
 * need the monthly products plan, which Trekov switches on per listing.
 */
function ProductsSection({ listing }) {
  const active = planActive(listing)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(null)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const load = () => myProducts(listing.id).then(setItems).catch((e) => { setItems([]); setError(e.message) })
  useEffect(() => { if (active && open && items === null) load() }, [active, open])

  if (!active) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-brand/40 p-3">
        <p className="text-xs font-semibold">Show your rooms, rentals or menu with prices</p>
        <p className="text-[11px] text-mist mt-0.5 leading-relaxed">
          Products plan · {formatInr(PRODUCTS_PLAN_INR)}/month, unlimited products. Your listing stays free either way.
        </p>
        <a href={activationMailto(listing)}
           className="mt-2 inline-block rounded-full bg-brand text-ink px-3 py-1.5 text-xs font-semibold">
          Request the products plan
        </a>
        <p className="text-[10px] text-mist mt-1.5">Online payment is coming soon — we'll reply by email to set it up.</p>
      </div>
    )
  }

  const done = () => { setEditing(null); load() }
  return (
    <div className="mt-3 rounded-xl border border-line p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className="w-full flex items-center justify-between gap-2 text-left">
        <span className="text-xs font-semibold">Products & prices{items ? ` · ${items.length}` : ''}</span>
        <span className="text-[10px] text-brand shrink-0">Plan active till {fmtDate(listing.products_until)}</span>
      </button>
      {open && (
        <div className="mt-2.5 space-y-2">
          {error && <p className="text-xs text-rose">{error}</p>}
          {items === null ? <p className="text-xs text-mist">Loading…</p> : items.map((p) => (
            editing?.id === p.id ? (
              <ProductEditor key={p.id} listingId={listing.id} initial={editing} onDone={done} onCancel={() => setEditing(null)} />
            ) : (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <span className={`flex-1 truncate ${p.available ? '' : 'text-mist line-through'}`}>{p.name}</span>
                <span className="font-semibold tabular-nums">
                  {formatInr(p.price_inr)}{p.unit && <span className="text-mist font-normal"> {p.unit}</span>}
                </span>
                <button type="button" onClick={() => setEditing({ ...p })} className="text-brand font-semibold">Edit</button>
              </div>
            )
          ))}
          {editing && !editing.id ? (
            <ProductEditor listingId={listing.id} initial={editing} onDone={done} onCancel={() => setEditing(null)} />
          ) : !editing && (
            <button type="button" onClick={() => setEditing({ ...BLANK_PRODUCT, position: items?.length ?? 0 })}
                    className="w-full rounded-full border border-dashed border-line py-2 text-xs font-semibold text-mist hover:border-brand hover:text-brand">
              + Add a product
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ProductEditor({ listingId, initial, onDone, onCancel }) {
  const [p, setP] = useState(initial)
  const set = (k) => (e) => setP((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const problem = p.name.trim().length < 2 ? 'Add a product name.'
    : String(p.price_inr).trim() === '' ? 'Enter the price in rupees.' : ''

  async function save() {
    if (problem) return setError(problem)
    setBusy(true); setError('')
    try { await saveProduct(listingId, p); onDone() } catch (e) { setError(e.message); setBusy(false) }
  }
  async function remove() {
    setBusy(true); setError('')
    try { await deleteProduct(p.id); onDone() } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="rounded-xl bg-raised/60 p-2.5 space-y-2">
      <input className={field} value={p.name} onChange={set('name')} maxLength={80} placeholder="e.g. Deluxe room with valley view" />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mist">₹</span>
          <input className={`${field} pl-7`} value={p.price_inr} inputMode="numeric" maxLength={8} placeholder="1500"
                 onChange={(e) => setP((v) => ({ ...v, price_inr: e.target.value.replace(/[^\d]/g, '') }))} />
        </div>
        <select className={`${field} flex-1`} value={p.unit} onChange={set('unit')}>
          <option value="">No unit</option>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <input className={field} value={p.description} onChange={set('description')} maxLength={300} placeholder="Short note (optional)" />
      <label className="flex items-center gap-2 text-xs text-mist">
        <input type="checkbox" checked={p.available} onChange={set('available')} /> Available now
      </label>
      {error && <p className="text-xs text-rose">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy}
                className="flex-1 rounded-full bg-brand text-ink py-1.5 text-xs font-semibold disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">Cancel</button>
        {p.id && (confirm ? (
          <button type="button" onClick={remove} disabled={busy} className="rounded-full bg-rose text-white px-3 py-1.5 text-xs font-semibold">
            Delete
          </button>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} aria-label="Delete product"
                  className="rounded-full border border-line px-2.5 py-1.5 text-mist hover:text-rose">
            <TrashIcon size={13} />
          </button>
        ))}
      </div>
    </div>
  )
}
