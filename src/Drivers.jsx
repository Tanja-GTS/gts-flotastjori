import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Accordion, Button, Group, Table, TextInput, Title } from '@mantine/core';
import { useI18n } from './i18n';
import { createDriver } from './data/backendApi';
import './drivers.css';

function isUnassignedDriver(opt) {
  const value = String(opt?.value || '').trim();
  const name = String(opt?.name || opt?.label || '').trim();
  if (!value && !name) return true;
  if (value.toLowerCase() === 'unassigned') return true;
  return /unassigned/i.test(name);
}

export default function Drivers({ driverOptions = [], onDriverAdded }) {
  const { t, locale } = useI18n();

  const emptyForm = { name: '', phone: '', email: '', ssn: '' };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedName, setSavedName] = useState('');

  const setField = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.currentTarget.value }));
    setError('');
    setSavedName('');
  };

  const canSave = String(form.name || '').trim().length > 0 && !saving;

  async function handleAdd() {
    setSaving(true);
    setError('');
    setSavedName('');
    try {
      const created = await createDriver({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        ssn: form.ssn.trim(),
      });
      setForm(emptyForm);
      setSavedName(created?.name || form.name.trim());
      if (onDriverAdded) await onDriverAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const rows = useMemo(() => {
    const collator = new Intl.Collator(locale || undefined, { sensitivity: 'base', numeric: true });
    return (driverOptions || [])
      .filter((o) => o && !isUnassignedDriver(o))
      .slice()
      .sort((a, b) => {
        const aName = String(a?.name || a?.label || '').trim();
        const bName = String(b?.name || b?.label || '').trim();
        return collator.compare(aName, bName);
      });
  }, [driverOptions, locale]);

  return (
    <div className="driversPage">
      <div className="driversBreadcrumbs" aria-label={t('drivers.breadcrumbs.label')}>
        <Link to="/" className="driversBreadcrumbs__link">
          {t('drivers.breadcrumbs.home')}
        </Link>
        <span className="driversBreadcrumbs__sep">/</span>
        <span className="driversBreadcrumbs__current">{t('drivers.breadcrumbs.drivers')}</span>
      </div>

      <Title order={2} className="driversTitle">
        {t('drivers.title')}
      </Title>

      <Accordion chevronPosition="right" className="driversAddAccordion">
        <Accordion.Item value="add-driver">
          <Accordion.Control>
            <h4 style={{ margin: 0 }}>{t('drivers.add.title')}</h4>
          </Accordion.Control>
          <Accordion.Panel>
            <div className="driversAddForm">
              <TextInput
                label={t('drivers.table.name')}
                value={form.name}
                onChange={setField('name')}
                required
              />
              <TextInput label={t('drivers.table.phone')} value={form.phone} onChange={setField('phone')} />
              <TextInput label={t('drivers.table.email')} value={form.email} onChange={setField('email')} />
              <TextInput
                label={t('drivers.add.ssn')}
                value={form.ssn}
                onChange={setField('ssn')}
                placeholder={t('drivers.add.ssnPlaceholder')}
              />
            </div>

            <Group mt="md">
              <Button onClick={handleAdd} loading={saving} disabled={!canSave}>
                {t('drivers.add.submit')}
              </Button>
            </Group>

            {error && (
              <div role="alert" style={{ marginTop: 10, fontSize: 13, color: '#b00020', fontWeight: 600 }}>
                {error}
              </div>
            )}
            {savedName && (
              <div style={{ marginTop: 10, fontSize: 13, color: '#1a7f37', fontWeight: 600 }}>
                {t('drivers.add.saved')} {savedName}
              </div>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <div className="driversTableWrap">
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('drivers.table.name')}</Table.Th>
              <Table.Th>{t('drivers.table.phone')}</Table.Th>
              <Table.Th>{t('drivers.table.email')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((d) => (
              <Table.Tr key={String(d.value)}>
                <Table.Td>{String(d?.name || d?.label || '').trim()}</Table.Td>
                <Table.Td>{String(d?.phone || '').trim()}</Table.Td>
                <Table.Td>{String(d?.email || '').trim()}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
