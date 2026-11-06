import {
  createAutosave,
  type Autosave,
  type AutosaveScheduler,
  type SaveRevision,
  type AutosaveStatus,
} from '@lp-labs/document-autosave';
const scheduler: AutosaveScheduler = { now: () => 0, schedule: () => 1, cancel: () => {} };
const writes: Readonly<SaveRevision>[] = [];
const save: Autosave = createAutosave(async (revision) => {
  writes.push(revision);
}, scheduler);
const revision: number = save.update('draft');
const status: AutosaveStatus = save.status();
// @ts-expect-error persistence must return a promise
createAutosave(() => 1, scheduler);
void [revision, status];
