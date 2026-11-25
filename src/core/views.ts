// `GET views/<name>` payloads (APP-PROTOCOL.md §5, §7, §8, §9 and the iOS app's PROTOCOL-REQUESTS.md).
// Optional fields are ones a screen can live without, so a smaller or newer server still works.

export interface TodayView {
  date: string;
  events: { title: string; start: string; end?: string; allDay?: boolean; /** §36 */ calendar?: string; account?: string }[] | null;
  todos: { text: string; due?: string; source?: string }[] | null;
  pendingCards?: number;
  replies?: { from: string; text: string; source?: string; at?: string }[] | null;
  spend?: { amount: number; count: number };
}

export type Tier = 'S' | 'A' | 'B' | 'C';
export type Rank = 'lead' | 'staff' | 'reviewer';
export interface Bot {
  id: string; name: string; role?: string; channel: string; status?: string; statusText?: string; isNew?: boolean; avatar?: string;
  /** R16 */ rank?: Rank; team?: string; tier?: Tier;
  /** Which AI it runs on, e.g. "Claude Opus · Claude Code 구독" (server d219cb3; older servers send none). */
  model?: string;
  /** §16: how this bot works (role prompt, ≤1500 chars) and who wrote it last. */
  instructions?: string; instructionsBy?: 'default' | 'ai' | 'owner';
}
/** R16: 1 lead + staff + reviewers, one room (`channel`). */
export interface Team {
  id: string; name: string; purpose?: string; channel: string; kind?: 'dev' | 'general'; members: string[];
  decidedBy?: 'owner' | 'ai'; reason?: string; isNew?: boolean;
}
export interface BotGroup { id: string; label: string; summary?: string; bots: Bot[]; teams?: Team[]; /** R17 */ meetingChannel?: string }
export interface BotsView { main?: { name: string; subtitle?: string }; groups: BotGroup[] }
export const allBots = (b: BotsView | null | undefined) => (b?.groups ?? []).flatMap((g) => g.bots ?? []);
/** The bot whose own room this is (older servers: one bot per room), or the team lead of a team room. */
export const botFor = (b: BotsView | null | undefined, channel: string) =>
  allBots(b).find((x) => x.channel === channel && (x.rank === undefined || x.rank === 'lead')) ?? allBots(b).find((x) => x.channel === channel);
export const allTeams = (b: BotsView | null | undefined) => (b?.groups ?? []).flatMap((g) => (g.teams ?? []).map((t) => ({ ...t, group: g })));
export const teamFor = (b: BotsView | null | undefined, channel: string) => allTeams(b).find((t) => t.channel === channel);
export const groupForMeeting = (b: BotsView | null | undefined, channel: string) => (b?.groups ?? []).find((g) => g.meetingChannel === channel);
export const teamMembers = (b: BotsView | null | undefined, team: Team) => {
  const bots = allBots(b);
  const order: Record<string, number> = { lead: 0, staff: 1, reviewer: 2 };
  return team.members.map((id) => bots.find((x) => x.id === id)).filter((x): x is Bot => !!x).sort((x, y) => (order[x.rank ?? 'staff'] ?? 1) - (order[y.rank ?? 'staff'] ?? 1));
};
/** A company's meeting room shows only when it has more than one team (R17). */
export const showsMeeting = (g: BotGroup) =>
  !!g.meetingChannel && ((g.teams?.length ?? 0) > 1 || (!g.teams?.length && (g.bots?.length ?? 0) > 1));

/** ax-hq `channels` view (§7.2): every room, including company rooms like 결재·브리핑·장애·로그. */
export interface Channel { id: string; label: string; kind?: string; group?: string; writable?: boolean; lastSeq?: number; count?: number }
export const channelsOf = (raw: unknown): Channel[] => {
  const list = (raw as { channels?: unknown })?.channels;
  return Array.isArray(list) ? (list as Channel[]).filter((c) => typeof c?.id === 'string' && typeof c?.label === 'string') : [];
};
export const RANK_LABEL: Record<Rank, string> = { lead: '팀장', staff: '직원', reviewer: '검수' };
export const TIERS: Tier[] = ['S', 'A', 'B', 'C'];

export interface DocLayer { id: string; label: string; summary?: string }
export interface DocNode { id: string; title: string; layer: string; group?: string; summary?: string; updatedAt?: string; weight?: number }
export interface DocLink { from: string; to: string; label?: string }
export interface DocGraphView { layers: DocLayer[]; nodes: DocNode[]; links: DocLink[] }
export interface DocumentDetail { id: string; title: string; layer?: string; markdown: string; updatedAt?: string; related?: { id: string; title: string }[] }

export interface CalendarEvent { id: string; title: string; start: string; end?: string; allDay?: boolean; place?: string; /** §36 */ calendar?: string; account?: string; /** D7 */ geo?: { lat: number; lng: number; address?: string } }
export interface CalendarDone { id: string; title: string; at: string; bot?: { id: string; name: string }; detail?: string }
export interface CalendarDay { date: string; events: CalendarEvent[]; done: CalendarDone[] }
export interface CalendarView { month: string; timezone?: string; days: CalendarDay[]; /** §36 */ calendars?: unknown; calendarsLimited?: boolean }

