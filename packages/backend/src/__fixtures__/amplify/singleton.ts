// `defineAuth` / `defineData` are per-process singletons: their factory
// classes bump a static `factoryCount` and throw
// MultipleSingletonResourcesError on a second call. Amplify documents the
// counter as "publicly accessible for testing purpose only"; we reset it
// so one vitest file can synthesize
// several independent backends (current vs. baseline vs. customized).
//
// The class isn't exported, so it is captured from the first instance.

export function resettableSingleton<A extends unknown[], T>(
  define: (...args: A) => T
): (...args: A) => T {
  let factoryClass: { factoryCount: number } | undefined
  return (...args: A) => {
    if (factoryClass) factoryClass.factoryCount = 0
    const factory = define(...args)
    factoryClass = (factory as object).constructor as unknown as { factoryCount: number }
    if (typeof factoryClass.factoryCount !== 'number') {
      throw new Error('Amplify factory no longer exposes a static factoryCount; update this fixture')
    }
    return factory
  }
}
