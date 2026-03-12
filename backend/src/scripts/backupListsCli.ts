import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { getGraphAppToken } from '../services/graphAuth';
import { graphGet } from '../services/graphClient';
import { getGraphConfig, getListIds } from '../services/msListsConfig';
import { optionalEnv } from '../utils/env';

type GraphListItem = {
  id: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  fields?: Record<string, unknown>;
};

type GraphListItemsResponse = {
  value: GraphListItem[];
  '@odata.nextLink'?: string;
};

type GraphList = {
  id: string;
  displayName?: string;
  name?: string;
};

type GraphListsResponse = {
  value: GraphList[];
};

type BackupListKey = 'instances' | 'patterns' | 'workspaces' | 'site' | 'all';

function getArg(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return '';
  return String(process.argv[idx + 1] || '').trim();
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function isoStamp(d = new Date()): string {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}Z`;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function listAllItems(params: {
  siteId: string;
  listId: string;
  token: string;
}): Promise<GraphListItem[]> {
  const baseUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(
    params.siteId
  )}/lists/${encodeURIComponent(params.listId)}/items?$expand=fields&$top=999`;

  const all: GraphListItem[] = [];
  let nextUrl: string | undefined = baseUrl;
  while (nextUrl) {
    const page: GraphListItemsResponse = await graphGet<GraphListItemsResponse>(nextUrl, params.token);
    all.push(...(page.value || []));
    nextUrl = page['@odata.nextLink'];
  }
  return all;
}

async function backupOne(params: {
  outDir: string;
  siteId: string;
  listId: string;
  name: string;
  token: string;
}) {
  const items = await listAllItems({ siteId: params.siteId, listId: params.listId, token: params.token });
  const payload = {
    ok: true,
    name: params.name,
    siteId: params.siteId,
    listId: params.listId,
    exportedAt: new Date().toISOString(),
    count: items.length,
    items,
  };

  await ensureDir(params.outDir);
  const filePath = path.join(params.outDir, `${params.name}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[backup] wrote ${params.name}: ${items.length} items -> ${filePath}`);
}

