import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), 'backend', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function optionalEnv(key: string, fallback = '') {
  return (process.env[key] || fallback).trim();
}

async function wakeAndFetch(appUrl: string, workspaceId: string, month: string): Promise<any[]> {
  // Wake the server first — keep pinging until it responds (up to 3 min)
  const start = Date.now();
  while (Date.now() - start < 180_000) {
    try {
      const r = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) break;
    } catch { /* still waking, keep trying */ }
    await new Promise(res => setTimeout(res, 5000));
  }
  // Now fetch shifts — server is awake so should be fast
  const url = `${appUrl}/api/shifts?workspaceId=${workspaceId}&month=${month}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`API error ${res.status} for ${month}`);
  const data = await res.json() as any;
  return data.shifts || [];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function sendEmail(params: {
  apiKey: string;
  from: { email: string; name?: string };
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const res = await fetch('https://connect.mailerlite.com/api/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      from: { email: params.from.email, name: params.from.name || 'Fleet Scheduler' },
      to: [{ email: params.to }],
      subject: params.subject,
      html: params.html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`MailerLite error ${res.status}: ${body}`);
  }
  console.log(`[daily-report] MailerLite response ${res.status}:`, body);
}

const LABEL: Record<string, string> = { morning: 'Morning', evening: 'Evening', single: 'Single' };

const tableHeader = `
  <tr style="background:#f5f5f5">
    <th style="padding:8px 12px;text-align:left">Route</th>
    <th style="padding:8px 12px;text-align:left">Type</th>
    <th style="padding:8px 12px;text-align:left">Time</th>
    <th style="padding:8px 12px;text-align:left">Driver</th>
  </tr>`;

function shiftRow(s: any, ok: boolean): string {
  const type = LABEL[s.shiftType] || s.shiftType;
  const color = ok ? '#1a7f37' : '#b91c1c';
  const status = ok ? (s.driverName || '—') : '⚠️ Unassigned';
  return `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600">${s.route}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${type}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${s.time || ''}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:${color};font-weight:${ok ? '400' : '700'}">${status}</td>
    </tr>`;
}

function daySection(label: string, date: string, shifts: any[]): string {
  const unassigned = shifts.filter((s: any) => !s.driverId);
  const assigned   = shifts.filter((s: any) =>  s.driverId);
  const allGood    = unassigned.length === 0;

  const statusColor = allGood ? '#1a7f37' : '#b91c1c';
  const statusText  = allGood
    ? `✅ All ${shifts.length} shifts assigned`
    : `⚠️ ${unassigned.length} unassigned out of ${shifts.length}`;

  const rows = [...unassigned, ...assigned].map((s) => shiftRow(s, !!s.driverId)).join('');

  return `
    <h2 style="margin-top:32px;margin-bottom:2px">${label}</h2>
    <p style="color:#666;margin:0 0 8px">${formatDate(date)}</p>
    <p style="font-weight:700;color:${statusColor};margin:0 0 12px">${statusText}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${tableHeader}${rows}
    </table>`;
}

async function main() {
  const apiKey      = optionalEnv('MAILERLITE_API_KEY');
  const to          = optionalEnv('DAILY_REPORT_TO');
  const fromEmail   = optionalEnv('DAILY_REPORT_FROM_EMAIL', 'noreply@gts.is');
  const fromName    = optionalEnv('DAILY_REPORT_FROM_NAME', 'Fleet Scheduler');
  const workspaceId = optionalEnv('DAILY_REPORT_WORKSPACE', 'south');
  const appUrl      = optionalEnv('APP_URL', 'https://gts-flotastjori.onrender.com');

  if (!apiKey) { console.error('[daily-report] MAILERLITE_API_KEY not set — skipping'); process.exit(0); }
  if (!to)     { console.error('[daily-report] DAILY_REPORT_TO not set — skipping'); process.exit(0); }

  const today    = todayIso();
  const tomorrow = tomorrowIso();

  console.log('[daily-report] Waking server and fetching shifts...');
  const months = [...new Set([today.slice(0, 7), tomorrow.slice(0, 7)])];
  const allShifts: any[] = (
    await Promise.all(months.map((m: string) => wakeAndFetch(appUrl, workspaceId, m)))
  ).flat();

  const shiftsFor = (date: string) =>
    allShifts
      .filter((s: any) => s.date?.slice(0, 10) === date)
      .sort((a: any, b: any) => (a.route + a.shiftType).localeCompare(b.route + b.shiftType));

  const todayShifts    = shiftsFor(today);
  const tomorrowShifts = shiftsFor(tomorrow);

  const todayUnassigned    = todayShifts.filter((s: any) => !s.driverId).length;
  const tomorrowUnassigned = tomorrowShifts.filter((s: any) => !s.driverId).length;
  const totalUnassigned    = todayUnassigned + tomorrowUnassigned;

  const subject = totalUnassigned === 0
    ? `✅ All shifts assigned — ${formatDate(today)}`
    : `⚠️ ${totalUnassigned} unassigned — ${formatDate(today)}`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:620px;margin:0 auto;color:#111">
      <h1 style="margin-bottom:0">Shift Report</h1>
      ${daySection('Today', today, todayShifts)}
      ${daySection('Tomorrow', tomorrow, tomorrowShifts)}
      <p style="color:#aaa;font-size:12px;margin-top:32px">Fleet Scheduler — automated daily report</p>
    </div>`;

  await sendEmail({ apiKey, from: { email: fromEmail, name: fromName }, to, subject, html });
  console.log(`[daily-report] Sent to ${to} — today: ${todayUnassigned} unassigned, tomorrow: ${tomorrowUnassigned} unassigned`);
}

main().catch((err) => {
  console.error('[daily-report] Failed:', err);
  process.exit(1);
});
