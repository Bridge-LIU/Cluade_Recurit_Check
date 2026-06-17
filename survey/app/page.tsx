export const metadata = {
  title: 'Bridge 事前アンケート',
};

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-xl w-full text-center space-y-6">
        <h1 className="text-2xl font-semibold">Bridge 事前アンケート</h1>
        <p className="text-base leading-relaxed text-[#1a1f2e]/80">
          本サイトは面接前にお送りする事前アンケートの回答ページです。
          <br />
          ご回答には採用担当よりお送りした専用リンクが必要です。
        </p>
        <p className="text-sm text-[#1a1f2e]/60">
          リンクが届いていない、または有効期限が切れた場合は、採用担当までお問い合わせください。
        </p>
      </div>
    </main>
  );
}
