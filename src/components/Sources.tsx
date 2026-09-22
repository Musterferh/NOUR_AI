import type { SourceReference } from '@/types/frontend';

export default function Sources({ sources = [] }: { sources?: SourceReference[] }) {
  if (!sources.length) return null;
  return <details className="sources">
    <summary>View {sources.length} source{sources.length === 1 ? '' : 's'}</summary>
    <ol>{sources.map(source => <li key={source.id}>
      <strong>{source.title}</strong>
      <span className="source-meta">Reference: {source.id}</span>
      <span className="source-meta">{[source.section, source.page ? `Page ${source.page}` : null, source.status].filter(Boolean).join(' · ')}</span>
      {source.excerpt && <p>{source.excerpt}</p>}
    </li>)}</ol>
  </details>;
}
