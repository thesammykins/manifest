import { escapeHtml } from './html-escape';

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')"> & done`)).toBe(
      `&lt;img src=x onerror="alert('xss')"&gt; &amp; done`,
    );
  });

  it('leaves normal plain text unchanged', () => {
    expect(escapeHtml('messages array is required')).toBe('messages array is required');
  });
});
