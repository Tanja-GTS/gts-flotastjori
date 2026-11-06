import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Group, Modal, Table, Text, TextInput, Title } from '@mantine/core';
import { useI18n } from './i18n';
import { createBus, deleteBus, updateBus } from './data/backendApi';
// Same layout as the Drivers page, so reuse its styles.
import './drivers.css';

const emptyForm = { route: '', plate: '', capacity: '' };

function formFromBus(bus) {
  return {
    route: String(bus?.route || '').trim(),
    plate: String(bus?.title || '').trim(),
    capacity: bus?.capacity == null ? '' : String(bus.capacity),
  };
}

function busLabel(bus) {
  const plate = String(bus?.title || '').trim();
  const route = String(bus?.route || '').trim();
  return route ? `${plate} (${route})` : plate;
}

export default function Buses({ busOptions = [], onReload }) {
  const { t, locale } = useI18n();

  const [opened, setOpened] = useState(false);
  // The bus being changed, or null while adding a new one.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [refreshing, setRefreshing] = useState(false);

  const isEditing = editing != null;
  const original = isEditing ? formFromBus(editing) : emptyForm;

  // Only the fields that differ from what is stored.
  const changes = useMemo(() => {
    if (!isEditing) return {};
    const out = {};
    for (const key of Object.keys(emptyForm)) {
      if (form[key].trim() !== original[key]) out[key] = form[key].trim();
    }
    return out;
  }, [isEditing, form, original]);

  const routeChanged = isEditing && 'route' in changes;
  const canSave =
    !saving && form.plate.trim().length > 0 && (!isEditing || Object.keys(changes).length > 0);

  const setField = (key) => (e) => {
    // Read the value now: React clears currentTarget once the handler returns.
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setError('');
    setNote('');
  };

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setNote('');
    setOpened(true);
  }

  function openEdit(bus) {
    setEditing(bus);
    setForm(formFromBus(bus));
    setError('');
    setNote('');
    setOpened(true);
  }

  function closeForm() {
    if (saving) return;
    setOpened(false);
    setEditing(null);
    setForm(emptyForm);
    setError('');
  }

  async function reload(fresh) {
    if (onReload) await onReload({ fresh });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await reload(true);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    setNote('');
    try {
      const saved = isEditing
        ? await updateBus(String(editing.value), changes)
        : await createBus({
            plate: form.plate.trim(),
            route: form.route.trim(),
            capacity: form.capacity.trim(),
          });
      const label = isEditing ? t('buses.edit.saved') : t('buses.add.saved');
      setNote(`${label} ${busLabel(saved) || form.plate.trim()}`);
      setOpened(false);
      setEditing(null);
      setForm(emptyForm);
      await reload(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
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
      await deleteBus(String(deleting.value));
      setNote(`${t('buses.delete.done')} ${busLabel(deleting)}`);
      setDeleting(null);
      await reload(true);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  }

  const rows = useMemo(() => {
    const collator = new Intl.Collator(locale || undefined, { sensitivity: 'base', numeric: true });
    return (busOptions || [])
      .filter((b) => b && String(b.value || '').trim())
      .slice()
      .sort(
        (a, b) =>
          collator.compare(String(a.route || ''), String(b.route || '')) ||
          collator.compare(String(a.title || ''), String(b.title || ''))
      );
  }, [busOptions, locale]);

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
        <Button onClick={openAdd}>{t('buses.add.title')}</Button>
        <Button variant="default" onClick={handleRefresh} loading={refreshing}>
          {t('buses.refresh')}
        </Button>
      </Group>

      {note && (
        <div className="driversSavedNote" role="status">
          {note}
        </div>
      )}

      <Modal
        opened={opened}
        onClose={closeForm}
        title={isEditing ? t('buses.edit.title') : t('buses.add.title')}
        centered
      >
        <form
          className="driversAddForm"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <TextInput label={t('buses.add.route')} value={form.route} onChange={setField('route')} data-autofocus />
          <TextInput
            label={t('buses.add.plate')}
            value={form.plate}
            onChange={setField('plate')}
            placeholder={t('buses.add.platePlaceholder')}
            required
          />
          <TextInput
            label={t('buses.add.capacity')}
            value={form.capacity}
            onChange={setField('capacity')}
            placeholder={t('buses.add.capacityPlaceholder')}
            inputMode="numeric"
          />
        </form>

        {routeChanged && (
          <Text size="sm" c="orange.8" fw={600} mt="sm">
            {t('buses.edit.routeWarning')}
          </Text>
        )}

        {error && (
          <div role="alert" style={{ marginTop: 10, fontSize: 13, color: '#b00020', fontWeight: 600 }}>
            {error}
          </div>
        )}

        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={closeForm} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!canSave}>
            {isEditing ? t('buses.edit.submit') : t('buses.add.submit')}
          </Button>
        </Group>
      </Modal>

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

      <div className="driversTableWrap">
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('buses.table.route')}</Table.Th>
              <Table.Th>{t('buses.table.plate')}</Table.Th>
              <Table.Th>{t('buses.table.capacity')}</Table.Th>
              <Table.Th className="driversTable__actionCol" aria-label={t('buses.edit.button')} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={4}>{t('buses.empty')}</Table.Td>
              </Table.Tr>
            ) : (
              rows.map((b) => (
                <Table.Tr key={String(b.value)}>
                  <Table.Td>{String(b.route || '').trim()}</Table.Td>
                  <Table.Td>{String(b.title || '').trim()}</Table.Td>
                  <Table.Td>{b.capacity == null ? '' : b.capacity}</Table.Td>
                  <Table.Td className="driversTable__actionCol">
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Button size="compact-sm" variant="subtle" onClick={() => openEdit(b)}>
                        {t('buses.edit.button')}
                      </Button>
                      <Button size="compact-sm" variant="subtle" color="red" onClick={() => openDelete(b)}>
                        {t('buses.delete.button')}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
