# @lp-labs/document-autosave

Debounced document persistence with injected clocks, serialized revision writes and explicit failure recovery.

Original, independent MIT implementation. Zero runtime, peer or sibling dependencies. Requires Node.js 18+; strict TypeScript declarations support both ESM and CommonJS.

## Install

```sh
npm install @lp-labs/document-autosave
```

## Quickstart

```js
import { createAutosave } from '@lp-labs/document-autosave';
const writes = [];
const autosave = createAutosave(
  async (revision) => {
    writes.push(revision);
  },
  {
    now: () => 123,
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: (handle) => clearTimeout(handle),
  },
  { delay: 100 },
);
autosave.update('draft');
await autosave.flush();
if (writes[0].text !== 'draft' || autosave.status().dirty) throw new Error('Autosave mismatch');
autosave.cancel();
```

## API and types

`createAutosave(persist, scheduler: AutosaveScheduler, options?): Autosave` injects asynchronous persistence and a scheduler providing now(), schedule(callback, delay), cancel(handle). `update(text)` records an immutable `SaveRevision` with increasing revision and updatedAt and resets the debounce. `flush(): Promise<void>` cancels the timer, serializes writes and drains edits arriving during persistence. Concurrent flushes share one promise. `cancel()` removes only the pending timer; it never aborts a write or discards unsaved revisions. `status(): AutosaveStatus` exposes revision, savedRevision, dirty, saving and the last error. Options: delay (500ms default) and onError for timer-triggered failures.

## Customize

Adapt your clock and scheduler (including deterministic virtual clocks in tests), provide durable revision-aware persistence and tune delay. Use await flush before closing a document; catch its rejected persistence error. This package persists text revisions, not a document codec or version-history DAG.

## Errors and bounds

1,000,000 UTF-16 text units, delay 0..86,400,000, safe-integer revisions and finite clock. O(text) retained latest data plus a single in-flight revision. Writes run serially; a continuously editing caller can keep flush pending until quiescent. No global timer, storage, network, browser or hidden background retry. Scheduler callbacks must be deferred, not invoked inline, and cancellation must not throw. Persistence failure leaves dirty data intact; retry explicitly with flush/update. Scheduler errors propagate synchronously. onError failures are contained. Cancel during a write does not suppress its draining of newer edits.

Invalid runtime inputs throw TypeError/RangeError or the documented typed error. Adapter errors propagate unchanged unless specifically noted; asynchronous methods reject. Inputs must be ordinary typed data, not hostile proxies or accessors. No I/O happens at import time. All runtime exports are documented above and the example executes without optional packages.

## Development

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm run build
npm run typecheck
npm test
npm run format:check
```

Build emits dist/esm and dist/cjs with matching declarations. Tests use Node's test runner; consumer.mts and consumer.cts validate meaningful bare-package imports and expected type errors. Only TypeScript ^5.9.3 and Prettier ^3.6.2 are development dependencies.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
