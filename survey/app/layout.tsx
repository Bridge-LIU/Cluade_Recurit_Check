import './globals.css';
import { ReactNode } from 'react';

export const metadata = {
  title: '面接前事前アンケート',
  description: 'Clarus survey',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
