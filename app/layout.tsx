import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "봉신과 스무고개",
  description: "봉신이 유리구슬로 당신의 마음을 읽습니다",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col items-center">
        <div className="w-full max-w-[480px] min-h-dvh flex flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
