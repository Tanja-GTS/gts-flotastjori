import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { optionalEnv, requireEnv } from '../utils/env';

export type ShiftDto = {
  id: string;
  workspaceId: string;
  date: string; // YYYY-MM-DD
  route: string;
  shiftType: string;
  name: string;
  time: string;
  driver?: string;
  defaultBus?: string;
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

function normalizeDate(value: unknown): string {
  const s = asString(value);
  // Microsoft Lists may store as ISO timestamps; we only need YYYY-MM-DD.
  return s.slice(0, 10);
}

function fieldName(envKey: string, fallback: string) {
  return optionalEnv(envKey, fallback);
}

export async function listShifts(params: {
  date?: string; // YYYY-MM-DD
  workspaceId?: string;
}): Promise<ShiftDto[]> {
  const tenantId = requireEnv('AZURE_TENANT_ID');
  const clientId = requireEnv('AZURE_CLIENT_ID');
  const clientSecret = requireEnv('AZURE_CLIENT_SECRET');
  const siteId = requireEnv('MS_SITE_ID');
  const listId = requireEnv('MS_LIST_ID');

  // Column internal names (customize via env if needed)
  const fWorkspaceId = fieldName('LIST_FIELD_WORKSPACE_ID', 'workspaceId');
  const fDate = fieldName('LIST_FIELD_DATE', 'date');
  const fRoute = fieldName('LIST_FIELD_ROUTE', 'route');
  const fShiftType = fieldName('LIST_FIELD_SHIFT_TYPE', 'shiftType');
  const fName = fieldName('LIST_FIELD_NAME', 'name');
  const fTime = fieldName('LIST_FIELD_TIME', 'time');
  const fDriver = fieldName('LIST_FIELD_DRIVER', 'driver');
  const fDefaultBus = fieldName('LIST_FIELD_DEFAULT_BUS', 'defaultBus');

  const token = await getGraphAppToken({ tenantId, clientId, clientSecret });

  const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    siteId
  )}/lists/${encodeURIComponent(listId)}/items?$expand=fields&$top=999`;

  const allItems: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;

  while (nextUrl) {
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
    allItems.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  const shifts = allItems
    .map((item) => {
      const fields = item.fields || {};
      const shift: ShiftDto = {
        id: item.id,
        workspaceId: asString(fields[fWorkspaceId]),
        date: normalizeDate(fields[fDate]),
        route: asString(fields[fRoute]),
        shiftType: asString(fields[fShiftType]),
        name: asString(fields[fName]),
        time: asString(fields[fTime]),
        driver: asString(fields[fDriver]) || undefined,
        defaultBus: asString(fields[fDefaultBus]) || undefined,
      };
      return shift;
    })
    .filter((s) => s.workspaceId && s.date && s.route);

  const filtered = shifts.filter((s) => {
    if (params.workspaceId && s.workspaceId !== params.workspaceId) return false;
    if (params.date && s.date !== params.date) return false;
    return true;
  });

  return filtered;
}
