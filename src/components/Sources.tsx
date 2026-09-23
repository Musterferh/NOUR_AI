import type { SourceReference } from '@/types/frontend';

function officialLink(value?: string): string | undefined {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export default function Sources({ sources = [] }: { sources?: SourceReference[] }) {
  if (!sources.length) return null;
  return <details className="sources">
    <summary>View {sources.length} source{sources.length === 1 ? '' : 's'}</summary>
    <ol>{sources.map(source => <li key={source.id}>
      <strong>{source.title}</strong>
      <span className="source-meta">{source.provenance === 'primary-source-checked'
        ? `Publication checked${source.verifiedAt ? ` · ${source.verifiedAt}` : ''}`
        : 'Study material · independent verification needed'}</span>
      {officialLink(source.url) && <a href={officialLink(source.url)} target="_blank" rel="noopener noreferrer">{source.publisher || 'View publication'}</a>}
      {source.publishedDate && <span className="source-meta">Published: {source.publishedDate}</span>}
      {source.currencyNote && <p>{source.currencyNote}</p>}
      <span className="source-meta">Reference: {source.id}</span>
      <span className="source-meta">{[source.section, source.page ? `Page ${source.page}` : null, source.status].filter(Boolean).join(' · ')}</span>
      {source.excerpt && <p>{source.excerpt}</p>}
    </li>)}</ol>
  </details>;
}
