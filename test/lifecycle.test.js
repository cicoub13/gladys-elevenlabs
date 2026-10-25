import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { exitOnUnhandledRejection } from '../src/lifecycle.js';

test('exitOnUnhandledRejection logs the reason at error level, then exits with code 1', () => {
  const processRef = new EventEmitter();
  const logged = [];
  const exits = [];
  exitOnUnhandledRejection({
    logger: { error: (...args) => logged.push(args) },
    exit: (code) => exits.push(code),
    processRef,
  });

  const reason = new Error('boom');
  processRef.emit('unhandledRejection', reason);

  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes(reason));
  assert.deepEqual(exits, [1]);
});
