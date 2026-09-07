import { optionalEnv } from '../utils/env';
import { HttpError } from '../utils/httpError';

export type ExternalShiftPlan = {
  id: number;
  name: string;
  ssn?: string | null;
  ssn_name?: string;
  default_group?: number;
  arr: string;
  dep?: string | null;
  arrdeptype?: string;
  dirty?: boolean;
  shifttype?: number | null;
  color?: string | null;
  descr?: string | null;
  location?: number | null;
  arrdep?: number | null;
  shiftplangroup?: number | null;
  shiftplangroup_pos?: number | null;
  predefinedshift?: number | null;
  unassigned?: boolean;
};

// One row from /arrdeps/. Tímon returns both planned rows (arrdeptype "VK",
// round times) and real clock-in punches (arrdeptype "TI", precise timestamps,
// dep=null while the person is still clocked in).
export type ExternalArrdep = {
  id: number;
  ssn?: string | null;
  arr: string;
  dep?: string | null;
  arrdeptype?: string | null;
  howregistered?: string | null;
  closed?: boolean;
  approved?: boolean;
};

export function getTimonConfig() {
  return {
    baseUrl: optionalEnv('TIMON_API_BASE_URL', 'https://gts.timon.is/api/v2').trim().replace(/\/$/, ''),
    token: optionalEnv('TIMON_API_TOKEN', '').trim(),
    tokenHeader: optionalEnv('TIMON_API_TOKEN_HEADER', 'Authorization').trim(),
    tokenPrefix: optionalEnv('TIMON_API_TOKEN_PREFIX', 'Token').trim(),
  };
}

export function timonTokenConfigured(): boolean {
  return Boolean(getTimonConfig().token);
}

function timonAuthHeaders(): Record<string, string> {
  const cfg = getTimonConfig();
  if (!cfg.token) {
    throw new HttpError(400, 'Tímon API token not configured', { code: 'timon_token_missing' });
  }

  const headerValue = cfg.tokenPrefix ? `${cfg.tokenPrefix} ${cfg.token}` : cfg.token;
  return {
    [cfg.tokenHeader]: headerValue,
    Accept: 'application/json',
  };
}

function buildShiftplanUrl(params: {
  fromdate?: string;
  todate?: string;
  groups?: string;
  ssns?: string;
}) {
  const cfg = getTimonConfig();
  const url = new URL(`${cfg.baseUrl}/shiftplan/`);
  if (params.fromdate) url.searchParams.set('fromdate', params.fromdate);
  if (params.todate) url.searchParams.set('todate', params.todate);
  if (params.groups) url.searchParams.set('groups', params.groups);
  if (params.ssns) url.searchParams.set('ssns', params.ssns);
  return url.toString();
}

export async function fetchTimonShiftPlans(params: {
  fromdate?: string;
  todate?: string;
  groups?: string;
  ssns?: string;
}): Promise<ExternalShiftPlan[]> {
  const res = await fetch(buildShiftplanUrl(params), {
    method: 'GET',
    headers: timonAuthHeaders(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, `Tímon shiftplan request failed: ${res.status}`, {
      code: 'timon_shiftplan_failed',
      details: text,
    });
  }

  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as ExternalShiftPlan[]) : [];
}

export async function fetchTimonArrdeps(params: {
  fromdate: string;
  todate: string;
  ssn?: string;
}): Promise<ExternalArrdep[]> {
  const cfg = getTimonConfig();
  const url = new URL(`${cfg.baseUrl}/arrdeps/`);
  url.searchParams.set('fromdate', params.fromdate);
  url.searchParams.set('todate', params.todate);
  if (params.ssn) url.searchParams.set('ssn', params.ssn);

  const res = await fetch(url.toString(), { method: 'GET', headers: timonAuthHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, `Tímon arrdeps request failed: ${res.status}`, {
      code: 'timon_arrdeps_failed',
      details: text,
    });
  }

  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? (data as ExternalArrdep[]) : [];
}
