import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Group, Modal, Table, TextInput, Title } from '@mantine/core';
import { useI18n } from './i18n';
import { createBus, updateBus } from './data/backendApi';
// Same layout as the Drivers page, so reuse its styles.
import './drivers.css';

export default function Buses({ busOptions = [], onBusAdded }) {
  const { t, locale } = useI18n();

  const [opened, setOpened] = useState(false);
  // null while adding; the bus's id while editing.
  const [editingId, setEditingId] = useState(null);
  const [plate, setPlate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNote, setSavedNote] = useState('');

  const isEditing = editingId != null;
  const canSave = plate.trim().length > 0 && !saving;

  function onPlateChange(e) {
    setPlate(e.target.value);
    setError('');
    setSavedNote('');
  }

  function openAdd() {
    setEditingId(null);
    setPlate('');
    setError('');
    setSavedNote('');
    setOpened(true);
  }

  function openEdit(bus) {
    setEditingId(String(bus.value));
    setPlate(String(bus?.title || bus?.label || '').trim());
    setError('');
    setSavedNote('');
    setOpened(true);
  }

  function closeForm() {
    if (saving) return;
    setOpened(false);
    setEditingId(null);
    setPlate('');
    setError('');
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    setSavedNote('');
    try {
      const value = plate.trim();
      const saved = isEditing
        ? await updateBus(editingId, { plate: value })
        : await createBus({ plate: value });
      const label = isEditing ? t('buses.edit.saved') : t('buses.add.saved');
      setSavedNote(`${label} ${saved?.title || value}`);
      setPlate('');
      setEditingId(null);
      setOpened(false);
      if (onBusAdded) await onBusAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(() => {
    const collator = new Intl.Collator(locale || undefined, { sensitivity: 'base', numeric: true });
    return (busOptions || [])
      .filter((b) => b && String(b.value || '').trim())
      .slice()
      .sort((a, b) =>
        collator.compare(String(a?.title || a?.label || ''), String(b?.title || b?.label || ''))
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
      </Group>

      {savedNote && (
        <div className="driversSavedNote" role="status">
          {savedNote}
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
          <TextInput
            label={t('buses.add.plate')}
            value={plate}
            onChange={onPlateChange}
            placeholder={t('buses.add.platePlaceholder')}
            required
            data-autofocus
          />
        </form>

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

      <div className="driversTableWrap">
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('buses.table.plate')}</Table.Th>
              <Table.Th className="driversTable__actionCol" aria-label={t('buses.edit.button')} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={2}>{t('buses.empty')}</Table.Td>
              </Table.Tr>
            ) : (
              rows.map((b) => (
                <Table.Tr key={String(b.value)}>
                  <Table.Td>{String(b?.title || b?.label || '').trim()}</Table.Td>
                  <Table.Td className="driversTable__actionCol">
                    <Button size="compact-sm" variant="subtle" onClick={() => openEdit(b)}>
                      {t('buses.edit.button')}
                    </Button>
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
