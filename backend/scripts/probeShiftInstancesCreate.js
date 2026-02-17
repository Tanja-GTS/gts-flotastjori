require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const site = process.env.MS_SITE_ID;
const token = process.env.GRAPH_BEARER_TOKEN;
const list = process.env.MS_SHIFT_INSTANCES_LIST_ID;

if (!site || !token || !list) {
  console.error('Missing MS_SITE_ID / GRAPH_BEARER_TOKEN / MS_SHIFT_INSTANCES_LIST_ID');
  process.exit(1);
}

const baseUrl =
  'https://graph.microsoft.com/v1.0/sites/' +
  encodeURIComponent(site) +
  '/lists/' +
  encodeURIComponent(list) +
  '/items';

async function post(fields) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

const cases = [
  { name: 'title', fields: { Title: 'probe-title' } },
  { name: 'workspace', fields: { Title: 'probe-workspace', field_1: 'south' } },
  { name: 'date', fields: { Title: 'probe-date', field_4: '2026-02-10T00:00:00Z' } },
  { name: 'confirm', fields: { Title: 'probe-confirm', field_7: 'unassigned' } },
  { name: 'notes', fields: { Title: 'probe-notes', field_8: 'x' } },
  { name: 'generated', fields: { Title: 'probe-gen', field_9: true } },
  { name: 'manual', fields: { Title: 'probe-man', field_10: false } },
  { name: 'patternLookup', fields: { Title: 'probe-pattern', patternIdLookupId: 1 } },
  { name: 'templateLookup', fields: { Title: 'probe-template', templateIdLookupId: 1 } },
  { name: 'busLookup', fields: { Title: 'probe-bus', busIdLookupId: 1 } },
  {
    name: 'workspace+confirm',
    fields: { Title: 'probe-wc', field_1: 'south', field_7: 'unassigned' },
  },
  {
    name: 'workspace+date',
    fields: { Title: 'probe-wd', field_1: 'south', field_4: '2026-02-10T00:00:00Z' },
  },
  {
    name: 'full-ish',
    fields: {
      Title: 'probe-full',
      field_1: 'south',
      field_4: '2026-02-10T00:00:00Z',
      field_7: 'unassigned',
      field_9: true,
      field_10: false,
      patternIdLookupId: 1,
      templateIdLookupId: 1,
      busIdLookupId: 1,
    },
  },
];

(async () => {
  for (const c of cases) {
    const r = await post(c.fields);
    console.log(c.name, r.ok ? 'OK' : 'FAIL', r.status);
    if (!r.ok) console.log(r.text.slice(0, 300));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
