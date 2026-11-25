import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Session } from '../core/session';

/** Every place in the sidebar. `room` is a team, meeting or bot room; `blocks:<view>` a server-drawn screen. */
export type Section =
  | 'home' | 'approvals' | 'dashboard' | 'room' | 'browser-live'
  | 'docs' | 'calendar' | 'recordings'
  | 'autonomy' | 'routines' | 'jobs' | 'spending'
  | 'usage' | 'providers' | 'modeltiers'
  | 'hardware' | 'health' | 'settings' | 'projects' | 'team-plan' | 'help' | 'phone-apps' | 'work' | 'first-look' | 'people'
  | `blocks:${string}`;

export interface Nav {
  section: Section;
  /** The open room when `section === 'room'` (team channel, `meeting:<group>`, or an older server's bot channel). */
  room: string;
  /** The open document (문서, 녹음 › 회의록). */
  doc: string | null;
}

export interface AppCtx {
  session: Session;
  nav: Nav;
  go: (patch: Partial<Nav>) => void;
  /** Open a room ("" = the main chat). */
  openRoom: (room: string) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ value, children }: { value: AppCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The session, re-rendering whenever it changes. */
export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('no app');
  useSyncExternalStore(ctx.session.subscribe, ctx.session.getVersion);
  return ctx;
}
