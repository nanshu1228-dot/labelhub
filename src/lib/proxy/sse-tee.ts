/**
 * Stream tee with side-effect accumulation.
 *
 * The classic proxy-with-capture pattern: take the upstream's streaming
 * `Response.body`, return a `ReadableStream` the client can consume as
 * fast as the network allows, and ALSO feed every byte through a parser
 * so we can persist the assembled trajectory once the stream ends.
 *
 * Properties we care about:
 *   - **No buffering between upstream and client.** Each chunk we receive
 *     from upstream is written to the client output IMMEDIATELY. The parser
 *     side runs synchronously after the write so it never gates the wire.
 *   - **Backpressure honored.** `writer.write(value)` awaits — if the client
 *     is slow, upstream reads naturally pause. No memory explosion.
 *   - **Persistence runs AFTER the client receives the last byte.** We close
 *     the writer first (client sees `data: [DONE]` and disconnects), then
 *     fire `onDone` to write to DB. The client's perceived latency is the
 *     same as a direct upstream proxy.
 *   - **Errors mid-stream don't poison the proxy.** Capture failures log
 *     and swallow; client still sees a complete passthrough.
 */

import { SseEventStream, type SseEvent } from './sse-stream'

export interface TeeOptions {
  /** Upstream Response from `fetch(...)`. We consume its body. */
  upstream: Response
  /** Called for each parsed SSE event. Side-effect only; cannot block writes. */
  onEvent: (event: SseEvent) => void
  /**
   * Called once after the upstream signals end-of-stream, AFTER the client
   * has been closed. Awaited — but errors are caught + logged, never thrown
   * to the request. Place your DB write here.
   */
  onDone: () => Promise<void>
  /** Optional: called if the upstream stream errors out. */
  onError?: (err: unknown) => void
}

/**
 * Returns a `ReadableStream<Uint8Array>` suitable as the body of a
 * `NextResponse` / `Response`. Pumping starts immediately in the background.
 */
export function teeWithAccumulator(opts: TeeOptions): ReadableStream<Uint8Array> {
  const parser = new SseEventStream()
  const upstreamBody = opts.upstream.body
  if (!upstreamBody) {
    // Upstream had no body — emit an empty stream that fires onDone.
    return new ReadableStream({
      start(controller) {
        controller.close()
        opts.onDone().catch((e) => {
           
          console.warn('sse-tee onDone failed (empty body):', e)
        })
      },
    })
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = upstreamBody.getReader()

      const pump = async (): Promise<void> => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              for (const ev of parser.flushFinal()) opts.onEvent(ev)
              break
            }
            // 1) Forward to client immediately (no buffering, no parsing first)
            controller.enqueue(value)
            // 2) Side-effect parse — never throws to the wire
            try {
              for (const ev of parser.push(value)) opts.onEvent(ev)
            } catch (e) {
               
              console.warn('sse-tee parse error:', e)
            }
          }
          controller.close()
          // 3) Persistence runs AFTER client close
          try {
            await opts.onDone()
          } catch (e) {
             
            console.warn('sse-tee onDone failed:', e)
          }
        } catch (e) {
          opts.onError?.(e)
          controller.error(e)
        }
      }

      // Kick off pumping. Don't await; ReadableStream consumes lazily.
      void pump()
    },
    cancel(reason) {
      // Client disconnected. Try to close the upstream reader cleanly so
      // we don't leak the connection.
      void upstreamBody.cancel(reason).catch(() => {})
    },
  })
}
