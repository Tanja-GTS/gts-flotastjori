import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig } from './msListsConfig';
import { optionalEnv } from '../utils/env';

type GraphList = {
  id: string;
  displayName?: string;
  name?: string;
};

type GraphListsResponse = {
  value: GraphList[];
};

type GraphListItem = {
  id: string;
  fields?: Record<string, unknown>;
};

type GraphListItemsResponse = {
  value: GraphListItem[];
  '@odata.nextLink'?: string;
};

export type WorkspaceDto = {
  id: string;
  name: string;
  sortOrder?: number;
  enabled?: boolean;
  // SharePoint/Microsoft Lists item id. Useful when other lists use a Lookup to Workspaces.
  spItemId?: string;
};

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const s = asString(value).trim();
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const s = asString(value).trim().toLowerCase();
  if (!s) return undefined;
  if (['1', 'true', 'yes', 'on', 'enabled', 'active'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', 'disabled', 'inactive'].includes(s)) return false;
  return undefined;
}

function readAny(fields: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (!k) continue;
    if (Object.prototype.hasOwnProperty.call(fields, k)) return fields[k];
  }
  return undefined;
}

let inferredWorkspacesListId: string | null = null;

async function inferWorkspacesListId(): Promise<string> {
  if (inferredWorkspacesListId) return inferredWorkspacesListId;

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(graph.siteId)}/lists?$top=999`;
  const res = await graphGet<GraphListsResponse>(url, token);
  const lists = res.value || [];

  const preferredNames = ['workspaces', 'fleetworkspaces', 'fleet-workspaces', 'fleet workspaces'];
  const found = lists.find((l) => {
    const dn = asString(l.displayName).trim().toLowerCase();
    const n = asString(l.name).trim().toLowerCase();
    return preferredNames.includes(dn) || preferredNames.includes(n);
  });

  const id = asString(found?.id).trim();
  if (!id) {
    throw new Error(
      'Workspaces list not configured. Set MS_WORKSPACES_LIST_ID, or create a Microsoft List named “Workspaces”.'
    );
  }

  inferredWorkspacesListId = id;
  return id;
}

async function getWorkspacesListId(): Promise<string> {
  const explicit = optionalEnv('MS_WORKSPACES_LIST_ID', '').trim();
  if (explicit) return explicit;
  return inferWorkspacesListId();
}

export async function listWorkspaces(): Promise<WorkspaceDto[]> {
  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const listId = await getWorkspacesListId();

  const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(listId)}/items?$expand=fields&$top=999`;

  const items: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;
  while (nextUrl) {
    const url = nextUrl;
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(url, token);
    items.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  const workspaces = items
    .map((item) => {
      const fields = item.fields || {};

      // IMPORTANT: do NOT fall back to SharePoint's internal "id" field.
      // We want a stable, human-chosen slug like "school".
      const idRaw = readAny(fields, [
        // Common: store the slug in the built-in Title column
        'Title',
        // SharePoint exposes a few read-only title variants
        'LinkTitle',
        'LinkTitleNoMenu',
        'workspaceId',
        'WorkspaceId',
        'workspace',
        'Workspace',
        'key',
        'Key',
        'slug',
        'Slug',
      ]);
      const nameRaw = readAny(fields, ['name', 'Name', 'displayName', 'DisplayName', 'Title']);
      const orderRaw = readAny(fields, ['sortOrder', 'SortOrder', 'order', 'Order', 'position', 'Position']);
      const enabledRaw = readAny(fields, ['enabled', 'Enabled', 'active', 'Active', 'isActive', 'IsActive']);

      const id = asString(idRaw).trim();
      if (!id) return null;
      const name = asString(nameRaw).trim() || id;

      const sortOrder = asNumber(orderRaw);
      const enabled = asBool(enabledRaw);

      return {
        id,
        name,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
        enabled,
        spItemId: asString(item.id).trim() || undefined,
      } as WorkspaceDto;
    })
    .filter(Boolean)
    .filter((w) => (w as WorkspaceDto).enabled !== false) as WorkspaceDto[];

  workspaces.sort((a, b) => {
    const ao = a.sortOrder ?? 1e9;
    const bo = b.sortOrder ?? 1e9;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });

  return workspaces;
}
