import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig } from './msListsConfig';
import { optionalEnv } from '../utils/env';

type GraphListItem = {
  id: string;
  fields?: Record<string, unknown>;
};

type TemplateDefaults = {
  busLookupId?: number;
  driverLookupId?: number;
  routeLookupId?: number;
  routeName?: string;
};

function asString(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function asNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const cache = new Map<string, TemplateDefaults>();

export async function getTemplateDefaults(templateId: string): Promise<TemplateDefaults> {
  const templatesListId = optionalEnv('MS_TEMPLATES_LIST_ID', '').trim();
  if (!templatesListId) return {};

  const routeNameField = optionalEnv('TEMPLATE_FIELD_ROUTE_NAME', 'routeName').trim();

  const id = String(templateId || '').trim();
  if (!id) return {};

  const cached = cache.get(id);
  if (cached) return cached;

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);

  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(templatesListId)}/items/${encodeURIComponent(id)}?$expand=fields`;

  const item = await graphGet<GraphListItem>(url, token);
  const fields = item.fields || {};

  const routeName =
    asString((routeNameField && (fields as any)[routeNameField]) || '').trim() ||
    asString((fields as any).routeName).trim() ||
    asString((fields as any).RouteName).trim() ||
    asString((fields as any).Title).trim() ||
    '';

  const defaults: TemplateDefaults = {
    busLookupId: asNumber(fields.BusLookupId),
    driverLookupId: asNumber(fields.DriverLookupId),
    routeLookupId: asNumber(fields.RouteLookupId),
    routeName: routeName || undefined,
  };

  cache.set(id, defaults);
  return defaults;
}
