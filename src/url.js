// URL grammar lives here. Route ranges use seconds in URLs and milliseconds in
// application state; legacy timestamp ranges already use milliseconds.
const dongleIdRegex = /^[a-f0-9]{16}$/;
const logIdRegex = /^(?:[a-f0-9]{8}--[a-f0-9]{10}|\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2})$/;
const dialogs = new Set(['uploads', 'unpair']);

function range(start, end, scale = 1) {
  if (!/^\d+(?:\.\d+)?$/.test(start) || !/^\d+(?:\.\d+)?$/.test(end)) return null;
  start = Number(start) * scale;
  end = Number(end) * scale;
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

export function parseLocation({ pathname = '/', search = '' } = {}) {
  const parts = pathname.split('/').filter(Boolean);
  const result = { page: 'home', dongleId: null, routeId: null, zoom: null, legacyZoom: null,
    modal: null, settingsDongleId: null, dialog: null };
  if (parts.length === 1 && ['demo', 'referrals'].includes(parts[0])) {
    result.page = parts[0];
  } else if (dongleIdRegex.test(parts[0])) {
    result.dongleId = parts[0];
    result.page = 'device';
    if (parts.length === 2 && ['prime', 'stream'].includes(parts[1])) {
      result.page = parts[1];
    } else if (logIdRegex.test(parts[1]) && [2, 4].includes(parts.length)) {
      result.page = 'drive';
      result.routeId = parts[1];
      if (parts.length === 4) result.zoom = range(parts[2], parts[3], 1000);
      if (parts.length === 4 && !result.zoom) result.page = 'invalid';
    } else if (parts.length === 3) {
      result.legacyZoom = range(parts[1], parts[2]);
      result.page = result.legacyZoom ? 'legacy' : 'invalid';
    } else if (parts.length !== 1) {
      result.page = 'invalid';
    }
  } else if (parts.length) {
    result.page = 'invalid';
  }
  if (result.page === 'invalid') {
    result.routeId = null;
    result.zoom = null;
  }
  const query = new URLSearchParams(search);
  if (['pair', 'filter', 'uploads'].includes(query.get('modal'))) result.modal = query.get('modal');
  if (query.get('modal') === 'settings' && dongleIdRegex.test(query.get('device'))) {
    result.modal = 'settings';
    result.settingsDongleId = query.get('device');
    if (dialogs.has(query.get('dialog'))) result.dialog = query.get('dialog');
  }
  return result;
}

export function devicePath(dongleId, page = 'device') {
  return dongleId ? `/${dongleId}${page === 'device' ? '' : `/${page}`}` : '/';
}

export function drivePath(dongleId, routeId, zoom) {
  const path = `${devicePath(dongleId)}/${routeId}`;
  return zoom ? `${path}/${zoom.start / 1000}/${zoom.end / 1000}` : path;
}

// Overlay navigation preserves the underlying page, unrelated query arguments,
// and hash. Closing also works when the overlay was opened from a bookmark.
export function overlayLocation(location, modal, device, dialog) {
  const query = new URLSearchParams(location.search);
  for (const key of ['modal', 'device', 'dialog']) query.delete(key);
  if (modal) query.set('modal', modal);
  if (modal === 'settings') query.set('device', device);
  if (dialog) query.set('dialog', dialog);
  const search = query.toString();
  return { ...location, search: search ? `?${search}` : '' };
}

// Compatibility accessors for consumers that only need one field.
export const getDongleID = (pathname) => parseLocation({ pathname }).dongleId;
export const getZoom = (pathname) => parseLocation({ pathname }).legacyZoom;
export const getRouteId = (pathname) => parseLocation({ pathname }).routeId;
export const getRouteZoom = (pathname) => parseLocation({ pathname }).zoom;
export const getPrimeNav = (pathname) => parseLocation({ pathname }).page === 'prime';
export const getStreamNav = (pathname) => parseLocation({ pathname }).page === 'stream';