export interface Job {
  id: string; name: string; detail?: string; scheduleLabel?: string; enabled: boolean; running?: boolean;
  lastRun?: { startedAt?: string; ok?: boolean; error?: string } | null; nextRunAt?: string | null; source?: string; toggleable?: boolean;
}
export interface JobsView { groups: { id: string; label: string; jobs: Job[] }[] }
export const canToggle = (j: Job) => j.toggleable ?? (j.source === undefined || j.source === 'ax');

export interface SpendEntry { id: string; at?: string; date: string; merchant: string; amount: number; category?: string; categoryLabel?: string; note?: string; source?: string }
export interface SpendingView {
  month: string; currency: string; total: number; count: number;
  byCategory: { category: string; label: string; amount: number; count: number }[];
  previousTotal?: number; budget?: number | null; entries?: SpendEntry[];
  /** The latest few (the whole month is in `entries`). */ recent?: { at?: string; merchant: string; amount: number; category?: string }[];
  categories?: { id: string; label: string }[];
  subscriptions?: { key: string; merchant: string; cadence: string; amount: number; nextDate?: string }[] | null;
}

export interface UsageRow { calls: number; failures?: number; costUsd: number }
export interface UsageView {
  period: string;
  totals: { calls: number; failures: number; costUsd: number; inputTokens?: number; outputTokens?: number };
  byModel: (UsageRow & { providerId: string; model: string })[];
  byPurpose?: (UsageRow & { purpose: string })[];
  byBot?: (UsageRow & { botId: string; name: string })[];
  daily?: { date: string; calls: number; failures?: number; costUsd: number }[];
  budget?: { dailyUsd: number; monthlyUsd: number } | null;
}

export interface Provider { id: string; label: string; kind: string; connected: boolean; status?: string; detail?: string; keyHint?: string; help?: string; models?: string[] }
export interface ProvidersView { providers: Provider[] }

export interface Meter { used: number; total: number; unit: string }
export interface HardwareView {
  checkedAt?: string; machine: { name: string; model?: string; os?: string; uptimeSec?: number };
  cpuPercent?: number; memory?: Meter; disk?: Meter; thermal?: string; power?: string;
  network?: Record<string, string>; server?: Record<string, string>; summary?: string;
}

export interface BlockRow { title: string; detail?: string; trailing?: string; message?: string; /** §38: opens the same screen with this query (like a folder) */ query?: unknown }
export interface Block { kind: string; title?: string; text?: string; value?: string; rows?: BlockRow[]; message?: string }

/** §34: a blocks row with a `message` can be pressed; it says that sentence in chat (like an `ask` block). */
export function rowMessage(row: BlockRow): string | undefined {
  const m = typeof row.message === 'string' ? row.message.trim() : '';
  return m ? m : undefined;
}
/**
 * §38: a row's `query` as the view's query string values (strings, numbers and booleans; anything else dropped),
 * or undefined when the row has none. `{}` is the first screen.
 */
export function rowQuery(row: BlockRow): Record<string, string> | undefined {
  const q = row.query;
  if (!q || typeof q !== 'object' || Array.isArray(q)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}
export interface BlocksView { title: string; blocks: Block[] }

export interface AutonomyView { rules: { id: string; label: string; detail?: string; since?: string; uses?: number }[]; alwaysAsk?: string[] }

export interface TierModel { id: string; label: string; provider: string; note?: string; available?: boolean }
export interface ModelTiersView {
  tiers: { id: string; label: string; summary?: string; models: TierModel[] }[];
  purposes: { id: string; label: string; detail?: string; tier: string; calls7d?: number }[];
}

export interface Recording {
  id: string; title?: string; startedAt?: string; durationSec?: number;
  status: 'receiving' | 'transcribing' | 'summarizing' | 'done' | 'failed' | string;
  statusText?: string; documentId?: string; driveUrl?: string;
}
export interface RecordingsView { recordings: Recording[] }

/** §17 routines: things the assistant (or a bot) does on a schedule. New ones only through chat. */
export interface Routine {
  id: string; title: string; instruction: string; scheduleLabel: string;
  schedule?: { kind: 'daily' | 'weekly' | 'every'; at?: string; day?: string; hours?: number };
  bot?: { id: string; name: string }; enabled: boolean; createdAt?: string;
  lastRun?: string; lastResult?: string; lastOk?: boolean;
}
export interface RoutinesView { routines: Routine[]; followUps: { bot: { id: string; name: string }; what: string; dueAt: string }[]; limit?: number }

/** "B · Claude Sonnet 5.5 · Claude", or just the tier letter, or '' — for tooltips and member lines. */
export const modelLine = (b: Pick<Bot, 'tier' | 'model'>) => [b.tier ? `등급 ${b.tier}` : '', b.model?.trim() ?? ''].filter(Boolean).join(' · ');

/** The models a team runs on, fewest words: one name when they all share it, else each once. */
export function teamModels(members: Pick<Bot, 'model'>[]): string {
  const names = [...new Set(members.map((m) => m.model?.trim()).filter((x): x is string => !!x))];
  return names.length <= 2 ? names.join(' / ') : `${names.slice(0, 2).join(' / ')} 외 ${names.length - 2}`;
}
