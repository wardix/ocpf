/**
 * Formats a raw user query string into a PostgreSQL tsquery-compatible string
 * for prefix matching (e.g. "Wardi support" -> "Wardi:* & support:*").
 * Sanitizes special search query operators to prevent syntax errors.
 */
export function formatTsQuery(query: string): string {
  if (!query) return '';
  return query
    .trim()
    .split(/\s+/)
    .map(term => term.replace(/['":*&|!]/g, '')) // Remove special operators
    .filter(term => term.length > 0)
    .map(term => `${term}:*`)
    .join(' & ');
}
