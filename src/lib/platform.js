// Running inside the Android or iOS app (Capacitor) rather than a browser.
//
// Both stores require their own billing for digital purchases, so the apps
// never show a price or a way to pay for a plan; plans are sold on the web.
// Store rules also forbid pointing people to that, so the apps say nothing
// about where to buy — only that a feature needs an account that has it.
import { Capacitor } from '@capacitor/core'

export const isNativeApp = Capacitor.isNativePlatform()
/** 'android' | 'ios' | 'web' */
export const platform = Capacitor.getPlatform()
