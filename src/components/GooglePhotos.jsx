import { useEffect, useState } from 'react'
import { googlePhotos } from '../lib/placePhotos'

/** A strip of Google's live photos of a place, each credited to its author. */
export default function GooglePhotos({ place }) {
  const [photos, setPhotos] = useState(null)

  useEffect(() => {
    let live = true
    googlePhotos(place).then((p) => live && setPhotos(p))
    return () => { live = false }
  }, [place])

  if (!photos?.length) return null

  return (
    <section className="px-5 py-4 border-b border-line">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs uppercase tracking-[0.14em] text-mist">Photos on Google</p>
        <span className="text-[10px] text-mist">Google Maps</span>
      </div>
      <ul className="flex gap-2 overflow-x-auto no-bar pb-1">
        {photos.map((ph, i) => (
          <li key={ph.src} className="shrink-0 w-40">
            <img src={ph.src} alt={`${place.name} — photo ${i + 1}`} loading="lazy"
                 className="w-40 h-28 rounded-xl object-cover bg-raised" />
            {ph.authors[0] && (
              <a href={ph.authors[0].uri} target="_blank" rel="noreferrer"
                 className="block text-[10px] text-mist truncate mt-1 hover:text-white">
                © {ph.authors[0].name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
