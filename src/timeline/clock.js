// The media element owns time while a video is mounted. Keeping its reader here
// lets animation-frame consumers (map, thumbnails, clock) follow every frame
// without putting a DOM node in Redux or dispatching a render for every frame.
let clock = null;

export function attachVideoClock(route, read) {
  const owner = { route, read };
  clock = owner;
  return () => { if (clock === owner) clock = null; };
}

export function readVideoClock(state) {
  if (!clock || clock.route !== state.currentRoute?.fullname) return null;
  const sample = clock.read();
  // Display a pending user seek immediately, until the element has applied it.
  return sample && sample.revision === (state.seekRevision || 0) && Number.isFinite(sample.offset)
    ? sample.offset : null;
}
