import type { Request, Response } from 'express';
import { getGraphAppToken } from '../services/graphAuth';
import { graphGet } from '../services/graphClient';
import { getGraphConfig, getListIds, getShiftPatternsFieldNames } from '../services/msListsConfig';
import { sendApiError } from './apiError';

type GraphListItem = {
  id: string;
  fields?: Record<string, unknown>;
};

type GraphListItemsResponse = {
  value: GraphListItem[];
  '@odata.nextLink'?: string;
};

function asString(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

function containsCI(haystack: unknown, needle: string): boolean {
  const h = asString(haystack).toLowerCase();
  return h.includes(needle);
}

export async function getSearchPatterns(req: Request, res: Response) {
  try {
    const qRaw = typeof req.query.q === 'string' ? req.query.q : '';
    const q = qRaw.trim().toLowerCase();
    if (!q) {
      return res.status(400).json({ ok: false, error: 'Missing query param: q' });
    }

    const graph = getGraphConfig();
    const lists = getListIds();
    const f = getShiftPatternsFieldNames();
    const token = await getGraphAppToken(graph);

    const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
      graph.siteId
    )}/lists/${encodeURIComponent(lists.shiftPatternsListId)}/items?$expand=fields&$top=999`;

    const all: GraphListItem[] = [];
    let nextUrl: string | undefined = baseUrl;
    while (nextUrl) {
      const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, token);
      all.push(...(page.value || []));
      nextUrl = page['@odata.nextLink'];
    }

    const matches = all
      .map((item) => {
        const fields = item.fields || {};

        // Search in common name-ish fields.
        const title = asString(fields.Title || fields.LinkTitle || fields.LinkTitleNoMenu);
        const routeName = asString((fields as any).routeName || (fields as any).RouteName);

        if (
          !containsCI(title, q) &&
          !containsCI(routeName, q) &&
          !containsCI(fields[f.workspaceId], q) &&
          !containsCI(fields[f.route], q)
        ) {
          return null;
        }

        return {
          id: String(item.id || ''),
          title: title || undefined,
          workspaceId: asString(fields[f.workspaceId]).trim() || undefined,
          route: asString(fields[f.route]).trim() || undefined,
          shiftType: asString(fields[f.shiftType]).trim() || undefined,
          dayOfWeek: fields[f.dayOfWeek] ?? undefined,
          startTime: asString(fields[f.startTime]).trim() || undefined,
          endTime: asString(fields[f.endTime]).trim() || undefined,
          templateId: asString(fields[f.templateId]).trim() || undefined,
          routeName: routeName || undefined,
        };
      })
      .filter(Boolean);

    return res.json({ ok: true, q, count: matches.length, matches });
  } catch (err) {
    sendApiError(res, err);
  }
}
