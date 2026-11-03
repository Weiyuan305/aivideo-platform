/** Coalesce refreshes; slow polling must not overwrite a newer user action. */
export function createRefreshLoop<T>(
  load: () => Promise<T>,
  onData: (value: T) => void,
  onError: (error: unknown) => void,
) {
  let stopped = false,
    requested = false,
    pending: Promise<void> | undefined;
  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve();
    requested = true;
    return (pending ??= run().finally(() => {
      pending = undefined;
    }));
  }
  async function run() {
    while (requested && !stopped) {
      requested = false;
      try {
        const data = await load();
        if (!stopped) onData(data);
      } catch (error) {
        if (!stopped) onError(error);
      }
    }
  }
  return {
    refresh,
    stop() {
      stopped = true;
      requested = false;
    },
  };
}
