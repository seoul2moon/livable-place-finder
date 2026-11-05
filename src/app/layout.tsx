import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "살기 좋은 곳 찾기",
  description: "가격과 상관없이, 내 생활방식에 맞는 동네를 찾아보세요",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a className="skip" href="#main-content">본문으로 건너뛰기</a>
        <header className="top"><Link href="/">살기 좋은 곳 찾기</Link></header>
        <div className="wrap" id="main-content">{children}</div>
      </body>
    </html>
  );
}
