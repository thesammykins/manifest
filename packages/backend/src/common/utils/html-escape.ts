const HTML_ESCAPE_RE = /[&<>]/g;

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

export function escapeHtml(input: string): string {
  return input.replace(HTML_ESCAPE_RE, (char) => HTML_ESCAPE_MAP[char]);
}
