import { useCallback, useState } from 'react';

// 짧게 보기 per room: off by default in team, bot and meeting rooms (the whole conversation, in order), on in the
// assistant's own chat (work logs folded as before). Kept in this Mac's local storage.
const KEY = (room: string) => `short-view:${room || 'main'}`;

export function readShort(room: string): boolean {
  try {
    const v = localStorage.getItem(KEY(room));
    return v === null ? room === '' : v === '1';
  } catch { return room === ''; }
}

export function useShortView(room: string): [boolean, (on: boolean) => void] {
  const [state, setState] = useState(() => ({ room, on: readShort(room) }));
  const on = state.room === room ? state.on : readShort(room);
  const set = useCallback((next: boolean) => {
    try { localStorage.setItem(KEY(room), next ? '1' : '0'); } catch { /* blocked */ }
    setState({ room, on: next });
  }, [room]);
  return [on, set];
}
