import { useState } from 'react'
import { useStore } from '../lib/store'
import { HANDLE_HINT, normaliseHandle, saveProfile, squareDataUrl, validHandle } from '../lib/profile'
import { CloseIcon } from './Icons'
import Camera from './Camera'
import Portal from './Portal'

const MAX_BIO = 140

/**
 * Editing your name, handle, bio and picture.
 *
 * The picture is taken here and now, like every other photo in Trekov. There
 * is no gallery picker anywhere in the app and this is not the place to add
 * the first one.
 */
export default function ProfileEditor({ onClose }) {
  const profile = useStore((s) => s.profile)
  const signedIn = useStore((s) => Boolean(s.account))

  const [name, setName] = useState(profile.name)
  const [handle, setHandle] = useState(profile.handle)
  const [bio, setBio] = useState(profile.bio)
  const [avatar, setAvatar] = useState(profile.avatar)
  const [shooting, setShooting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleError = handle && !validHandle(handle) ? HANDLE_HINT : ''
  const canSave = name.trim() && validHandle(handle) && !saving

  async function capture(file) {
    setShooting(false)
    try {
      setAvatar(await squareDataUrl(file))
    } catch (e) {
      setError(e.message)
    }
  }

  async function save() {
    setSaving(true)
    setError('')
    const res = await saveProfile({ name: name.trim(), handle, bio: bio.trim(), avatar })
    setSaving(false)

    // The local save always lands. Only the account mirror can fail, and the
    // one failure worth explaining is a handle somebody else already has.
    if (res.reason === 'taken') {
      setError(`@${handle} is taken. Your other changes were saved.`)
      return
    }
    if (res.reason) {
      setError(`Saved on this device. It will reach your account once the connection is back.`)
      return
    }
    onClose()
  }

  if (shooting) {
    return <Camera onCapture={capture} onCancel={() => setShooting(false)} />
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[1250] flex items-end justify-center" role="dialog" aria-label="Edit profile">
        <button className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
        <div className="sheet-up relative w-full max-w-[520px] max-h-[85vh] flex flex-col rounded-t-3xl border-t border-line bg-ink">
          <header className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
            <div className="min-w-0">
              <h2 className="font-semibold">Edit profile</h2>
              <p className="text-xs text-mist">
                {signedIn ? 'Visible to anyone who searches for you' : 'Saved on this device'}
              </p>
            </div>
            <button onClick={onClose} className="text-mist hover:text-white p-1" aria-label="Close">
              <CloseIcon size={22} />
            </button>
          </header>

          <div className="overflow-y-auto px-5 py-5 space-y-5">
            <div className="flex items-center gap-4">
              <img src={avatar} alt="" className="size-20 rounded-full object-cover ring-2 ring-brand/40 shrink-0" />
              <div>
                <button onClick={() => setShooting(true)}
                        className="rounded-full border border-line px-4 py-2 text-sm font-semibold
                                   hover:border-brand hover:text-brand">
                  Take a new photo
                </button>
                <p className="text-[11px] text-mist mt-1.5 leading-snug">
                  Camera only, like every photo here.
                </p>
              </div>
            </div>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-[0.14em] text-mist mb-1.5">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
                     className="w-full bg-raised rounded-xl px-3 py-2.5 text-sm outline-none
                                focus:ring-1 focus:ring-brand" />
            </label>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-[0.14em] text-mist mb-1.5">Handle</span>
              <div className="flex items-center bg-raised rounded-xl px-3">
                <span className="text-mist text-sm">@</span>
                <input value={handle} onChange={(e) => setHandle(normaliseHandle(e.target.value))}
                       className="flex-1 bg-transparent px-1 py-2.5 text-sm outline-none min-w-0" />
              </div>
              <span className={`block text-[11px] mt-1 ${handleError ? 'text-sun' : 'text-mist'}`}>
                {handleError || HANDLE_HINT}
              </span>
            </label>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-[0.14em] text-mist mb-1.5">Bio</span>
              <textarea value={bio} onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))} rows={3}
                        className="w-full bg-raised rounded-xl px-3 py-2.5 text-sm outline-none resize-none
                                   focus:ring-1 focus:ring-brand" />
              <span className="block text-[11px] text-mist mt-1 text-right tabular-nums">
                {MAX_BIO - bio.length}
              </span>
            </label>

            {error && <p className="text-[12px] text-sun leading-relaxed">{error}</p>}
          </div>

          <div className="px-5 py-4 border-t border-line shrink-0"
               style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            <button onClick={save} disabled={!canSave}
                    className="w-full rounded-full bg-brand text-ink font-semibold py-3 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
