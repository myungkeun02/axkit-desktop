import { useMemo } from 'react';
import { ANDROID_APK, TESTFLIGHT_APP, phonePairCommand, qrMatrix, qrPath } from '../core/qr';
import { openLink } from '../platform/tauri';
import { CardHeader, Panel } from '../ui/kit';

/** A QR drawn in the app (black on white, so it scans in dark mode too). */
export function Qr({ text, label, size = 180 }: { text: string; label: string; size?: number }) {
  const { d, size: n } = useMemo(() => qrPath(qrMatrix(text)), [text]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges"
      style={{ background: '#fff', borderRadius: 12, flex: 'none' }}>
      <path d={d} fill="#000" />
    </svg>
  );
}

function AppCard({ title, qr, qrLabel, link, steps }: { title: string; qr: string; qrLabel: string; link: string; steps: React.ReactNode }) {
  return (
    <Panel>
      <CardHeader title={title} />
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Qr text={qr} label={qrLabel} />
        <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps}
          <button className="btn plain small" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => void openLink(link)}>링크 열기</button>
          <div className="footnote selectable" style={{ wordBreak: 'break-all' }}>{link}</div>
        </div>
      </div>
    </Panel>
  );
}

/** 휴대폰 앱 설치: QR codes for the iPhone (TestFlight) and Android (APK) apps, then pairing from the Mac. */
export function PhoneApps() {
  return (
    <>
      <div className="secondary" style={{ padding: '0 4px' }}>휴대폰 카메라로 QR을 비추면 설치 페이지가 열려요.</div>
      <AppCard title="아이폰" qr={TESTFLIGHT_APP} qrLabel="아이폰: App Store의 TestFlight QR" link={TESTFLIGHT_APP} steps={<>
        <div>1. QR로 App Store에서 <b>TestFlight</b>를 받아요.</div>
        <div>2. ax-kit TestFlight <b>초대 링크</b>를 열어 ax-kit을 설치해요.</div>
        <div className="footnote">공개 링크가 아직 없어요. 초대 링크가 없으면 ax-kit을 설치해 준 분께 TestFlight 초대를 요청해 주세요.</div>
      </>} />
      <AppCard title="안드로이드" qr={ANDROID_APK} qrLabel="안드로이드: ax-kit APK 내려받기 QR" link={ANDROID_APK} steps={<>
        <div>1. QR로 <b>ax-kit.apk</b>를 내려받아요.</div>
        <div>2. 받은 파일을 열어 설치해요. '출처를 알 수 없는 앱' 허용을 물으면 허용해 주세요.</div>
      </>} />
      <Panel>
        <CardHeader title="설치한 뒤 연결" />
        <div>앱을 열고, 비서 맥에서 만든 연결 코드(QR)로 연결해요. 비서 맥의 터미널에서:</div>
        <div className="footnote selectable" style={{ marginTop: 6 }}><code>{phonePairCommand('ios')}</code> (아이폰)</div>
        <div className="footnote selectable"><code>{phonePairCommand('android')}</code> (안드로이드)</div>
        <div className="footnote" style={{ marginTop: 6 }}>코드는 10분 안에 한 번만 쓸 수 있어요.</div>
      </Panel>
    </>
  );
}
