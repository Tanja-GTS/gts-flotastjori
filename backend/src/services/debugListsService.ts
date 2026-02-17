import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig, getListIds } from './msListsConfig';

type GraphList = {
  id: string;
  displayName?: string;
  name?: string;
};

type GraphListsResponse = {
  value: GraphList[];
};

type GraphColumn = Record<string, unknown> & {
  name?: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  readOnly?: boolean;
  required?: boolean;
};

type GraphColumnsResponse = {
  value: GraphColumn[];
};

type GraphListItem = {
  id: string;
  fields?: Record<string, unknown>;
};

type GraphListItemsResponse = {
  value: GraphListItem[];
};

export type DebugListKey = 'patterns' | 'instances';

function resolveListId(list: DebugListKey): string {
  const ids = getListIds();
  if (list === 'patterns') return ids.shiftPatternsListId;
  return ids.shiftInstancesListId;
}

function columnTypeHint(col: GraphColumn): string {
  // Graph columns have one of these type objects present (text, choice, lookup, number, dateTime, ...)
  const typeKeys = [
    'text',
    'choice',
    'multiChoice',
    'lookup',
    'number',
    'currency',
    'dateTime',
    'boolean',
    'personOrGroup',
    'hyperlinkOrPicture',
    'calculated',
    'contentApprovalStatus',
  ];

  for (const key of typeKeys) {
    if (Object.prototype.hasOwnProperty.call(col, key)) return key;
  }
  return 'unknown';
}

async function getListFieldDiagnosticsByListId(params: {
  listId: string;
  sample?: number;
  debugListLabel?: string;
}) {
  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const siteId = graph.siteId;
  const listId = String(params.listId || '').trim();
  if (!listId) throw new Error('Missing listId');

  const sample = Math.max(0, Math.min(20, Number(params.sample ?? 3) || 3));

  const columnsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    siteId
  )}/lists/${encodeURIComponent(listId)}/columns?$top=999`;

  const columnsRes = await graphGet<GraphColumnsResponse>(columnsUrl, token);
  const columns = (columnsRes.value || []).map((c) => ({
    name: String(c.name || ''),
    displayName: String(c.displayName || ''),
    description: String(c.description || ''),
    hidden: Boolean(c.hidden),
    readOnly: Boolean(c.readOnly),
    required: Boolean(c.required),
    type: columnTypeHint(c),
    raw: c,
  }));

  let sampleItems: Array<{ id: string; fields: Record<string, unknown> }> = [];
  if (sample > 0) {
    const itemsUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
      siteId
    )}/lists/${encodeURIComponent(listId)}/items?$top=${sample}&$expand=fields`;

    const itemsRes = await graphGet<GraphListItemsResponse>(itemsUrl, token);
    sampleItems = (itemsRes.value || []).map((item) => ({
      id: String(item.id || ''),
      fields: item.fields || {},
    }));
  }

  const sampleFieldKeys = Array.from(
    new Set(sampleItems.flatMap((i) => Object.keys(i.fields || {})))
  ).sort((a, b) => a.localeCompare(b));

  return {
    siteId,
    listId,
    list: params.debugListLabel ?? null,
    columns,
    sample: {
      count: sampleItems.length,
      fieldKeys: sampleFieldKeys,
      items: sampleItems,
    },
  };
}

export async function getListFieldDiagnostics(params: {
  list: DebugListKey;
  sample?: number;
}) {
  const listId = resolveListId(params.list);
  return getListFieldDiagnosticsByListId({
    listId,
    sample: params.sample,
    debugListLabel: params.list,
  });
}

export async function getListFieldDiagnosticsForListId(params: {
  listId: string;
  sample?: number;
}) {
  return getListFieldDiagnosticsByListId({
    listId: params.listId,
    sample: params.sample,
  });
}

export async function listSiteLists() {
  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists?$top=999`;

  const res = await graphGet<GraphListsResponse>(url, token);
  return (res.value || []).map((l) => ({
    id: String(l.id || ''),
    displayName: String(l.displayName || ''),
    name: String(l.name || ''),
  }));
}
