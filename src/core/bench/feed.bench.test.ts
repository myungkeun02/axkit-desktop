// Timing on a real recorded Mac answer (ax-kit-ios dev/capture-snapshot.mjs). The recording holds the owner's real data,
// so it lives outside the repo: `AX_SNAPSHOT=/path/snap.json npx vitest run src/core/bench`. Skipped without it.
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { decodeEvent } from '../events';
import { buildFeed } from '../roomFeed';
import { Timeline } from '../timeline';
import { cleanText } from '../chatText';
import { clayHash } from '../../ui/BotAvatar';

const path = process.env.AX_SNAPSHOT;

function ms(label: string, times: number, work: () => void) {
  const t = performance.now();
  for (let i = 0; i < times; i++) work();
  console.log(`BENCH ${label}: ${((performance.now() - t) / times).toFixed(2)} ms`);
}

it.skipIf(!path)('feed timings on a real recording', () => {
  const snap = JSON.parse(readFileSync(path!, 'utf8')) as { events: unknown[] };
  const events = snap.events.map(decodeEvent).filter((e) => e !== null);
  const t = new Timeline();
  t.applyAll(events as never);
  for (const room of ['', '개발', '팀장회의']) {
    const items = t.items(room);
    ms(`buildFeed[${room || 'main'}] ${items.length} items`, 5, () => buildFeed(items, room, { lead: null, assistant: '비서', cardDate: (id) => t.card(id)?.at }));
  }
  const texts = events.flatMap((e) => ('text' in (e as object) ? [(e as { text: string }).text] : []));
  ms(`cleanText x${texts.length}`, 3, () => texts.forEach((x) => cleanText(x)));
  ms('clayHash x200', 3, () => { for (let i = 0; i < 200; i++) clayHash('개발 봇' + (i % 14) + '#shape'); });
});
