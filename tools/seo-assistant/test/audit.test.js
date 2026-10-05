import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDigest } from '../src/audit.js';

describe('formatDigest', () => {
  it('reports an empty draft queue clearly', () => {
    assert.equal(formatDigest([]), 'No drafts right now. Nothing needs attention.');
  });

  it('orders worst-first with top findings', () => {
    const text = formatDigest([
      { title: 'Good draft', score: 92, findings: [{ message: 'Minor note' }] },
      { title: 'Rough draft', score: 41, findings: [{ message: 'No meta description' }] },
    ]);
    const rough = text.indexOf('Rough draft');
    const good = text.indexOf('Good draft');
    assert.ok(rough !== -1 && good !== -1 && rough < good);
    assert.match(text, /score 41/);
    assert.match(text, /No meta description/);
  });
});
