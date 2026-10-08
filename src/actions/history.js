import { LOCATION_CHANGE, replace } from 'connected-react-router';
import { parseLocation, drivePath } from '../url';
import { checkRoutesData, checkLastRoutesData, primeNav, streamNav, selectDevice, pushTimelineRange } from './index';
import { api } from '../api/backend';

const sameRange = (a, b) => a?.start === b?.start && a?.end === b?.end;

export const onHistoryMiddleware = ({ dispatch, getState }) => {
  let navigation = 0;
  return (next) => (action) => {
    if (!action) return;
    const result = next(action); // Record the URL before applying it.
    if (action.type !== LOCATION_CHANGE) return result;

    navigation += 1;
    const revision = navigation;
    const location = action.payload.location;
    const path = parseLocation(location);
    let state = getState();
    const deviceChanged = path.dongleId && path.dongleId !== state.dongleId;
    if (deviceChanged) {
      dispatch(selectDevice(path.dongleId, false, false));
      state = getState();
    }

    const route = state.routes?.find((candidate) => candidate.log_id === path.routeId);
    const zoom = path.zoom || (route ? { start: 0, end: route.duration } : null);
    const routeChanged = path.routeId !== state.selectedRouteId;
    if (routeChanged || !sameRange(zoom, state.zoom)) {
      dispatch(pushTimelineRange(path.routeId, path.zoom?.start ?? null, path.zoom?.end ?? null, false));
    }
    if ((path.page === 'prime') !== state.primeNav) dispatch(primeNav(path.page === 'prime', false));
    if ((path.page === 'stream') !== state.streamNav) dispatch(streamNav(path.page === 'stream', false));
    if (deviceChanged) dispatch(checkLastRoutesData());
    else if (routeChanged && path.routeId) dispatch(checkRoutesData());

    if (path.legacyZoom) {
      // A slow lookup must never replace newer navigation. Retain share args.
      api.routes.getRoutesSegments(path.dongleId, path.legacyZoom.start, path.legacyZoom.end)
        .then((routes) => {
          if (revision !== navigation || !routes?.length) return;
          dispatch(replace({ ...location, pathname: drivePath(path.dongleId, routes[0].fullname.split('|')[1]) }));
        }).catch((err) => console.error('Error fetching routes data for log ID conversion', err));
    }
    return result;
  };
};
