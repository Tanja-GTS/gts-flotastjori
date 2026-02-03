import { useNavigate } from 'react-router-dom';
import { Drawer, Button, Select, Checkbox, Accordion, TextInput } from '@mantine/core';
import { IconAlertCircle, IconChevronDown, IconChevronUp, IconChevronLeft, IconChevronRight, IconPrinter } from '@tabler/icons-react';
import React, { useState, useEffect, useCallback } from 'react';
import { addDays } from 'date-fns';
import './timeline.css';



const buses = [
  { value: '51A', label: '51A' },
  { value: '53', label: '53' },
  { value: 'Airport', label: 'Airport' }
];



const drivers = ['Ahmed', 'Maria', 'Jon', 'Sara'];

const tripsByShift = {
  '51A-Morning': [
    {
      name: 'Trip 01',
      time: '06:00–07:20',
      events: [
        { type: 'stop', time: '06:00', label: 'Terminal' },
        { type: 'stop', time: '06:15', label: 'Main St' },
        { type: 'stop', time: '06:32', label: 'Harbor' },
        { type: 'break', duration: 10 },
        { type: 'stop', time: '06:55', label: 'Central' },
        { type: 'stop', time: '07:10', label: 'Depot' },
      ],
    },
    {
      name: 'Trip 02',
      time: '07:40–09:00',
      events: [
        { type: 'stop', time: '07:40', label: 'Depot' },
        { type: 'stop', time: '08:10', label: 'Airport' },
      ],
    },
  ],
};

export default function Timeline({ shifts, setShifts, workspaceId, setWorkspaceId }) {
    const navigate = useNavigate();
  const [selectedShiftToken, setSelectedShiftToken] = useState(null);
  const [editedDriver, setEditedDriver] = useState(null);
  const [assignSingle, setAssignSingle] = useState(false);
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [viewDays, setViewDays] = useState(7);
  const [showNotes, setShowNotes] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editedNote, setEditedNote] = useState('');
  const [addMode, setAddMode] = useState(false);
  const [newShift, setNewShift] = useState({
    bus: '',
    date: '',
    name: '',
    startTime: '',
    endTime: '',
  });
  const [columnWidth, setColumnWidth] = useState(0);
  const [formError, setFormError] = useState('');
  const [selectedDates, setSelectedDates] = useState([]);

  const visibleShifts = shifts.filter(
    s => s.workspaceId === workspaceId
  );

  const toggleDateSelection = (date) => {
    setSelectedDates((prev) => {
      const exists = prev.some(d => d.toDateString() === date.toDateString());

      if (exists) {
        return prev.filter(d => d.toDateString() !== date.toDateString());
      }

      return [...prev, date];
    });
  };

<Button
  disabled={selectedDates.length === 0}
  onClick={() => {
    // temporary – we replace this later
    console.log(
      'Printing dates:',
      selectedDates.map(d => d.toISOString().slice(0, 10))
    );

    // IMPORTANT: reset selection
    setSelectedDates([]);
  }}
>
  Print selected days
