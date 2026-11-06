import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutosave } from '../dist/esm/index.js';

function clock() {
  let now = 0,
    id = 0;
  const tasks = new Map();
  return {
    now: () => now,
    schedule: (fn, delay) => {
      tasks.set(++id, { fn, at: now + delay });
      return id;
    },
    cancel: (id) => tasks.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...tasks])
        if (t.at <= now) {
          tasks.delete(id);
          t.fn();
        }
    },
    size: () => tasks.size,
  };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('debounce resets using injected clock and writes actual latest revision', async () => {
  const scheduler = clock(),
    writes = [],
    save = createAutosave(
      async (r) => {
        writes.push(r);
      },
      scheduler,
      { delay: 10 },
    );
  save.update('a');
  scheduler.advance(5);
  save.update('b');
  scheduler.advance(9);
  await tick();
  assert.equal(writes.length, 0);
  scheduler.advance(1);
  await tick();
  assert.deepEqual(writes, [{ revision: 2, text: 'b', updatedAt: 5 }]);
  assert.equal(save.status().dirty, false);
});
test('flush serially drains edits made during an in-flight write', async () => {
  const scheduler = clock(),
    gate = deferred(),
    writes = [];
  let active = 0,
    maximum = 0;
  const save = createAutosave(async (r) => {
    maximum = Math.max(maximum, ++active);
    writes.push(r.text);
    if (r.revision === 1) await gate.promise;
    active--;
  }, scheduler);
  save.update('old');
  const first = save.flush();
  await tick();
  save.update('new');
  assert.equal(save.flush(), first);
  assert.equal(save.status().savedRevision, 0);
  gate.resolve();
  await first;
  assert.deepEqual(writes, ['old', 'new']);
  assert.equal(maximum, 1);
  assert.equal(save.status().savedRevision, 2);
  assert.equal(save.status().dirty, false);
});
test('failure is explicit, leaves dirty revision and can be retried', async () => {
  const failure = new Error('disk full');
  let fail = true;
  const writes = [];
  const save = createAutosave(async (r) => {
    if (fail) throw failure;
    writes.push(r);
  }, clock());
  save.update('draft');
  await assert.rejects(save.flush(), (e) => e === failure);
  assert.equal(save.status().error, failure);
  assert.equal(save.status().dirty, true);
  assert.equal(save.status().saving, false);
  fail = false;
  await save.flush();
  assert.equal(writes[0].text, 'draft');
  assert.equal(save.status().error, null);
});
test('cancel removes debounce but does not lose in-flight or newer text', async () => {
  const scheduler = clock(),
    gate = deferred(),
    writes = [];
  const save = createAutosave(async (r) => {
    writes.push(r.text);
    if (r.revision === 1) await gate.promise;
  }, scheduler);
  save.update('one');
  save.cancel();
  scheduler.advance(1000);
  await tick();
  assert.deepEqual(writes, []);
  const pending = save.flush();
  await tick();
  save.update('two');
  save.cancel();
  gate.resolve();
  await pending;
  assert.deepEqual(writes, ['one', 'two']);
  assert.equal(save.status().dirty, false);
});
test('timer failures notify and notification errors are contained', async () => {
  const scheduler = clock(),
    errors = [],
    failure = new Error('offline');
  const save = createAutosave(
    async () => {
      throw failure;
    },
    scheduler,
    {
      delay: 0,
      onError: (e) => {
        errors.push(e);
        throw new Error('observer');
      },
    },
  );
  save.update('x');
  scheduler.advance(0);
  await tick();
  assert.deepEqual(errors, [failure]);
  assert.equal(save.status().error, failure);
});
test('invalid input, delay and clock reject without revision changes', async () => {
  assert.throws(() => createAutosave(async () => {}, clock(), { delay: -1 }));
  const save = createAutosave(async () => {}, clock());
  assert.throws(() => save.update('x'.repeat(1000001)));
  assert.equal(save.status().revision, 0);
  await save.flush();
  assert.throws(() => createAutosave(async () => {}, { ...clock(), now: () => NaN }).update('x'));
});
test('a failed old write rejects shared flushes and retry persists the newest revision', async () => {
  const gate = deferred(),
    scheduler = clock(),
    writes = [],
    failure = new Error('in-flight failure');
  let first = true;
  const save = createAutosave(async (revision) => {
    writes.push(revision.text);
    if (first) {
      first = false;
      await gate.promise;
    }
  }, scheduler);
  save.update('old');
  const flushing = save.flush();
  await tick();
  save.update('latest');
  assert.equal(save.flush(), flushing);
  gate.reject(failure);
  await assert.rejects(flushing, (error) => error === failure);
  assert.equal(save.status().savedRevision, 0);
  assert.equal(save.status().revision, 2);
  assert.equal(save.status().dirty, true);
  await save.flush();
  assert.deepEqual(writes, ['old', 'latest']);
  assert.equal(save.status().savedRevision, 2);
});
test('a cancelled stale scheduler callback cannot trigger persistence', async () => {
  const callbacks = [],
    writes = [];
  const save = createAutosave(
    async (revision) => {
      writes.push(revision.text);
    },
    {
      now: () => 10,
      schedule(callback) {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancel() {},
    },
  );
  save.update('first');
  save.update('second');
  callbacks[0]();
  await tick();
  assert.deepEqual(writes, []);
  save.cancel();
  callbacks[1]();
  await tick();
  assert.deepEqual(writes, []);
  await save.flush();
  assert.deepEqual(writes, ['second']);
});
