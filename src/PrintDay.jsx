
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { Button, Group } from '@mantine/core';

const BUS_LICENSES = {
  '51A': 'AA-123',
  '53': 'BB-456',
  'Airport': 'CC-789',
};


export default function PrintDay({ shifts, workspaceId }) {
  const [params] = useSearchParams();
  const datesParam = params.get('dates');
  const parsedDates = datesParam ? datesParam.split(',') : [];

  const navigate = useNavigate();


  return (
    <div style={{ padding: 24 }}>

<Group mb="md" justify="space-between">
  <Button variant="default" onClick={() => navigate(-1)}>
    ← Back
  </Button>

  <Button onClick={() => window.print()}>
    Print
  </Button>
</Group>



      {parsedDates.map((date) => {
        const dayShifts = shifts.filter(
          s => s.date === date && s.workspaceId === workspaceId
        );
        return (
          <div
            key={date}
            style={{
              pageBreakAfter: 'always',
              marginBottom: 48,
            }}
          >
            <h2 style={{ marginBottom: 8 }}>
              {new Date(date).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </h2>

            <p style={{ color: '#666', marginBottom: 24 }}>
              Daily driving overview
            </p>

            <div
              style={{
                borderTop: '1px solid #ddd',
                paddingTop: 16,
              }}
            >
              {dayShifts.length === 0 && (
  <p style={{ fontSize: 13, color: '#999' }}>
    No shifts for this day
  </p>
)}

            {Object.entries(
              dayShifts.reduce((acc, shift) => {
                if (!acc[shift.bus]) acc[shift.bus] = [];
                acc[shift.bus].push(shift);
                return acc;
              }, {})
            ).map(([bus, shifts]) => (
              <div key={bus} style={{ marginBottom: 16 }}>
                <h4 style={{ marginBottom: 2 }}>{bus}</h4>
<div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
  License: {BUS_LICENSES[bus] || '—'}
</div>

                {shifts.map((shift, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 0',
                      fontSize: 13,
                    }}
                  >
                    {shift.name} · {shift.time} · {shift.driver}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      );
    })}
    </div>
  );
}
