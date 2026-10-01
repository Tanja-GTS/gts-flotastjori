import { getGraphAppToken } from './graphAuth';
import { graphGet, graphPost } from './graphClient';
import { getDriversFieldNames, getGraphConfig, getListIds, getShiftInstancesFieldNames } from './msListsConfig';
import { optionalEnv } from '../utils/env';
import { HttpError } from '../utils/httpError';

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
  ssn?: string;
  email?: string;
  phone?: string;
};

function normalizeSsn(raw: unknown): string {
  const s = asString(raw).trim();
  if (!s) return '';
  return s.replace(/\s+/g, '').replace(/-/g, '');
}

function looksLikeSsn(raw: string): boolean {
  return /^\d{10}$/.test(normalizeSsn(raw));
}

function pickSsn(fields: Record<string, unknown>): string {
  const configured = String(getDriversFieldNames().ssn || '').trim();
  const candidates = [
    configured,
    'ssn',
    'SSN',
    'kennitala',
    'Kennitala',
    'kt',
    'KT',
    'nationalId',
    'NationalId',
    'employeeSsn',
    'EmployeeSsn',
  ].filter(Boolean);

  for (const key of candidates) {
    const value = normalizeSsn(fields[key]);
    if (looksLikeSsn(value)) return value;
  }

  for (const value of Object.values(fields)) {
    const normalized = normalizeSsn(value);
    if (looksLikeSsn(normalized)) return normalized;
  }

  return '';
}

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

function looksLikePhone(raw: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (s.includes('@')) return false;

  // Keep leading +, drop common separators.
  const normalized = s
    .replace(/\s+/g, '')
    .replace(/[()\-._]/g, '')
    .replace(/^00/, '+');

  const m = normalized.match(/^\+?[0-9]{6,15}$/);
  return Boolean(m);
}

function pickPhone(fields: Record<string, unknown>): string {
  const candidates = [
    'Phone',
    'phone',
    'PhoneNumber',
    'phoneNumber',
    'Telephone',
    'telephone',
    'Tel',
    'tel',
    'Mobile',
    'mobile',
    'MobileNumber',
    'mobileNumber',
    'Cell',
    'cell',
    'CellPhone',
    'cellPhone',
    'DriverPhone',
    'driverPhone',
    'DriverMobile',
    'driverMobile',
  ];

  for (const k of candidates) {
    const v = fields[k];
    const s = asString(v).trim();
    if (looksLikePhone(s)) return s;
  }

  // Fallback: scan values for something that looks like a phone number.
  for (const v of Object.values(fields)) {
    const s = asString(v).trim();
    if (looksLikePhone(s)) return s;
  }

  return '';
}

let driversCache: { fetchedAtMs: number; items: DriverDto[] } | null = null;
let driversFetchInProgress: Promise<DriverDto[]> | null = null;

