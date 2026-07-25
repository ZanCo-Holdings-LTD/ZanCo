import { describe, expect, it } from 'vitest';
import {
  analyseHeaders,
  buildImportPreview,
  importTemplateCsv,
  normalisePhone,
  parseCsv,
  resolveEntityType,
  resolveJurisdiction,
  resolveStatus,
} from './csv.js';

describe('parseCsv', () => {
  it('handles quoted fields containing commas and newlines', () => {
    const rows = parseCsv('a,"b,c","d\ne"\n1,2,3');
    expect(rows).toEqual([
      ['a', 'b,c', 'd\ne'],
      ['1', '2', '3'],
    ]);
  });

  it('handles doubled quotes, CRLF and the Excel BOM', () => {
    expect(parseCsv('﻿a,b\r\n"say ""hi""",2')).toEqual([
      ['a', 'b'],
      ['say "hi"', '2'],
    ]);
  });

  it('drops the blank trailing rows every export produces', () => {
    expect(parseCsv('a,b\n1,2\n\n,\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('analyseHeaders', () => {
  it('maps the headers real spreadsheets use', () => {
    const { mapping } = analyseHeaders([
      'Company Name',
      'Trade Name',
      'Emirate',
      'Free Zone',
      'Licence No.',
      'Licence Expiry Date',
      'Contact Email',
    ]);
    expect(mapping.legalName).toBe(0);
    expect(mapping.tradeName).toBe(1);
    expect(mapping.jurisdiction).toBe(2);
    expect(mapping.freeZone).toBe(3);
    expect(mapping.licenceNumber).toBe(4);
    expect(mapping.licenceExpiresOn).toBe(5);
    expect(mapping.primaryContactEmail).toBe(6);
  });

  it('maps Arabic headers', () => {
    const { mapping } = analyseHeaders(['اسم الشركة', 'رقم الرخصة', 'تاريخ الانتهاء']);
    expect(mapping.legalName).toBe(0);
    expect(mapping.licenceNumber).toBe(1);
    expect(mapping.licenceExpiresOn).toBe(2);
  });

  it('does not let a partial match steal a column from an exact one', () => {
    const { mapping } = analyseHeaders(['Legal Name', 'Licence Expiry Date', 'Expiry Date']);
    expect(mapping.licenceExpiresOn).toBe(1);
  });

  it('reports headers it could not place and required fields it could not find', () => {
    const analysis = analyseHeaders(['Widget Count', 'Sales Rep']);
    expect(analysis.missingRequired).toContain('legalName');
    expect(analysis.unmapped.length).toBeGreaterThan(0);
  });

  it('understands its own template', () => {
    const [headers] = parseCsv(importTemplateCsv());
    const analysis = analyseHeaders(headers!);
    expect(analysis.missingRequired).toEqual([]);
    expect(analysis.unmapped).toEqual([]);
  });
});

describe('value resolution', () => {
  it('resolves jurisdictions from the names firms actually type', () => {
    expect(resolveJurisdiction('Dubai')).toBe('AE-DU');
    expect(resolveJurisdiction('DXB')).toBe('AE-DU');
    expect(resolveJurisdiction('AE-DU')).toBe('AE-DU');
    expect(resolveJurisdiction('Abu Dhabi')).toBe('AE-AZ');
    expect(resolveJurisdiction('RAK')).toBe('AE-RK');
    expect(resolveJurisdiction('KSA')).toBe('SA');
    expect(resolveJurisdiction('السعودية')).toBe('SA');
    expect(resolveJurisdiction('Atlantis')).toBeNull();
  });

  it('resolves entity types and statuses, defaulting safely', () => {
    expect(resolveEntityType('FZCO')).toBe('free_zone_llc');
    expect(resolveEntityType('FZ-LLC')).toBe('free_zone_llc');
    expect(resolveEntityType('LLC')).toBe('mainland_llc');
    expect(resolveEntityType('')).toBe('other');
    expect(resolveEntityType('Something Else')).toBe('other');

    expect(resolveStatus('Active')).toBe('active');
    expect(resolveStatus('On Hold')).toBe('dormant');
    expect(resolveStatus('Closed')).toBe('terminated');
    expect(resolveStatus('')).toBe('active');
  });

  it('normalises phone formatting without discarding the number', () => {
    expect(normalisePhone('+971 50 123 4567')).toBe('+971501234567');
    expect(normalisePhone('00971-50-123-4567')).toBe('+971501234567');
    expect(normalisePhone('')).toBe('');
  });
});

describe('buildImportPreview', () => {
  const csv = [
    'Company Name,Emirate,Free Zone,Licence No.,Licence Expiry Date,Contact Email,Contact Phone',
    'Alpha Trading FZ-LLC,Dubai,IFZA,DL-1001,14/03/2026,ops@alpha.example,+971 50 111 2222',
    'Beta Consulting FZE,Sharjah,SPC Free Zone,DL-1002,2026-06-30,ops@beta.example,050 333 4444',
  ].join('\n');

  it('produces rows ready to insert', () => {
    const preview = buildImportPreview(csv);
    expect(preview.totalDataRows).toBe(2);
    expect(preview.rows).toHaveLength(2);

    const [alpha] = preview.rows;
    expect(alpha!.legalName).toBe('Alpha Trading FZ-LLC');
    expect(alpha!.jurisdiction).toBe('AE-DU');
    expect(alpha!.freeZone).toBe('IFZA');
    expect(alpha!.licence?.number).toBe('DL-1001');
    expect(alpha!.licence?.expiresOn).toBe('2026-03-14');
  });

  it('accepts several date formats in the same column', () => {
    const preview = buildImportPreview(csv);
    expect(preview.rows[0]!.licence?.expiresOn).toBe('2026-03-14');
    expect(preview.rows[1]!.licence?.expiresOn).toBe('2026-06-30');
  });

  it('refuses to guess an unreadable date and says so', () => {
    const preview = buildImportPreview(
      'Company Name,Licence No.,Licence Expiry Date\nGamma Ltd,DL-3,sometime next year',
    );
    const issue = preview.issues.find((i) => i.field === 'licenceExpiresOn');
    expect(issue?.message).toContain('Nothing has been guessed');
    expect(preview.rows[0]!.licence).toBeNull();
  });

  it('warns when a licence has no usable expiry, because it will not appear on the dashboard', () => {
    const preview = buildImportPreview(
      'Company Name,Licence No.,Licence Expiry Date\nGamma Ltd,DL-3,',
    );
    expect(preview.issues.some((i) => i.message.includes('no renewal will be created'))).toBe(true);
  });

  it('flags duplicates without dropping them', () => {
    const preview = buildImportPreview(
      'Company Name\nAlpha Trading FZ-LLC\nalpha trading fz-llc',
    );
    expect(preview.rows).toHaveLength(2);
    expect(preview.issues.some((i) => i.message.includes('Duplicate of row 2'))).toBe(true);
  });

  it('rejects a row with no legal name', () => {
    const preview = buildImportPreview('Company Name,Emirate\n,Dubai');
    expect(preview.rows).toHaveLength(0);
    expect(preview.issues[0]!.severity).toBe('error');
  });

  it('stops before importing anything when a required column is missing', () => {
    const preview = buildImportPreview('Widget Count\n42');
    expect(preview.rows).toHaveLength(0);
    expect(preview.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('warns about a malformed email rather than silently never sending to it', () => {
    const preview = buildImportPreview('Company Name,Contact Email\nAlpha Ltd,not-an-email');
    expect(preview.issues.some((i) => i.message.includes('does not look like an email'))).toBe(true);
  });

  it('handles an empty file', () => {
    const preview = buildImportPreview('');
    expect(preview.rows).toEqual([]);
    expect(preview.totalDataRows).toBe(0);
  });

  it('scales to the file size a real migration arrives as', () => {
    const rows = Array.from(
      { length: 400 },
      (_, i) => `Client ${i} FZ-LLC,Dubai,IFZA,DL-${i},14/03/2026`,
    );
    const large = ['Company Name,Emirate,Free Zone,Licence No.,Licence Expiry Date', ...rows].join('\n');
    const preview = buildImportPreview(large);
    expect(preview.rows).toHaveLength(400);
    expect(preview.rows.every((r) => r.licence?.expiresOn === '2026-03-14')).toBe(true);
  });
});
