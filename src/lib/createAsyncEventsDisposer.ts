import {EventCallback, EventName, listen, Options, UnlistenFn} from "@tauri-apps/api/event";


export function createAsyncEventsDisposer() {
  let disposed = false
  const disposers: UnlistenFn[] = []

  return {
    async add(factory: () => Promise<UnlistenFn>) {
      if (disposed) return

      const unlisten = await factory()

      if (disposed) {
        unlisten()
        return
      }

      disposers.push(unlisten)
    },

    async addListener<T>(event: EventName, handler: EventCallback<T>, options?: Options) {
      if (disposed) return

      const unlisten = await listen<T>(event, (e) => {
        if (this.isDisposed) return;
        handler.call(this, e)
      }, options)

      if (disposed) {
        unlisten()
        return
      }

      disposers.push(unlisten)
    },

    dispose() {
      if (disposed) return
      disposed = true

      for (const d of disposers) {
        d()
      }
      disposers.length = 0
    },

    get isDisposed() {
      return disposed
    }
  }
}


export type AsyncEventsDisposer = ReturnType<typeof createAsyncEventsDisposer>