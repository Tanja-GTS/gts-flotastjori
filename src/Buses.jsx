import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Group, Modal, Table, Text, TextInput, Title } from '@mantine/core';
import { useI18n } from './i18n';
import { createBus, deleteBus, fetchBusesPage, updateBus } from './data/backendApi';
// Same layout as the Drivers page, so reuse its styles.
import './drivers.css';

// Every field the page knows. Capacity only shows when SharePoint has the
// column; the others always show, so a missing column is visible.
const FIELDS = [
  { key: 'route' },
  { key: 'plate' },
  { key: 'busNumber', numeric: true },
  { key: 'type' },
  { key: 'capacity', optional: true, numeric: true },
];

const NEW_ROW = '__new__';

function valuesOf(bus) {
  const out = {};
  for (const f of FIELDS) out[f.key] = bus?.[f.key] == null ? '' : String(bus[f.key]);
  return out;
}

function busLabel(bus) {
  const name = String(bus?.plate || bus?.busNumber || bus?.title || '').trim();
  const route = String(bus?.route || '').trim();
  return route ? `${name} (${route})` : name;
}

export default function Buses({ onReload }) {
  const { t, locale } = useI18n();

  const [buses, setBuses] = useState(null);
  const [columns, setColumns] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // The row being edited: a bus id, NEW_ROW for a new bus, or null.
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState('');
  const [note, setNote] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = useCallback(async ({ fresh = false } = {}) => {
    setLoadError('');
    try {
      const data = await fetchBusesPage({ fresh });
      setBuses(data.buses);
      setColumns(data.columns);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // After a change: re-read this page, and the bus picker on the shift board.
  async function reloadAll() {
    await load({ fresh: true });
    if (onReload) await onReload({ fresh: false });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load({ fresh: true });
      if (onReload) await onReload({ fresh: false });
    } finally {
      setRefreshing(false);
    }
  }

  const hasColumn = (key) => (columns ? Boolean(columns[key]) : true);
  const visibleFields = FIELDS.filter((f) => !f.optional || (columns && columns[f.key]));
  const missingNames = columns
    ? FIELDS.filter((f) => !f.optional && !columns[f.key]).map((f) => t(`buses.field.${f.key}`))
    : [];

  const rows = useMemo(() => {
    const collator = new Intl.Collator(locale || undefined, { sensitivity: 'base', numeric: true });
    return (buses || [])
      .slice()
      .sort(
        (a, b) =>
          collator.compare(String(a.route || ''), String(b.route || '')) ||
          collator.compare(String(a.plate || a.title || ''), String(b.plate || b.title || ''))
      );
  }, [buses, locale]);

  const editingBus = editingId && editingId !== NEW_ROW ? rows.find((b) => b.id === editingId) : null;
  const original = editingId === NEW_ROW ? valuesOf(null) : valuesOf(editingBus);

  // Only the fields the manager actually changed.
  const changes = {};
  if (editingId) {
    for (const f of FIELDS) {
      const value = String(draft[f.key] ?? '').trim();
      if (value !== original[f.key].trim()) changes[f.key] = value;
    }
  }
  const canSave = !saving && Object.keys(changes).length > 0;

  function startEdit(bus) {
    setEditingId(bus.id);
    setDraft(valuesOf(bus));
    setRowError('');
    setNote('');
  }

  function startAdd() {
    setEditingId(NEW_ROW);
    setDraft(valuesOf(null));
    setRowError('');
    setNote('');
  }

  function cancelEdit() {
    if (saving) return;
    setEditingId(null);
    setDraft({});
    setRowError('');
  }

  const setField = (key) => (e) => {
    // Read the value now: React clears currentTarget once the handler returns.
    const value = e.target.value;
    setDraft((d) => ({ ...d, [key]: value }));
    setRowError('');
  };

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setRowError('');
    try {
      const saved =
        editingId === NEW_ROW ? await createBus(changes) : await updateBus(editingId, changes);
      const label = editingId === NEW_ROW ? t('buses.add.saved') : t('buses.edit.saved');
      setNote(`${label} ${busLabel(saved)}`);
      setEditingId(null);
      setDraft({});
      await reloadAll();
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  }

  function openDelete(bus) {
    setDeleting(bus);
    setDeleteError('');
    setNote('');
  }

  function closeDelete() {
    if (deleteBusy) return;
    setDeleting(null);
    setDeleteError('');
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await deleteBus(deleting.id);
      setNote(`${t('buses.delete.done')} ${busLabel(deleting)}`);
      setDeleting(null);
      await reloadAll();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  const columnCount = visibleFields.length + 1;

  function renderEditRow(key) {
    return (
      <React.Fragment key={key}>
        <Table.Tr className="busesRow--editing">
          {visibleFields.map((f) => (
            <Table.Td key={f.key}>
              <TextInput
                size="xs"
                aria-label={t(`buses.field.${f.key}`)}
                value={draft[f.key] ?? ''}
                onChange={setField(f.key)}
                onKeyDown={onKeyDown}
                disabled={!hasColumn(f.key) || saving}
                placeholder={hasColumn(f.key) ? '' : t('buses.noColumn')}
                inputMode={f.numeric ? 'numeric' : undefined}
                autoFocus={f.key === 'route'}
              />
            </Table.Td>
          ))}
          <Table.Td className="driversTable__actionCol">
            <Group gap={4} wrap="nowrap" justify="flex-end">
              <Button size="compact-sm" onClick={handleSave} loading={saving} disabled={!canSave}>
                {t('buses.edit.save')}
              </Button>
              <Button size="compact-sm" variant="default" onClick={cancelEdit} disabled={saving}>
                {t('common.cancel')}
              </Button>
            </Group>
          </Table.Td>
        </Table.Tr>
        {rowError && (
          <Table.Tr>
            <Table.Td colSpan={columnCount}>
              <div role="alert" style={{ fontSize: 13, color: '#b00020', fontWeight: 600 }}>
                {rowError}
              </div>
            </Table.Td>
          </Table.Tr>
        )}
      </React.Fragment>
    );
  }

  return (
    <div className="driversPage">
      <div className="driversBreadcrumbs" aria-label={t('drivers.breadcrumbs.label')}>
        <Link to="/" className="driversBreadcrumbs__link">
          {t('drivers.breadcrumbs.home')}
        </Link>
        <span className="driversBreadcrumbs__sep">/</span>
        <span className="driversBreadcrumbs__current">{t('buses.breadcrumbs.buses')}</span>
      </div>

      <Title order={2} className="driversTitle">
        {t('buses.title')}
      </Title>

      <Group className="driversActions">
        <Button onClick={startAdd} disabled={editingId != null || buses == null}>
          {t('buses.add.button')}
        </Button>
        <Button variant="default" onClick={handleRefresh} loading={refreshing}>
          {t('buses.refresh')}
        </Button>
      </Group>

      {note && (
        <div className="driversSavedNote" role="status">
          {note}
        </div>
      )}

      {missingNames.length > 0 && (
        <div className="busesNotice" role="status">
          {t('buses.missingColumns', { names: missingNames.join(', ') })}
        </div>
      )}

      {loadError && (
        <div role="alert" className="busesNotice busesNotice--error">
          {loadError}
        </div>
      )}

      <Modal opened={deleting != null} onClose={closeDelete} title={t('buses.delete.title')} centered>
        <Text size="sm">{t('buses.delete.confirm', { bus: busLabel(deleting) })}</Text>

        {deleteError && (
          <div role="alert" style={{ marginTop: 10, fontSize: 13, color: '#b00020', fontWeight: 600 }}>
            {deleteError}
          </div>
        )}

        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={closeDelete} disabled={deleteBusy}>
            {t('common.cancel')}
          </Button>
          <Button color="red" onClick={handleDelete} loading={deleteBusy}>
            {t('buses.delete.submit')}
          </Button>
        </Group>
      </Modal>

      <div className="driversTableWrap busesTableWrap">
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              {visibleFields.map((f) => (
                <Table.Th key={f.key}>{t(`buses.field.${f.key}`)}</Table.Th>
              ))}
              <Table.Th className="driversTable__actionCol" aria-label={t('buses.edit.button')} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {editingId === NEW_ROW && renderEditRow(NEW_ROW)}

            {buses == null && !loadError && (
              <Table.Tr>
                <Table.Td colSpan={columnCount}>{t('buses.loading')}</Table.Td>
              </Table.Tr>
            )}

            {buses != null && rows.length === 0 && editingId !== NEW_ROW && (
              <Table.Tr>
                <Table.Td colSpan={columnCount}>{t('buses.empty')}</Table.Td>
              </Table.Tr>
            )}

            {rows.map((b) =>
              editingId === b.id ? (
                renderEditRow(b.id)
              ) : (
                <Table.Tr key={b.id}>
                  {visibleFields.map((f) => (
                    <Table.Td key={f.key}>{b[f.key] == null ? '' : String(b[f.key])}</Table.Td>
                  ))}
                  <Table.Td className="driversTable__actionCol">
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        onClick={() => startEdit(b)}
                        disabled={editingId != null}
                      >
                        {t('buses.edit.button')}
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        color="red"
                        onClick={() => openDelete(b)}
                        disabled={editingId != null}
                      >
                        {t('buses.delete.button')}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              )
            )}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
