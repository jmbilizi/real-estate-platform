import { composeStreetLine, titleCase } from './address-format';

describe('composeStreetLine', () => {
  it('composes the parts in normal case with the USPS suffix', () => {
    expect(
      composeStreetLine({ StreetNumber: '141', StreetName: 'ASHTON', StreetSuffix: 'COURT' }),
    ).toBe('141 Ashton Ct');
  });

  it('keeps directionals upper case', () => {
    expect(
      composeStreetLine({
        StreetNumber: '401',
        StreetDirPrefix: 'N',
        StreetName: 'ARMISTEAD',
        StreetSuffix: 'STREET',
      }),
    ).toBe('401 N Armistead St');
  });

  it('title-cases a suffix it has no abbreviation for', () => {
    expect(composeStreetLine({ StreetNumber: 9, StreetName: 'OAK', StreetSuffix: 'RUN' })).toBe(
      '9 Oak Run',
    );
  });

  it('returns null without a street number or name', () => {
    expect(composeStreetLine({ StreetName: 'OAK' })).toBeNull();
    expect(composeStreetLine({ StreetNumber: '9' })).toBeNull();
  });
});

describe('titleCase', () => {
  it('raises the first letter of each word, hyphen and apostrophe part', () => {
    expect(titleCase('WEST DEPTFORD TWP')).toBe('West Deptford Twp');
    expect(titleCase("O'FALLON")).toBe("O'Fallon");
    expect(titleCase('WINSTON-SALEM')).toBe('Winston-Salem');
  });
});
