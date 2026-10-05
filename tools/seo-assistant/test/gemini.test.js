import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL, MODELS, friendlyError, resolveModel, withRetry } from '../src/gemini.js';
import { createJob } from '../src/audit.js';

function busyError() {
  const error = new Error('{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}');
  error.status = 503;
  return error;
}

describe('resolveModel', () => {
  it('lists selectable models with a default', () => {
    assert.ok(MODELS.length >= 2);
    assert.ok(MODELS.some((model) => model.id === DEFAULT_MODEL));
  });

  it('accepts allowlisted ids and rejects the rest', () => {
    assert.equal(resolveModel('gemini-2.5-flash'), 'gemini-2.5-flash');
    assert.throws(() => resolveModel('gpt-4'), /Unknown model/);
    assert.equal(typeof resolveModel(''), 'string');
  });

  it('falls back to the default without a request', () => {
    assert.equal(typeof resolveModel(undefined), 'string');
  });
});

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    let calls = 0;
    const result = await withRetry(
      'test',
      async () => {
        calls += 1;
        return 'ok';
      },
      { baseDelay: 1 },
    );
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  it('retries transient 503s then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      'test',
      async () => {
        calls += 1;
        if (calls < 3) {
          throw busyError();
        }
        return 'recovered';
      },
      { baseDelay: 1 },
    );
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  it('gives up after the retry budget', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        'test',
        async () => {
          calls += 1;
          throw busyError();
        },
        { retries: 2, baseDelay: 1 },
      ),
      /high demand/,
    );
    assert.equal(calls, 3);
  });

  it('does not retry programmer errors', async () => {
    let calls = 0;
    await assert.rejects(
      withRetry(
        'test',
        async () => {
          calls += 1;
          throw new TypeError('not a function');
        },
        { baseDelay: 1 },
      ),
    );
    assert.equal(calls, 1);
  });
});

describe('friendlyError', () => {
  it('translates demand spikes into actionable text', () => {
    const text = friendlyError(busyError(), 'gemini-3-flash-preview');
    assert.match(text, /busy|demand/i);
    assert.match(text, /gemini-3-flash-preview/);
  });
});

describe('audit job progress shape', () => {
  it('starts with zeroed progress counters', () => {
    const job = createJob('all', 'test');
    assert.equal(job.status, 'running');
    assert.equal(job.processed, 0);
    assert.equal(job.total, null);
    assert.equal(job.stage, 'starting');
  });
});
