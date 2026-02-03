import { Button, Stack, Text, Group } from '@mantine/core';
import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';

export default function ConfirmShift({ shifts, setShifts }) {
  const [params] = useSearchParams();
  const token = params.get('token');
  const shift = shifts.find(s => s.token === token);

  // Helper: get week range string for the shift's date
  function getWeekRange(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    // Find Monday of the week
    const day = date.getDay();
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((day + 6) % 7));
    // Find Sunday of the week
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    // Format as 11–18 Jan
    const options = { day: '2-digit', month: 'short' };
    const start = monday.toLocaleDateString('en-GB', options);
    const end = sunday.toLocaleDateString('en-GB', options);
    return `${start} – ${end}`;
  }

if (!shift) {
  return (
    <div style={{ padding: 24 }}>
      <h3>Invalid or expired link</h3>
    </div>
  );
}




const updateStatus = (nextStatus) => {
  setShifts(prev =>
    prev.map(s =>
      s.token === token
        ? {
            ...s,
            confirmationStatus: nextStatus
          }
        : s
    )
  );
};


  return (
    <Stack
      align="center"
      justify="center"
      style={{ minHeight: '100vh', padding: 24 }}
      gap="lg"
    >
      <Text size="xl" fw={600}>
        Shift confirmation
      </Text>

      {/* Assignment summary */}
      <Text size="md" fw={500}>
        Hey, <b>{shift.driver === 'Unassigned' ? 'Driver' : shift.driver}</b>!<br />
        You have been assigned for <b>{shift.name}</b> shift on <b>{shift.bus}</b> for the week <b>{getWeekRange(shift.date)}</b>.
      </Text>

      <Text size="sm" c="dimmed">
        Please confirm or decline this shift.
      </Text>

      <Group grow style={{ width: '100%', maxWidth: 400 }}>
        <Button
          size="xl"
          color="green"
          onClick={() => updateStatus('accepted')}
        >
          Accept shift
        </Button>

        <Button
          size="xl"
          color="red"
          onClick={() => updateStatus('declined')}
        >
          Decline shift
        </Button>
      </Group>

      <Text size="sm" c="dimmed">
        Current status: <strong>{shift.confirmationStatus}</strong>
      </Text>

      <Text size="xs" c="dimmed">
        Token: {token}
      </Text>
    </Stack>
  );
}
