import { describe, expect, it } from 'vitest';
import { isApiErrorBody } from '../src/errors.js';

describe('isApiErrorBody', () => {
  it('accepts the envelope with a known code and a message', () => {
    expect(isApiErrorBody({ error: { code: 'not_found', message: 'Not found.' } })).toBe(true);
  });

  it('accepts the envelope with details', () => {
    const body = { error: { code: 'internal_error', message: 'Oops.', details: { id: 'r1' } } };
    expect(isApiErrorBody(body)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string body', 'Internal Server Error'],
    ['an array', [{ error: { code: 'not_found', message: 'x' } }]],
    ['an empty object', {}],
    ['a null error', { error: null }],
    ['a string error', { error: 'not_found' }],
    ['a missing code', { error: { message: 'Not found.' } }],
    ['a non-string code', { error: { code: 404, message: 'Not found.' } }],
    ['an unknown code', { error: { code: 'teapot', message: 'Not found.' } }],
    ['a code that is an Object.prototype key', { error: { code: 'toString', message: 'x' } }],
    ['a missing message', { error: { code: 'not_found' } }],
    ['a non-string message', { error: { code: 'not_found', message: { text: 'x' } } }],
  ])('rejects %s', (_label, body) => {
    expect(isApiErrorBody(body)).toBe(false);
  });
});
