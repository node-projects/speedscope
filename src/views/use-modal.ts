import {useEffect, useRef} from 'preact/hooks'

export function useModal(onClose: () => void, onDispose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null)
  const callbacks = useRef({onClose, onDispose})
  callbacks.current = {onClose, onDispose}
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    const cancel = (event: Event) => {
      event.preventDefault()
      callbacks.current.onDispose()
      callbacks.current.onClose()
    }
    const isolate = (event: Event) => event.stopPropagation()
    const isolatedEvents = ['paste', 'drop', 'dragover', 'keydown', 'keypress', 'keyup']
    element.addEventListener('cancel', cancel)
    for (const type of isolatedEvents) element.addEventListener(type, isolate)
    const native = typeof element.showModal === 'function'
    if (native) element.showModal()
    else element.setAttribute('open', '')
    element.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    return () => {
      callbacks.current.onDispose()
      element.removeEventListener('cancel', cancel)
      for (const type of isolatedEvents) element.removeEventListener(type, isolate)
      if (native && typeof element.close === 'function') element.close()
      else element.removeAttribute('open')
      previous?.focus()
    }
  }, [])
  return dialog
}