export async function listDrivers(): Promise<DriverDto[]> {
  const ttlMs = Number(optionalEnv('DRIVERS_CACHE_TTL_MS', '300000')) || 300000;
  const now = Date.now();
  if (driversCache && now - driversCache.fetchedAtMs < ttlMs) return driversCache.items;
  if (driversFetchInProgress) return driversFetchInProgress;

  driversFetchInProgress = (async () => {
    try {
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

      const items = allItems
        .map((item) => {
          const fields = item.fields || {};
          const name =
            asString(fields.Title) ||
            asString(fields.LinkTitle) ||
            asString(fields.Name) ||
            asString(fields.FullName) ||
            '';
          return {
            id: String(item.id || '').trim(),
            name: name.trim() || String(item.id || '').trim(),
            ssn: pickSsn(fields) || undefined,
            email: pickEmail(fields) || undefined,
            phone: pickPhone(fields) || undefined,
          };
        })
        .filter((d) => d.id && d.name);
      driversCache = { fetchedAtMs: now, items };
      return items;
    } finally {
      driversFetchInProgress = null;
    }
  })();
  return driversFetchInProgress;
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

export async function resolveDriversBySsn(params: {
  ssns: string[];
}): Promise<Map<string, DriverDto>> {
  const uniqueSsns = Array.from(
    new Set(params.ssns.map((s) => normalizeSsn(s)).filter((s) => looksLikeSsn(s)))
  );
  if (uniqueSsns.length === 0) return new Map();

  const drivers = await listDrivers();
  const map = new Map<string, DriverDto>();
  for (const driver of drivers) {
    const ssn = normalizeSsn(driver.ssn);
    if (!ssn || !uniqueSsns.includes(ssn)) continue;
    if (!map.has(ssn)) map.set(ssn, driver);
  }
  return map;
}


// ---------------------------------------------------------------------------
// Creating drivers
//
// Reading tolerates unknown column names by probing candidates and sniffing
// values, but a write has to name the column exactly. So resolve the Drivers
// list's real internal names from Graph once, and cache them.
// ---------------------------------------------------------------------------

type DriverColumnMap = {
  name?: string;
  email?: string;
  phone?: string;
  ssn?: string;
};

let driverColumnsCache: { fetchedAtMs: number; map: DriverColumnMap } | null = null;

const COLUMN_CANDIDATES: Record<keyof DriverColumnMap, string[]> = {
  name: ['name', 'fullname', 'full name', 'drivername', 'driver name'],
  email: ['email', 'e-mail', 'mail', 'driveremail', 'netfang'],
  phone: ['phone', 'phonenumber', 'phone number', 'telephone', 'mobile', 'simi', 'sími'],
  ssn: ['ssn', 'kennitala', 'kt', 'nationalid', 'national id', 'employeessn'],
};

function isWritableColumn(col: GraphColumn): boolean {
  if ((col as any).readOnly === true) return false;
  if ((col as any).hidden === true) return false;
  return true;
}

export async function resolveDriverColumns(): Promise<DriverColumnMap> {
  const ttlMs = Number(optionalEnv('DRIVERS_COLUMNS_CACHE_TTL_MS', '600000')) || 600000;
  const now = Date.now();
  if (driverColumnsCache && now - driverColumnsCache.fetchedAtMs < ttlMs) return driverColumnsCache.map;

  const driversListId = await getDriversListId();
  if (!driversListId) throw new HttpError(500, 'Could not determine the Drivers list id');

  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(driversListId)}/columns?$top=999`;
  const res = await graphGet<GraphColumnsResponse>(url, token);
  const cols = (res.value || []).filter(isWritableColumn);

  const configuredSsn = String(getDriversFieldNames().ssn || '').trim().toLowerCase();

  const map: DriverColumnMap = {};
  for (const key of Object.keys(COLUMN_CANDIDATES) as Array<keyof DriverColumnMap>) {
    const candidates = key === 'ssn' && configuredSsn
      ? [configuredSsn, ...COLUMN_CANDIDATES[key]]
      : COLUMN_CANDIDATES[key];

    const hit = cols.find((c) => {
      const internal = String(c.name || '').trim().toLowerCase();
      const display = String(c.displayName || '').trim().toLowerCase();
      return candidates.includes(internal) || candidates.includes(display);
    });
    if (hit) map[key] = String(hit.name || '').trim();
  }

  driverColumnsCache = { fetchedAtMs: now, map };
  return map;
}

export function invalidateDriversCache(): void {
  driversCache = null;
  driverColumnsCache = null;
}

export async function createDriver(input: {
  name: string;
  email?: string;
  phone?: string;
  ssn?: string;
}): Promise<DriverDto> {
  const name = asString(input.name).trim();
  const email = asString(input.email).trim();
  const phone = asString(input.phone).trim();
  const ssn = normalizeSsn(input.ssn);

  if (!name) throw new HttpError(400, 'Name is required');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Email is not a valid address');
  }
  if (ssn && !looksLikeSsn(ssn)) {
    throw new HttpError(400, 'Kennitala must be 10 digits');
  }

  // Tímon matches drivers by kennitala, so a duplicate would make the nightly
  // sync ambiguous. Refuse rather than create one.
  const existing = await listDrivers();
  if (ssn) {
    const clash = existing.find((d) => normalizeSsn(d.ssn) === ssn);
    if (clash) throw new HttpError(409, `A driver with that kennitala already exists: ${clash.name}`);
  }

  const columns = await resolveDriverColumns();
  const missing: string[] = [];
  if (email && !columns.email) missing.push('email');
  if (phone && !columns.phone) missing.push('phone');
  if (ssn && !columns.ssn) missing.push('kennitala');
  if (missing.length) {
    throw new HttpError(
      500,
      `Could not find these columns in the Drivers list: ${missing.join(', ')}. ` +
        'Check the column names in SharePoint.'
    );
  }

  // Title is the built-in primary column and is what listDrivers() reads first.
  const fields: Record<string, unknown> = { Title: name };
  if (columns.name && columns.name !== 'Title') fields[columns.name] = name;
  if (email && columns.email) fields[columns.email] = email;
  if (phone && columns.phone) fields[columns.phone] = phone;
  if (ssn && columns.ssn) fields[columns.ssn] = ssn;

  const driversListId = await getDriversListId();
  const graph = getGraphConfig();
  const token = await getGraphAppToken(graph);
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    graph.siteId
  )}/lists/${encodeURIComponent(driversListId)}/items`;

  const created = await graphPost<GraphListItem>(url, token, { fields });

  invalidateDriversCache();

  return {
    id: String(created?.id || '').trim(),
    name,
    email: email || undefined,
    phone: phone || undefined,
    ssn: ssn || undefined,
  };
}
