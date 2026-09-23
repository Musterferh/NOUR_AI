/** Accept common reference formatting while retaining every unknown ID for validation. */
export function extractCitationIds(content: string): string[] {
  return [...content.matchAll(/\[source:([^\]\r\n]*)\]/g)]
    .flatMap(match => match[1].split(/[;,]/).map(id => id.trim().replace(/^source:\s*/, '')));
}
