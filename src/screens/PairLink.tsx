import { useEffect, useState } from 'react';
import { useApp } from '../app/context';
import { onPairLink, takePairLink, type OpenedPairLink } from '../platform/tauri';
import { Button, Icon, Sheet, Spinner } from '../ui/kit';

type Step = { kind: 'ask' } | { kind: 'pairing' } | { kind: 'done'; host: string } | { kind: 'failed'; why: string };

/** `open 'axkit://pair?…'` (the install script, or a click): pair right away like "링크로 연결". When the app already
 *  talks to a working Mac, ask once before switching, so a stray link can never move the owner's assistant. */
export function PairLinkSheet() {
  const { session, go } = useApp();
  const [link, setLink] = useState<OpenedPairLink | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'ask' });

  const pair = async (l: OpenedPairLink) => {
    setStep({ kind: 'pairing' });
    try {
      await session.pairRemote({ link: l.link });
      setStep({ kind: 'done', host: session.info?.host ?? l.host });
    } catch (e) {
      setStep({ kind: 'failed', why: e instanceof Error ? e.message : String(e) });
    }
  };

  const take = async (l: OpenedPairLink | null) => {
    if (!l) return;
    setLink(l);
    if (l.problem) { setStep({ kind: 'failed', why: l.problem }); return; }
    setStep({ kind: 'pairing' });
    // At a cold start the link comes before the app knows what it is connected to: wait for that (a few seconds).
    for (let i = 0; i < 50 && (!session.info || session.connection === 'connecting'); i++) await new Promise((r) => setTimeout(r, 200));
    const working = !!session.info?.connected && session.connection !== 'none';
    if (working) setStep({ kind: 'ask' });
    else void pair(l);
  };

  useEffect(() => {
    void takePairLink().then((l) => void take(l));
    const off = onPairLink((l) => void take(l));
    return () => { void off.then((f) => f()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!link) return null;
  const close = () => { if (step.kind !== 'pairing') setLink(null); };
  const current = session.info?.mode === 'remote' ? session.info.host ?? '다른 맥' : session.info?.mode === 'mock' ? '가짜 맥' : '이 맥의 ax-kit';

  return (
    <Sheet title="비서 연결" onClose={close}>
      <div className="pair-link-sheet">
        {step.kind === 'ask' && (
          <>
            <div className="pair-link-title">이 맥의 비서를 {link.host}로 바꿀까요?</div>
            <div className="secondary">지금은 {current}에 연결돼 있어요. 바꾸면 대화와 결재가 {link.host}의 비서 것으로 바뀌어요. 모르는 링크라면 그대로 두세요.</div>
            <div className="pair-link-actions">
              <Button kind="secondary" onClick={close}>그대로 두기</Button>
              <Button kind="primary" onClick={() => void pair(link)}>바꾸기</Button>
            </div>
          </>
        )}
        {step.kind === 'pairing' && (
          <div className="pair-link-center"><Spinner /><div>{link.host}의 비서와 짝을 맞추는 중이에요…</div></div>
        )}
        {step.kind === 'done' && (
          <div className="pair-link-center">
            <span className="pair-link-ok"><Icon.check /></span>
            <div className="pair-link-title">연결됐어요</div>
            <div className="secondary">이제 이 맥에서 {step.host}의 비서와 이야기할 수 있어요.</div>
            <Button kind="primary" onClick={() => { setLink(null); go({ section: 'home' }); }}>시작하기</Button>
          </div>
        )}
        {step.kind === 'failed' && (
          <>
            <div className="pair-link-title">링크로 연결하지 못했어요</div>
            <div className="secondary" role="alert">{step.why}</div>
            <div className="secondary">링크는 한 번만 쓸 수 있고 몇 분 뒤에 끝나요. 비서가 있는 맥에서 새 링크를 만들어 주세요.</div>
            <div className="pair-link-actions">
              <Button kind="secondary" onClick={() => { setLink(null); go({ section: 'settings' }); }}>설정에서 직접 연결</Button>
              <Button kind="primary" onClick={close}>닫기</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
