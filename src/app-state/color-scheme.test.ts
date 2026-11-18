test('theme initialization and changes tolerate blocked iframe storage', () => {
  const storage = Object.getOwnPropertyDescriptor(window, 'localStorage')!
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('Storage denied')
    },
  })
  try {
    const {colorSchemeAtom} = require('./color-scheme')
    expect(colorSchemeAtom.get()).toBe(0)
    expect(() => colorSchemeAtom.set(1)).not.toThrow()
    expect(colorSchemeAtom.get()).toBe(1)
  } finally {
    Object.defineProperty(window, 'localStorage', storage)
  }
})