async function listSiteLists(params: { siteId: string; token: string }): Promise<GraphList[]> {
  const url = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(params.siteId)}/lists?$top=999`;
  const res = await graphGet<GraphListsResponse>(url, params.token);
  return res.value || [];
}

function inferWorkspacesListIdFromLists(lists: GraphList[]): string {
  const preferredNames = ['workspaces', 'fleetworkspaces', 'fleet-workspaces', 'fleet workspaces'];
  const found = lists.find((l) => {
    const dn = String(l.displayName || '').trim().toLowerCase();
    const n = String(l.name || '').trim().toLowerCase();
    return preferredNames.includes(dn) || preferredNames.includes(n);
  });
  return String(found?.id || '').trim();
}

async function writeManifest(params: {
  outDir: string;
  siteId: string;
  exportedAt: string;
  mode: BackupListKey;
  lists?: Array<{ id: string; name: string; displayName: string }>;
  notes?: string;
}) {
  const payload = {
    ok: true,
    kind: 'fleet-scheduler-backup',
    exportedAt: params.exportedAt,
    siteId: params.siteId,
    mode: params.mode,
    lists: params.lists || [],
    notes: params.notes || '',
  };
  await ensureDir(params.outDir);
  const filePath = path.join(params.outDir, 'manifest.json');
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function usage() {
  // eslint-disable-next-line no-console
  console.log(`\nUsage:\n  npm --prefix backend run backup:lists -- --lists all|instances,patterns,workspaces [--out output/backups/<stamp>]\n\nNotes:\n- Reads Graph config from backend/.env (or process env)\n- Exports raw Microsoft List items with fields\n`);
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  if (hasFlag('--help') || hasFlag('-h')) {
    usage();
    return;
  }

  const listsArg = (getArg('--lists') || 'all').trim().toLowerCase() as BackupListKey;
  const outArg = getArg('--out');

  const graph = getGraphConfig();
  const listIds = getListIds();
  const token = await getGraphAppToken(graph);

  const exportedAt = new Date().toISOString();

  const defaultRoot = optionalEnv('BACKUP_DIR', path.resolve(process.cwd(), 'output', 'backups'));
  const outDir = outArg
    ? path.resolve(process.cwd(), outArg)
    : path.join(defaultRoot, isoStamp());

  // Always write a manifest (updated later for site mode).
  await writeManifest({
    outDir,
    siteId: graph.siteId,
    exportedAt,
    mode: listsArg,
    notes: 'Raw Graph list item export. Restore requires careful handling of lookups/IDs.',
  });

  const selected = new Set<string>();
  if (listsArg === 'all') {
    selected.add('instances');
    selected.add('patterns');
    selected.add('workspaces');
  } else if (listsArg === 'site') {
    selected.add('site');
  } else {
    for (const part of String(listsArg).split(',')) {
      const k = part.trim().toLowerCase();
      if (k) selected.add(k);
    }
  }

  // ShiftInstances
  if (selected.has('instances')) {
    await backupOne({
      outDir,
      siteId: graph.siteId,
      listId: listIds.shiftInstancesListId,
      name: 'shift-instances',
      token,
    });
  }

  // ShiftPatterns
  if (selected.has('patterns')) {
    await backupOne({
      outDir,
      siteId: graph.siteId,
      listId: listIds.shiftPatternsListId,
      name: 'shift-patterns',
      token,
    });
  }

  // Workspaces (optional; may not exist)
  if (selected.has('workspaces')) {
    const explicit = optionalEnv('MS_WORKSPACES_LIST_ID', '').trim();
    const siteLists = await listSiteLists({ siteId: graph.siteId, token });
    const inferred = inferWorkspacesListIdFromLists(siteLists);
    const workspacesListId = explicit || inferred;
    if (!workspacesListId) {
      // eslint-disable-next-line no-console
      console.log('[backup] skipping workspaces: could not infer Workspaces list id (set MS_WORKSPACES_LIST_ID)');
    } else {
      await backupOne({ outDir, siteId: graph.siteId, listId: workspacesListId, name: 'workspaces', token });
    }
  }

  // Full site backup: export every list.
  if (selected.has('site')) {
    const siteLists = await listSiteLists({ siteId: graph.siteId, token });
    const normalized = siteLists
      .map((l) => {
        const id = String(l.id || '').trim();
        if (!id) return null;
        const displayName = String(l.displayName || '').trim();
        const name = String(l.name || '').trim();
        const safeBase = (displayName || name || id)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        const shortId = id.replace(/[^a-z0-9]/gi, '').slice(0, 8) || id.slice(0, 8);
        // Ensure uniqueness: include an id suffix so exports never overwrite.
        const fileBase = `${safeBase || 'list'}-${shortId}`;
        return { id, displayName, name, fileBase };
      })
      .filter(Boolean) as Array<{ id: string; displayName: string; name: string; fileBase: string }>;

    // Update manifest with list inventory.
    await writeManifest({
      outDir,
      siteId: graph.siteId,
      exportedAt,
      mode: 'site',
      lists: normalized.map((l) => ({ id: l.id, name: l.name, displayName: l.displayName })),
      notes:
        'Full-site export. Each list is saved as lists/<fileBase>.json. Restoring all lists is non-trivial because Lookup IDs and read-only fields must be handled carefully.',
    });

    const listsDir = path.join(outDir, 'lists');
    await ensureDir(listsDir);

    for (const l of normalized) {
      // eslint-disable-next-line no-console
      console.log(`[backup] exporting list: ${l.displayName || l.name || l.id}`);
      await backupOne({
        outDir: listsDir,
        siteId: graph.siteId,
        listId: l.id,
        name: l.fileBase,
        token,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[backup] done -> ${outDir}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
