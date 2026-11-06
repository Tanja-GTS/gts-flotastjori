import React, { useEffect, useState } from 'react';
import { MAINTENANCE_EVENT } from './data/backendApi';

// Shows the maintenance screen when the server says the system is under
// maintenance, e.g. to someone who had the app open when it was switched on.
// The person doing the work (let in with the bypass link) sees the app with a
// reminder banner instead.
export default function MaintenanceGate({ children }) {
  const [state, setState] = useState('off'); // 'off' | 'on' | 'bypass'
  const [message, setMessage] = useState('');

  useEffect(() => {
    function onMaintenance(e) {
      const next = e?.detail?.state;
      if (next === 'on') {
        setState('on');
        setMessage(String(e.detail.message || ''));
      } else if (next === 'bypass') {
        setState((s) => (s === 'on' ? s : 'bypass'));
      }
    }
    window.addEventListener(MAINTENANCE_EVENT, onMaintenance);
    return () => window.removeEventListener(MAINTENANCE_EVENT, onMaintenance);
  }, []);

  if (state === 'on') {
    return (
      <div className="maintenanceScreen" role="alert">
        <div className="maintenanceScreen__card">
          <h1>Í viðhaldi</h1>
          <h2>Under maintenance</h2>
          <p>Verið er að vinna að kerfinu. Reyndu aftur eftir smá stund.</p>
          <p className="maintenanceScreen__en">We are working on the system. Please try again shortly.</p>
          {message && <p className="maintenanceScreen__note">{message}</p>}
          <button type="button" onClick={() => window.location.reload()}>
            Reyna aftur · Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {state === 'bypass' && (
        <div className="maintenanceBanner" role="status">
          Viðhaldsstilling er á: aðeins þú sérð kerfið. · Maintenance mode is ON: only you can see the app.
        </div>
      )}
      {children}
    </>
  );
}
