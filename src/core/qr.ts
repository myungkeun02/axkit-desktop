// QR codes drawn here in the app (no QR web service): the link never leaves this Mac to become a picture.
import qrcode from 'qrcode-generator';

/** The QR's dark cells, row by row (error correction M: still reads from a phone held at an angle). */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** One SVG path for all dark cells (a quiet zone of `margin` cells around), in cell units. */
export function qrPath(cells: boolean[][], margin = 4): { d: string; size: number } {
  let d = '';
  cells.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c + margin} ${r + margin}h1v1h-1z`; }));
  return { d, size: cells.length + margin * 2 };
}

// Install links for the phone apps (§ 휴대폰 앱 설치).
export const ANDROID_APK = 'https://github.com/myungkeun02/axkit-android/releases/latest/download/ax-kit.apk';
/** TestFlight itself in the App Store; ax-kit is then installed from an invite (there is no public TestFlight link). */
export const TESTFLIGHT_APP = 'https://apps.apple.com/app/testflight/id899247664';
export const phonePairCommand = (platform: 'ios' | 'android') => `ax-kit phone pair --app --platform ${platform}`;