</Button>



  // Find the selected shift by token
  const selectedShift = selectedShiftToken ? visibleShifts.find(s => s.token === selectedShiftToken) : null;
  // Calculate column width safely
  useEffect(() => {
    const updateWidth = () => {
      const screenWidth = typeof window !== 'undefined' ? window.innerWidth - 200 : 1200;
      setColumnWidth(Math.floor(screenWidth / viewDays));
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [viewDays]);

  const selectedTrips = selectedShift
    ? tripsByShift[`${selectedShift.bus}-${selectedShift.name}`] || []
    : [];

  const existingNote = selectedShift ? selectedShift.note || '' : '';




  // Jan 29, 2026 is Thursday - calculate Monday of that week
  const today = new Date(2026, 0, 29);
  const getTodayMonday = useCallback(() => {
    const d = new Date(today);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }, []);

  const [currentWeekStart, setCurrentWeekStart] = useState(getTodayMonday);

  const handlePrevious = () => {
    setCurrentWeekStart(prev => addDays(prev, -viewDays));
  };

  const handleNext = () => {
    setCurrentWeekStart(prev => addDays(prev, viewDays));
  };

  const handleToday = () => {
    setCurrentWeekStart(getTodayMonday());
  };

  const handleSaveNewShift = () => {
    if (!newShift.bus || !newShift.date || !newShift.name || !newShift.startTime || !newShift.endTime) {
      setFormError('Please fill all fields.');
      return;
    }

    const dateObj = new Date(newShift.date);
    if (isNaN(dateObj.getTime())) {
      setFormError('Invalid date.');
      return;
    }

    setFormError('');
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[dateObj.getDay()];
    // Generate a unique token for the shift
    const token = `${newShift.bus}-${newShift.name}-${newShift.date}-${Math.random().toString(36).slice(2,8)}`;

    setShifts(prev => [
      ...prev,
      {
        bus: newShift.bus,
        day: dayName,
        date: newShift.date, // Store actual date for manual shifts
        name: newShift.name,
        time: `${newShift.startTime}–${newShift.endTime}`,
        driver: 'Unassigned',
        manual: true,
        token,
        confirmationStatus: 'unassigned',
        workspaceId: workspaceId
      },
    ]);

    // Reset form
    setNewShift({
      bus: '',
      date: '',
      name: '',
      startTime: '',
      endTime: '',
    });
    setAddMode(false);
  };

  const handleCancelAdd = () => {
    setAddMode(false);
    setNewShift({
      bus: '',
      date: '',
      name: '',
      startTime: '',
      endTime: '',
    });
  };

  const dayDates = Array.from({ length: viewDays }).map((_, i) =>
    addDays(currentWeekStart, i)
  );

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daysWithNames = dayDates.map(date => ({
    date,
    name: dayNames[date.getDay()]
  }));

  return (
    <>
     
     <div
  style={{
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    borderBottom: '1px solid #eee',
  }}
>
  <Select
    label="Workspace"
    data={[
      { value: 'south', label: 'South Iceland' },
      { value: 'school', label: 'School Transport' },
      { value: 'airport', label: 'Airport Transfers' },
    ]}
    value={workspaceId}
    onChange={setWorkspaceId}
    style={{ width: 220 }}
  />
</div>
     
      <header>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 24px 8px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Month/Year Dropdown (placeholder for now) */}
            <button
              type="button"
              aria-label="Select month and year"
              style={{
                fontSize: 32,
                fontWeight: 700,
                background: 'none',
                border: 'none',
                color: '#222',
                cursor: 'pointer',
                padding: 0,
                marginRight: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              January 2026
              <IconChevronDown size={28} aria-hidden="true" style={{ marginLeft: 4 }} />
            </button>
            <Button variant="subtle" onClick={handlePrevious} aria-label="Previous week" style={{ fontSize: 24, padding: '0 8px', display: 'flex', alignItems: 'center' }}>
              <IconChevronLeft size={28} aria-hidden="true" />
            </Button>
            <Button variant="subtle" onClick={handleNext} aria-label="Next week" style={{ fontSize: 24, padding: '0 8px', display: 'flex', alignItems: 'center' }}>
              <IconChevronRight size={28} aria-hidden="true" />
            </Button>
          </div>
          <div>
            <Button onClick={() => setAddMode(true)} aria-label="Add new shift">+ Add shift</Button>
          </div>
        </div>
      </header>




      {/* Controls row just above the timeline */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '8px 24px 8px 24px',
        marginBottom: 8
      }}>
        <Button
          disabled={selectedDates.length === 0}
          onClick={() => {
            const datesParam = selectedDates
              .map(d => d.toISOString().slice(0, 10))
              .join(',');

            // reset selection immediately
            setSelectedDates([]);

            // navigate to print page
            navigate(`/print-day?dates=${datesParam}`);
          }}
          size="xs"
          style={{ whiteSpace: 'normal', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <IconPrinter size={16} style={{ marginRight: 4 }} />
          <span>Print</span>
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button variant="default" onClick={handleToday} aria-label="Go to current week">
            Today
          </Button>
          <Select
            data={[
              { value: '7', label: '1 Week' },
              { value: '14', label: '2 Weeks' },
            ]}
            value={String(viewDays)}
            onChange={(value) => setViewDays(Number(value))}
            style={{ width: 120 }}
          />
          <Checkbox
            label="Show unassigned shifts only"
            checked={showUnassignedOnly}
            onChange={(e) => setShowUnassignedOnly(e.currentTarget.checked)}
            style={{ marginLeft: 16 }}
          />
        </div>
      </div>

      <main>
      <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', border: '1px solid #ddd', height: '70vh' }}>
        <div
          className="timeline"
          style={{
            gridTemplateColumns: `90px repeat(${viewDays}, 1fr)`,
            display: 'grid',
            width: '100%'
          }}
        >
          {/* top-left corner */}
          <div className="corner" />

          {/* day headers */}
          {daysWithNames.map(({ date, name }, i) => {
            const dateStr = `${date.getDate()} ${date.toLocaleDateString('en-US', { month: 'short' })}`;
            const isSelected =
              selectedDates.length === 0 ||
              selectedDates.some(d => d.toDateString() === date.toDateString());
            return (
              <div
                key={`${name}-${i}`}
                className="day-header"
                style={{
                  opacity: isSelected ? 1 : 0.4,
                  transition: 'opacity 120ms ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={selectedDates.some(d => d.toDateString() === date.toDateString())}
                    onChange={() => toggleDateSelection(date)}
                  />
                  <span>{name}</span>
                </div>
                <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>{dateStr}</div>
              </div>
            );
          })}

          {/* bus rows */}
          {buses.map(bus => (
            <React.Fragment key={bus.value}>
              {/* bus label */}
              <div className="bus-label">{bus.value}</div>

              {/* cells for this bus */}
              {daysWithNames.map(({ date, name: dayName }) => {
                const dayShifts = visibleShifts.filter(
                  shift => {
                    // Match by bus and exact date string (YYYY-MM-DD)
                    const shiftDate = shift.date || '';
                    const cellDate = date.toISOString().slice(0,10);
                    return (
                      shift.bus === bus.value &&
                      shiftDate === cellDate &&
                      (!showUnassignedOnly || shift.driver === 'Unassigned')
                    );
                  }
                );
                const isSelected =
                  selectedDates.length === 0 ||
                  selectedDates.some(d => d.toDateString() === date.toDateString());

                return (
                  <div
                    key={`${bus.value}-${date.toISOString()}`}
                    className="cell"
                    style={{
                      opacity: isSelected ? 1 : 0.35,
                      transition: 'opacity 120ms ease'
                    }}
                  >
                    {dayShifts.map((shift, i) => (
                      <div
                        key={shift.token || `${shift.bus}-${shift.day}-${shift.name}-${i}`}
                        className="shift-card"
                        role="button"
                        tabIndex={0}
                        aria-label={`${shift.name} shift from ${shift.time} for ${shift.driver}`}
                        style={{ outline: 'none' }}
                        onFocus={e => e.currentTarget.style.boxShadow = '0 0 0 3px #1971c2'}
                        onBlur={e => e.currentTarget.style.boxShadow = 'none'}
                        onClick={() => {
                          setEditedDriver(shift.driver);
                          setEditedNote(shift.note || '');
                          setIsEditingNote(false);
                          setShowNotes(false);
                          setSelectedShiftToken(shift.token);
                          setAddMode(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setEditedDriver(shift.driver);
                            setEditedNote(shift.note || '');
                            setIsEditingNote(false);
                            setShowNotes(false);
                            setSelectedShiftToken(shift.token);
                            setAddMode(false);
                          }
                        }}
                      >
                        <div className="shift-name" style={{ color: '#1a1a1a', fontWeight: 600 }}>{shift.name}</div>
                        <div className="shift-time" style={{ color: '#222' }}>{shift.time}</div>
                        <div className="shift-driver" style={{ color: shift.driver === 'Unassigned' ? '#b00020' : '#1a1a1a', fontWeight: 500 }}>
                          {shift.driver === 'Unassigned' ? 'UNASSIGNED' : shift.driver}
                        </div>
                        {shift.confirmationStatus !== 'unassigned' && (
                          <div className="shift-status" style={{ color: shift.confirmationStatus === 'pending' ? '#b36a00' : shift.confirmationStatus === 'accepted' ? '#1971c2' : '#b00020', fontWeight: 600 }}>
                            {shift.confirmationStatus === 'pending' && 'Pending'}
                            {shift.confirmationStatus === 'accepted' && 'Accepted'}
                            {shift.confirmationStatus === 'declined' && 'Declined'}
                          </div>
                        )}

                      </div>
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* SINGLE DRAWER - handles both edit and add modes */}
      <Drawer
        opened={!!selectedShiftToken || addMode}
        onClose={() => {
          setSelectedShiftToken(null);
          setAddMode(false);
          setNewShift({
            bus: '',
            date: '',
            name: '',
            startTime: '',
            endTime: '',
          });
          setFormError('');
        }}
        title={addMode ? "Add new shift" : "Shift details"}
        position="right"
        size="md"
      >
        {addMode ? (
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            onSubmit={e => {
              e.preventDefault();
              handleSaveNewShift();
            }}
            aria-labelledby="add-shift-heading"
          >
            <h2 id="add-shift-heading" style={{ fontSize: 22, color: '#222' }}>Add new shift</h2>
            <p style={{ fontSize: 14, color: '#444' }}>
              Manual shift outside of patterns
            </p>

            <Select
              label="Bus"
              data={buses}
              value={newShift.bus}
              onChange={(value) => setNewShift(prev => ({ ...prev, bus: value || '' }))}
              placeholder="Select bus"
              required
            />

            <div>
              <label htmlFor="shift-date" style={{ display: 'block', fontWeight: 500, marginBottom: 4 }}>Date</label>
              <input
                id="shift-date"
                type="date"
                value={newShift.date}
                onChange={(e) => setNewShift(prev => ({ ...prev, date: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #c1c2c5',
                  borderRadius: '4px',
                  fontSize: '14px'
                }}
                required
              />
            </div>

            <TextInput
              label="Shift name"
              placeholder="e.g., Morning, Afternoon, Evening"
              value={newShift.name}
              onChange={(e) => setNewShift(prev => ({ ...prev, name: e.target.value }))}
              required
            />

            <TextInput
              label="Start time"
              type="time"
              value={newShift.startTime}
              onChange={(e) => setNewShift(prev => ({ ...prev, startTime: e.target.value }))}
              required
            />

            <TextInput
              label="End time"
              type="time"
              value={newShift.endTime}
              onChange={(e) => setNewShift(prev => ({ ...prev, endTime: e.target.value }))}
              required
            />

            {formError && (
              <div role="alert" style={{ color: '#b00020', fontWeight: 500, fontSize: 14 }}>
                {formError}
              </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <Button type="submit">Save shift</Button>
              <Button variant="default" onClick={handleCancelAdd}>Cancel</Button>
            </div>
          </form>
        ) : (
          /* EDIT EXISTING SHIFT */
          selectedShift && (
            <>
              <p><strong>Bus:</strong> {selectedShift.bus}</p>
              <p><strong>Shift:</strong> {selectedShift.name}</p>
              <p><strong>Time:</strong> {selectedShift.time}</p>

              <p>
                <strong>Driver:</strong>{' '}
                {selectedShift.driver === 'Unassigned' ? (
                  <>
                    <IconAlertCircle size={16} color="#868e96" />
                    <span style={{ marginLeft: 6 }}>Unassigned</span>
                  </>
                ) : (
                  selectedShift.driver
                )}
              </p>

              <hr style={{ margin: '16px 0' }} />

              <div style={{ marginBottom: 12 }}>
                <Select
                  label="Assign driver"
                  data={drivers}
                  value={editedDriver}
                  onChange={setEditedDriver}
                  placeholder="Select driver"
                  clearable
                  mt="sm"
                />

                <p style={{ fontSize: 13, color: '#555', marginTop: 12 }}>
                  Assigning a driver will apply to all shifts of this type for <strong>the week</strong>.
                </p>

                <Checkbox
                  mt="sm"
                  label="Assign only this shift"
                  checked={assignSingle}
                  onChange={(e) => setAssignSingle(e.currentTarget.checked)}
                />

                <div style={{ marginTop: 12 }}>
                  <Button
                    mt="md"
                    onClick={() => {
                      setShifts(prev =>
                        prev.map(s =>
                          s.token === selectedShiftToken
                            ? { ...s, driver: editedDriver || 'Unassigned',
                                confirmationStatus: editedDriver ? 'pending' : 'unassigned',
                              }
                            : s
                        )
                      );
                      setSelectedShiftToken(null);
                    }}
                  >
                    Save changes
                  </Button>
                </div>
              </div>

              <hr style={{ margin: '16px 0' }} />

              {existingNote ? (
                <>
                  <div
                    style={{
                      background: '#fff3bf',
                      border: '1px solid #ffe066',
                      borderRadius: 6,
                      padding: '8px 10px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                    onClick={() => setShowNotes((v) => !v)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 13 }}>⚠️ 1 note for this trip</strong>
                      <span style={{ display: 'inline-flex', alignItems: 'center', color: '#444' }}>
                        {showNotes ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                      </span>
                    </div>
                  </div>

                  {showNotes && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ padding: 8, background: '#fff', borderRadius: 6 }}>
                        <p style={{ margin: 0, fontSize: 13 }}>{existingNote}</p>
                      </div>

                      {!isEditingNote && (
                        <div style={{ marginTop: 8 }}>
                          <Button
                            size="xs"
                            variant="outline"
                            style={{ height: 24, padding: '0 8px' }}
                            onClick={() => { 
                              setIsEditingNote(true); 
                              setEditedNote(existingNote); 
                            }}
                          >
                            Edit
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <Button
                  variant="subtle"
                  onClick={() => { 
                    setIsEditingNote(true); 
                    setEditedNote(''); 
                  }}
                >
                  Add note
                </Button>
              )}

              {isEditingNote && (
                <div style={{ marginTop: 8 }}>
                  <textarea
                    value={editedNote}
                    onChange={(e) => setEditedNote(e.target.value)}
                    placeholder="Describe what happened during this shift…"
                    style={{
                      width: '100%',
                      minHeight: 80,
                      padding: 8,
                      fontSize: 13,
                    }}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Button
                      mt="md"
                      onClick={() => {
                        setShifts(prev => {
                          const newShifts = prev.map(s =>
                            s.token === selectedShiftToken
                              ? { ...s, note: editedNote.trim() }
                              : s
                          );
                          // No need to update selectedShiftToken, just keep drawer open
                          return newShifts;
                        });
                        setIsEditingNote(false);
                        if (editedNote.trim()) setShowNotes(true);
                      }}
                    >
                      Save changes
                    </Button>
                  </div>
                </div>
              )}

              <h4 style={{ marginBottom: 8, marginTop: 24 }}>Trips</h4>

              {selectedTrips.length === 0 && (
                <p style={{ fontSize: 13, color: '#777' }}>
                  No trips defined for this shift.
                </p>
              )}

              <Accordion multiple>
                {selectedTrips.map((trip, i) => (
                  <Accordion.Item key={i} value={trip.name}>
                    <Accordion.Control>
                      <strong>{trip.name}</strong>
                      <span style={{ marginLeft: 8, fontWeight: 400 }}>
                        ({trip.time})
                      </span>
                    </Accordion.Control>

                    <Accordion.Panel>
                      <ul style={{ paddingLeft: 16, margin: 0 }}>
                        {trip.events.map((ev, j) => (
                          <li key={j} style={{ fontSize: 13, marginBottom: 4 }}>
                            {ev.type === 'stop' ? (
                              <>
                                <strong>{ev.time}</strong> — {ev.label}
                              </>
                            ) : (
                              <em>Break — {ev.duration} min</em>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
            </>
          )
        )}
      </Drawer>
      </main>
    </>
  );
}


