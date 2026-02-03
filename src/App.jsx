import { Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Timeline from './Timeline';
import ConfirmShift from './ConfirmShift';
import ErrorBoundary from './ErrorBoundary';
import { WORKSPACES } from './workspaces';
import PrintDay from './PrintDay';


// ⬇️ MOVE your initialShifts array here
const initialShifts = [
  {
    bus: '51A',
    day: 'Mon',
    date: '2026-01-26',
    name: 'Morning',
    time: '06:00–10:00',
    driver: 'Unassigned',
    confirmationStatus: 'unassigned',
    token: '51A-morning-mon',
    workspaceId: 'south',
   
  },
  {
    bus: '51A',
    day: 'Mon',
    date: '2026-01-26',
    name: 'Evening',
    time: '11:30–13:00',
    driver: 'Unassigned',
    confirmationStatus: 'unassigned',
    token: '51A-evening-mon',
     workspaceId: 'south',

  },
  {
    bus: '51A',
    day: 'Mon',
    date: '2026-01-26',
    name: 'Evening',
    time: '14:00–18:00',
    driver: 'Ahmed',
    confirmationStatus: 'pending',
    token: '51A-evening02-mon',  
     workspaceId: 'south',

  },
  {
    bus: '53',
    day: 'Wed',
    date: '2026-01-28',
    name: 'Morning',
    time: '07:00–11:00',
    driver: 'Maria',
    confirmationStatus: 'pending',
    token: '53-morning-wed',
    workspaceId: 'south',

  },
];

function getInitialShifts() {
  const stored = localStorage.getItem('shifts');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return initialShifts;
    }
  }
  return initialShifts;
}

export default function App() {
  const [shifts, setShifts] = useState(getInitialShifts);
  const [workspaceId, setWorkspaceId] = useState(WORKSPACES[0].id);


  // Persist shifts to localStorage on change
  useEffect(() => {
    localStorage.setItem('shifts', JSON.stringify(shifts));
  }, [shifts]);

  return (
    <ErrorBoundary>
      <Routes>
        <Route
          path="/"
          element={
            <Timeline
              shifts={shifts}
              setShifts={setShifts}
              workspaceId={workspaceId}
              setWorkspaceId={setWorkspaceId}
            />
          }
        />
        <Route
          path="/confirm-shift"
          element={
            <ConfirmShift
              shifts={shifts}
              setShifts={setShifts}
              workspaceId={workspaceId}
            />
          }
        />
        <Route
          path="/print-day"
          element={<PrintDay shifts={shifts} workspaceId={workspaceId} />}
        />
</Routes>
    </ErrorBoundary>
  );
}
