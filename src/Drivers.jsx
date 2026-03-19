import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Table, Title } from '@mantine/core';
import { useI18n } from './i18n';
import './drivers.css';

function isUnassignedDriver(opt) {
  const value = String(opt?.value || '').trim();
  const name = String(opt?.name || opt?.label || '').trim();
  if (!value && !name) return true;
  if (value.toLowerCase() === 'unassigned') return true;
  return /unassigned/i.test(name);
}

export default function Drivers({ driverOptions = [] }) {
  const { t, locale } = useI18n();

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
