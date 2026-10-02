import { useEffect, useRef } from 'react'
import { pushBackLayer } from './native'

/** While mounted (and `active`), Android's back button calls `close` instead of leaving the screen. */
export default function useBackClose(close, active = true) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => (active ? pushBackLayer(() => ref.current?.()) : undefined), [active])
}
