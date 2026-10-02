// This device's id, sent with every request so the server can keep an
// account to one device at a time (supabase/memberships.sql). It lives in
// localStorage, so signing back in on the same phone is the same device.
const KEY = 'trekov.deviceId'

export function deviceId() {
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = `d_${crypto.randomUUID().replace(/-/g, '')}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return `d_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  }
}
