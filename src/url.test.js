import { describe, expect, it } from 'vitest';

import { getDongleID, getZoom, getRouteId, getRouteZoom, getPrimeNav, getStreamNav, parseLocation, overlayLocation, drivePath } from './url';

const DONGLE = '0000aaaa0000aaaa';
const LOG = '2026-08-06--12-00-00';

describe('URL pathname helpers', () => {
  it.each([
    [`/${DONGLE}`, DONGLE],
    [`/${DONGLE}/${LOG}`, DONGLE],
    ['/', null],
    ['/prime', null],
  ])('getDongleID(%s)', (pathname, expected) => {
    expect(getDongleID(pathname)).toBe(expected);
  });

  it.each([
    [`/${DONGLE}/10/20`, { start: 10, end: 20 }],
    [`/${DONGLE}/0/20/ignored`, null],
    [`/${DONGLE}/${LOG}/10/20`, null],
    [`/${DONGLE}/10`, null],
    ['/auth/code/provider', null],
  ])('getZoom(%s)', (pathname, expected) => {
    expect(getZoom(pathname)).toEqual(expected);
  });

  it.each([
    [`/${DONGLE}/${LOG}`, LOG],
    [`/${DONGLE}/${LOG}/10/20`, LOG],
    [`/${DONGLE}/prime`, null],
    [`/${DONGLE}`, null],
  ])('getRouteId(%s)', (pathname, expected) => {
    expect(getRouteId(pathname)).toEqual(expected);
  });

  it.each([
    [`/${DONGLE}/${LOG}`, null],
    [`/${DONGLE}/${LOG}/556/610`, { start: 556000, end: 610000 }],
    [`/${DONGLE}/${LOG}/0/20`, { start: 0, end: 20000 }],
    [`/${DONGLE}/10/20`, null],
  ])('getRouteZoom(%s)', (pathname, expected) => {
    expect(getRouteZoom(pathname)).toEqual(expected);
  });

  it.each([
    [`/${DONGLE}/prime`, true],
    [`/${DONGLE}/prime/extra`, false],
    ['/not-a-device/prime', false],
    [`/${DONGLE}/stream`, false],
  ])('getPrimeNav(%s)', (pathname, expected) => {
    expect(getPrimeNav(pathname)).toBe(expected);
  });

  it.each([
    [`/${DONGLE}/stream`, true],
    [`/${DONGLE}/stream/extra`, false],
    ['/not-a-device/stream', false],
    [`/${DONGLE}/prime`, false],
  ])('getStreamNav(%s)', (pathname, expected) => {
    expect(getStreamNav(pathname)).toBe(expected);
  });
});

describe('location grammar', () => {
  it.each(['/'+DONGLE+'junk', '/prefix'+DONGLE, '/not-a-device/'+LOG, '/'+DONGLE+'/'+LOG+'/20/10', '/'+DONGLE+'/'+LOG+'/NaN/20'])('rejects malformed paths: %s', (pathname) => {
    expect(parseLocation({ pathname }).page).toBe('invalid');
    expect(getRouteId(pathname)).toBeNull();
  });
  it('round trips zero-start and fractional route ranges without truncation', () => {
    const zoom = { start: 0, end: 1234 };
    expect(parseLocation({ pathname: drivePath(DONGLE, LOG, zoom) }).zoom).toEqual(zoom);
  });
  it('parses current hexadecimal route IDs', () => {
    expect(getRouteId('/'+DONGLE+'/0000010a--a51155e496')).toBe('0000010a--a51155e496');
  });
  it('preserves page, share arguments and hash while opening and closing settings', () => {
    const location = { pathname: '/'+DONGLE+'/'+LOG, search: '?sig=share', hash: '#timeline' };
    const opened = overlayLocation(location, 'settings', DONGLE, 'uploads');
    expect(parseLocation(opened)).toMatchObject({ page: 'drive', modal: 'settings', settingsDongleId: DONGLE, dialog: 'uploads' });
    expect(overlayLocation(opened, null)).toEqual(location);
  });
});
