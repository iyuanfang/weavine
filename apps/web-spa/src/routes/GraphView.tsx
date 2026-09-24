import { Navigate, useParams } from 'react-router-dom';

import type { EntityGraphNodeType } from '../lib/adapter/types';

const SUPPORTED: EntityGraphNodeType[] = ['contact', 'project', 'event', 'action', 'note', 'interaction'];

function detailBase(type: EntityGraphNodeType): string {
  switch (type) {
    case 'contact': return '/contacts';
    case 'project': return '/projects';
    case 'event': return '/events';
    case 'action': return '/actions';
    case 'note': return '/notes';
    case 'interaction': return '/interactions';
  }
}

/**
 * Former standalone graph page. The graph experience now lives on the
 * entity's own detail page under ?tab=graph — one URL per picture — so
 * this route just forwards old links (/graph/contact/x →
 * /contacts/x?tab=graph).
 */
export function GraphView() {
  const params = useParams() as { entityType: string; entityId: string };
  const type = params.entityType as EntityGraphNodeType;
  if (!SUPPORTED.includes(type)) {
    return <div className="page"><div className="error-banner">不支持的实体类型:{params.entityType}</div></div>;
  }
  return <Navigate to={`${detailBase(type)}/${params.entityId}?tab=graph`} replace />;
}

export default GraphView;
