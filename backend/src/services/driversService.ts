import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig, getListIds, getShiftInstancesFieldNames } from './msListsConfig';
import { optionalEnv } from '../utils/env';

type GraphColumn = Record<string, unknown> & {
  name?: string;
  displayName?: string;
  lookup?: {
    listId?: string;
  };
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
  '@odata.nextLink'?: string;
};

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

let inferredDriversListId: string | null = null;

async function inferDriversListId(): Promise<string> {
  if (inferredDriversListId != null) return inferredDriversListId;

  const graph = getGraphConfig();
  const lists = getListIds();
  const token = await getGraphAppToken(graph);
  const f = getShiftInstancesFieldNames();

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(lists.shiftInstancesListId)}/columns?$top=999`;

  const res = await graphGet<GraphColumnsResponse>(url, token);
  const cols = res.value || [];

  const driverInternal = String(f.driverId || '').trim();
  const driverCol =
    cols.find((c) => String(c.name || '') === driverInternal) ||
    cols.find((c) => String(c.displayName || '') === driverInternal) ||
    cols.find((c) => String(c.displayName || '').toLowerCase() === 'driverid');

  inferredDriversListId = String(driverCol?.lookup?.listId || '').trim() || '';
  return inferredDriversListId;
}

async function getDriversListId(): Promise<string> {
  const explicit = optionalEnv('MS_DRIVERS_LIST_ID', '').trim();
  if (explicit) return explicit;
  return inferDriversListId();
}

export type DriverDto = {
  id: string;
  name: string;
  email?: string;
};

function pickEmail(fields: Record<string, unknown>): string {
  // Try common column internal/display names.
  const candidates = [
    'Email',
    'email',
    'E-mail',
    'Mail',
    'mail',
    'DriverEmail',
    'driverEmail',
    'field_1',
    'field_2',
  ];

  for (const k of candidates) {
    const v = fields[k];
    const s = asString(v).trim();
    if (s.includes('@')) return s;
  }

  // Also scan for any value that looks like an email.
  for (const v of Object.values(fields)) {
    const s = asString(v).trim();
    if (s.includes('@') && s.includes('.')) return s;
  }

  return '';
}

/**
 * Lists drivers from the Drivers list.
 *
 * The listId is auto-discovered from the ShiftInstances driverId lookup when possible.
 */
export async function listDrivers(): Promise<DriverDto[]> {
  const driversListId = await getDriversListId();
  if (!driversListId) return [];

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(driversListId)}/items?$expand=fields&$top=999`;

  const allItems: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;

  while (nextUrl) {
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
    allItems.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  return allItems
    .map((item) => {
      const fields = item.fields || {};
      const name =
        asString(fields.Title) ||
        asString(fields.LinkTitle) ||
        asString(fields.Name) ||
        asString(fields.FullName) ||
        '';

      const email = pickEmail(fields);

      return {
        id: String(item.id || '').trim(),
        name: name.trim() || String(item.id || '').trim(),
        email: email || undefined,
      };
    })
    .filter((d) => d.id && d.name);
}

export async function resolveDrivers(params: {
  driverIds: string[];
}): Promise<Map<string, DriverDto>> {
  const uniqueIds = Array.from(
    new Set(params.driverIds.map((s) => String(s).trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) return new Map();

  const drivers = await listDrivers();
  const map = new Map<string, DriverDto>();
  for (const d of drivers) {
    if (uniqueIds.includes(d.id)) map.set(d.id, d);
  }
  return map;
}
