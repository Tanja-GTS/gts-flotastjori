import { getGraphAppToken } from './graphAuth';
import { graphGet } from './graphClient';
import { getGraphConfig, getListIds, getShiftPatternsFieldNames } from './msListsConfig';
import { resolveRouteTitles } from './routesService';
import { getTemplateDefaults } from './templatesService';

export type ShiftPatternDto = {
  id: string;
  route: string;
  routeName?: string;
  shiftType: 'morning' | 'single' | 'evening' | string;
  // Optional grouping label (ex: "weekdays" / "weekend")
  weekPart?: string;
  dayOfWeek: string | string[]; // Mon..Sun (single or multi-choice)
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  workspaceId?: string;
  templateId?: string;
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

function asStringArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => asString(v)).filter(Boolean);
  const s = asString(value);
  return s ? [s] : [];
}

function readField(fields: Record<string, unknown>, fieldName: string): string {
  if (!fieldName) return '';
  return asString(fields[fieldName]);
}

function readAny(fields: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (!k) continue;
    if (Object.prototype.hasOwnProperty.call(fields, k)) return fields[k];
  }
  return undefined;
}

function normalizeShiftType(value: string): string {
  const s = String(value || '').trim().toLowerCase();
  if (s === 'morning') return 'morning';
  if (s === 'evening') return 'evening';
  if (s === 'single') return 'single';
  return value;
}

function normalizeWeekPart(value: string): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const s = raw.toLowerCase();
  if (s === 'weekday' || s === 'weekdays' || s === 'workday' || s === 'workdays' || s === 'work days') {
    return 'weekdays';
  }
  if (s === 'weekend' || s === 'weekends') return 'weekend';
  return raw;
}

export async function listShiftPatterns(params?: { workspaceId?: string }): Promise<ShiftPatternDto[]> {
  const graph = getGraphConfig();
  const lists = getListIds();
  const f = getShiftPatternsFieldNames();

  const token = await getGraphAppToken(graph);

  const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(lists.shiftPatternsListId)}/items?$expand=fields&$top=999`;

  const allItems: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;

  while (nextUrl) {
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
    allItems.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }

  const rawPatterns = allItems.map((item) => {
    const fields = item.fields || {};

    // Provide sane fallbacks for common internal names in Microsoft Lists.
    const routeValue = readAny(fields, [f.route, 'RouteLookupId', 'Route']);
    const routeNameValue = readAny(fields, [
      // configured internal name
      (f as any).routeName,
      // common defaults
      'routeName',
      'RouteName',
      'routeTitle',
      'RouteTitle',
    ]);
    const titleValue = readAny(fields, ['Title', 'LinkTitle', 'LinkTitleNoMenu']);
    const dayValue = readAny(fields, [f.dayOfWeek, 'DayOfWeek']);
    const shiftTypeValue = readAny(fields, [f.shiftType, 'Type0']);
    const weekPartValue = readAny(fields, [
      (f as any).weekPart,
      // Common internal names when the display name is "ShiftType"
      'ShiftType',
      'WeekPart',
      'WeekType',
      'DayType',
    ]);
    const startValue = readAny(fields, [f.startTime, 'field_5', 'StartTime']);
    const endValue = readAny(fields, [f.endTime, 'field_6', 'EndTime']);
    const templateValue = readAny(fields, [f.templateId, 'ShiftLookupId', 'Shift']);

    const title = asString(titleValue).trim();

    const dto: ShiftPatternDto = {
      id: item.id,
      // For lookup columns, expanded fields usually include *LookupId*. We resolve this later.
      route: asString(routeValue),
      routeName: asString(routeNameValue).trim() || undefined,
      shiftType: normalizeShiftType(asString(shiftTypeValue)),
      weekPart: normalizeWeekPart(asString(weekPartValue)),
      dayOfWeek: Array.isArray(dayValue) ? asStringArray(dayValue) : asString(dayValue),
      startTime: asString(startValue),
      endTime: asString(endValue),
      workspaceId: f.workspaceId ? readField(fields, f.workspaceId) || undefined : undefined,
      templateId: f.templateId ? readField(fields, f.templateId) || undefined : undefined,
    };

    // If PATTERN_FIELD_TEMPLATE_ID isn't configured, fall back to the common lookup backing field.
    if (!dto.templateId) {
      const rawTemplate = asString(templateValue);
      dto.templateId = rawTemplate ? rawTemplate : undefined;
    }

    return { dto, title };
  });

  // Prefer routeName coming from the ShiftTemplates/Templates list when available.
  // This matches your workflow: edit templates, and have all instances/patterns pick it up.
  const templateIdsNeeding = Array.from(
    new Set(
      rawPatterns
        .map((p) => p.dto)
        .filter((p) => !p.routeName && p.templateId)
        .map((p) => String(p.templateId))
    )
  );

  const templateRouteNames = new Map<string, string>();
  await Promise.all(
    templateIdsNeeding.map(async (templateId) => {
      try {
        const defaults = await getTemplateDefaults(templateId);
        const rn = String(defaults.routeName || '').trim();
        if (rn) templateRouteNames.set(templateId, rn);
      } catch {
        // Ignore template enrichment errors; patterns will still work.
      }
    })
  );

  const enriched = rawPatterns.map(({ dto, title }) => {
    const templateRouteName = dto.templateId ? templateRouteNames.get(String(dto.templateId)) : undefined;
    const routeName = String(templateRouteName || dto.routeName || title || '').trim();
    return {
      ...dto,
      routeName: routeName || undefined,
    } as ShiftPatternDto;
  });

  // Optionally resolve route lookup IDs to their Titles (Route list).
  const routeIds = Array.from(
    new Set(
      enriched
        .map((p) => p.route)
        .filter((v) => typeof v === 'string' && v.trim().length)
    )
  );

  const routeTitles = await resolveRouteTitles({ routeIds });

  const patterns = enriched
    .map((p) => ({
      ...p,
      route: routeTitles.get(p.route) || p.route,
    }))
    .filter((p) => {
      const hasDay = Array.isArray(p.dayOfWeek) ? p.dayOfWeek.length > 0 : Boolean(p.dayOfWeek);
      return p.route && p.shiftType && hasDay && p.startTime && p.endTime;
    });

  if (params?.workspaceId) {
    // Only filter by workspace if the column exists / is configured
    const canFilter = patterns.some((p) => p.workspaceId != null);
    if (canFilter) {
      return patterns.filter((p) => p.workspaceId === params.workspaceId);
    }
  }

  return patterns;
}
