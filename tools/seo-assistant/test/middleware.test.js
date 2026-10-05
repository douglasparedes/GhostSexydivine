import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies } from '../src/middleware.js';

function runMiddleware(headers) {
  const req = { headers };
  let nextCalled = false;
  parseCookies(req, {}, () => {
    nextCalled = true;
  });
  return { req, nextCalled };
}

describe('parseCookies', () => {
  it('parses cookie pairs onto req.cookies', () => {
    const { req, nextCalled } = runMiddleware({ cookie: 'a=1; b=two' });
    assert.deepEqual(req.cookies, { a: '1', b: 'two' });
    assert.equal(nextCalled, true);
  });

  it('always calls next, even with no cookie header', () => {
    const { req, nextCalled } = runMiddleware({});
    assert.deepEqual(req.cookies, {});
    assert.equal(nextCalled, true);
  });

  it('decodes values and skips malformed parts', () => {
    const { req, nextCalled } = runMiddleware({ cookie: 'x=hello%20world; novalue; y=2' });
    assert.deepEqual(req.cookies, { x: 'hello world', y: '2' });
    assert.equal(nextCalled, true);
  });

  it('passes control so requests never hang in the middleware', () => {
    // Regression test: an earlier version of this middleware never called
    // next(), which hung every request (including /api/health) forever.
    let calls = 0;
    parseCookies({ headers: {} }, {}, () => {
      calls += 1;
    });
    assert.equal(calls, 1);
  });
});
