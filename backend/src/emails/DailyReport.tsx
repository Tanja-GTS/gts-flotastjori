import * as React from 'react';
import {
  Html, Head, Body, Container, Section,
  Text, Button,
} from '@react-email/components';

const LABEL: Record<string, string> = { morning: 'Morning', evening: 'Evening', single: 'Single' };

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function pillColor(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('summer')) return '#FCD34D';
  if (l.includes('winter')) return '#64DBD6';
  return '#E5E7EB';
}

function SchedulePill({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block',
      background: pillColor(label),
      color: '#111111',
      fontSize: '12px',
      fontWeight: 600,
      padding: '5px 12px',
      borderRadius: '8px',
      verticalAlign: 'middle',
      marginLeft: '12px',
    }}>
      {label}
    </span>
  );
}

function ShiftTable({ shifts }: { shifts: any[] }) {
  const unassigned = shifts.filter((s) => !s.driverId);
  const assigned   = shifts.filter((s) =>  s.driverId);
  const rows       = [...unassigned, ...assigned];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', marginTop: '12px' }}>
      <thead>
        <tr style={{ background: '#f5f5f5' }}>
          <th style={th}>Route</th>
          <th style={th}>Type</th>
          <th style={th}>Time</th>
          <th style={th}>Driver</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => {
          const ok = !!s.driverId;
          return (
            <tr key={i}>
              <td style={td}><strong>{s.route}</strong></td>
              <td style={{ ...td, color: '#555' }}>{LABEL[s.shiftType] || s.shiftType}</td>
              <td style={{ ...td, color: '#555' }}>{s.time || ''}</td>
              <td style={{ ...td, color: ok ? '#1a7f37' : '#b91c1c', fontWeight: ok ? 400 : 700 }}>
                {ok ? (s.driverName || '—') : '⚠️ Unassigned'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DaySection({ label, date, shifts, seasonLabel }: {
  label: string; date: string; shifts: any[]; seasonLabel: string;
}) {
  const unassigned = shifts.filter((s) => !s.driverId);
  const allGood    = unassigned.length === 0;
  return (
    <Section style={{ marginTop: '36px' }}>
      <Text style={{ fontSize: '26px', fontWeight: 800, color: '#111', margin: '0 0 4px' }}>
        {label}
        <SchedulePill label={seasonLabel} />
      </Text>
      <Text style={{ color: '#666', margin: '0 0 6px', fontSize: '14px' }}>{formatDate(date)}</Text>
      <Text style={{ fontWeight: 700, color: allGood ? '#1a7f37' : '#b91c1c', margin: '0 0 4px', fontSize: '14px' }}>
        {allGood
          ? `✅ All ${shifts.length} shifts assigned`
          : `⚠️ ${unassigned.length} unassigned out of ${shifts.length}`}
      </Text>
      <ShiftTable shifts={shifts} />
    </Section>
  );
}

const tomorrow = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();

export default function DailyReport({ todayDate = new Date().toISOString().slice(0, 10), tomorrowDate = tomorrow, todayShifts = [
  { route: '51A', shiftType: 'morning', time: '06:00–11:45', driverId: 'x', driverName: 'Jón Sigurðsson' },
  { route: '51A', shiftType: 'evening', time: '14:30–23:00', driverId: 'y', driverName: 'Anna Björk' },
  { route: '51B', shiftType: 'morning', time: '06:30–15:00', driverId: null, driverName: null },
], tomorrowShifts = [
  { route: '51A', shiftType: 'morning', time: '06:00–11:45', driverId: 'x', driverName: 'Jón Sigurðsson' },
  { route: '51B', shiftType: 'evening', time: '14:35–23:00', driverId: 'y', driverName: 'Anna Björk' },
], todayLabel = 'Winter Schedule', tomorrowLabel = 'Summer Schedule' }: {
  todayDate?: string;
  tomorrowDate?: string;
  todayShifts?: any[];
  tomorrowShifts?: any[];
  todayLabel?: string;
  tomorrowLabel?: string;
}) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: 'system-ui, Arial, sans-serif', background: '#ffffff', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: '620px', margin: '0 auto', padding: '32px 24px', color: '#111' }}>

          <Button
            href="https://gts-flotastjori.onrender.com"
            style={{
              background: '#151922',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 600,
              padding: '10px 24px',
              borderRadius: '20px',
              textDecoration: 'none',
              display: 'inline-block',
              marginBottom: '32px',
            }}
          >
            See full schedule ↗
          </Button>

          <Text style={{ fontSize: '32px', fontWeight: 800, margin: '0 0 4px' }}>Shift Report</Text>

          <DaySection label="Today"    date={todayDate}    shifts={todayShifts}    seasonLabel={todayLabel} />
          <DaySection label="Tomorrow" date={tomorrowDate} shifts={tomorrowShifts} seasonLabel={tomorrowLabel} />

          <Text style={{ color: '#aaa', fontSize: '12px', marginTop: '40px' }}>
            Fleet Scheduler — automated daily report
          </Text>

        </Container>
      </Body>
    </Html>
  );
}

export const previewProps = {
  todayDate: new Date().toISOString().slice(0, 10),
  tomorrowDate: (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })(),
  todayShifts: [
    { route: '51A', shiftType: 'morning', time: '06:00–11:45', driverId: 'x', driverName: 'Jón Sigurðsson' },
    { route: '51A', shiftType: 'evening', time: '14:30–23:00', driverId: 'y', driverName: 'Anna Björk' },
    { route: '51B', shiftType: 'morning', time: '06:30–15:00', driverId: null, driverName: null },
  ],
  tomorrowShifts: [
    { route: '51A', shiftType: 'morning', time: '06:00–11:45', driverId: 'x', driverName: 'Jón Sigurðsson' },
    { route: '51B', shiftType: 'evening', time: '14:35–23:00', driverId: 'y', driverName: 'Anna Björk' },
  ],
  todayLabel: 'Winter Schedule',
  tomorrowLabel: 'Summer Schedule',
};

const th: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: '13px',
};

const td: React.CSSProperties = {
  padding: '7px 12px',
  borderBottom: '1px solid #eee',
};
