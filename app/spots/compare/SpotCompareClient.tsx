"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Entry = {
  id: string; slug: string; name: string; region: string; category: string; summary: string;
  seasons: { season: string; text: string }[];
  times: { time: string; text: string }[];
  access: string;
};

export default function SpotCompareClient({ spots }: { spots: Entry[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ja");
    return spots.filter((s) => [s.name, s.region, s.category].join(" ").toLocaleLowerCase("ja").includes(q)).slice(0, 80);
  }, [spots, query]);
  const compared = selected.map((id) => spots.find((s) => s.id === id)).filter((s): s is Entry => Boolean(s));
  function toggle(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 3 ? [...prev, id] : prev);
  }
  return (
    <main className="mx-auto max-w-6xl min-h-screen p-4 sm:p-8 text-white">
      <Link href="/spots" className="inline-flex min-h-11 items-center text-white/70 hover:text-white">← 撮影スポットをさがす</Link>
      <h1 className="mt-4 text-3xl font-bold">撮影スポットを比較</h1>
      <p className="mt-3 text-white/70">確認済みのスポットを最大3件選んで、撮影条件を横並びで比較できます。情報が未登録の項目は「情報なし」と表示します。</p>
      <label htmlFor="compare-search" className="mt-8 block text-sm font-semibold">スポットを検索</label>
      <input id="compare-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="スポット名・地域・カテゴリ" className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 p-3 text-white placeholder:text-white/50" />
      <p className="mt-2 text-sm text-white/60" aria-live="polite">{selected.length}/3件を選択中</p>
      <div className="mt-3 grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3" aria-label="比較するスポット">
        {filtered.map((spot) => {
          const checked = selected.includes(spot.id);
          return <label key={spot.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-white/20 p-3 hover:bg-white/10">
            <input type="checkbox" checked={checked} disabled={!checked && selected.length >= 3}
              onChange={() => toggle(spot.id)} className="h-4 w-4" />
            <span><span className="block font-semibold">{spot.name}</span><span className="block text-xs text-white/60">{spot.region}</span></span>
          </label>;
        })}
        {filtered.length === 0 && <p className="text-white/70">該当する確認済みスポットがありません。</p>}
      </div>
      {compared.length > 0 && <button type="button" onClick={() => setSelected([])}
        className="mt-4 min-h-11 rounded-lg border border-white/30 px-4 hover:bg-white/10">選択を解除</button>}
      <section aria-label="比較結果" className="mt-10">
        <h2 className="text-2xl font-semibold">比較結果</h2>
        {compared.length < 2 ? <p className="mt-3 text-white/70">比較するスポットを2件以上選択してください。</p> :
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead><tr><th scope="col" className="border-b border-white/20 p-3">項目</th>
                {compared.map((s) => <th scope="col" key={s.id} className="border-b border-white/20 p-3"><Link className="underline underline-offset-4" href={`/spots/${s.slug}`}>{s.name}</Link></th>)}</tr></thead>
              <tbody>{([
                ["地域", (s: Entry) => s.region],
                ["カテゴリ", (s: Entry) => s.category],
                ["概要", (s: Entry) => s.summary],
                ["季節の特徴", (s: Entry) => s.seasons.map((x) => `${x.season}: ${x.text}`).join("\n")],
                ["時間帯の特徴", (s: Entry) => s.times.map((x) => `${x.time}: ${x.text}`).join("\n")],
                ["アクセス", (s: Entry) => s.access],
              ] as [string, (s: Entry) => string][]).map(([label, read]) =>
                <tr key={label}><th scope="row" className="border-b border-white/15 p-3 align-top font-semibold">{label}</th>
                  {compared.map((s) => <td key={s.id} className="whitespace-pre-line border-b border-white/15 p-3 align-top leading-relaxed">{read(s) || "情報なし"}</td>)}</tr>)}</tbody>
            </table>
          </div>}
      </section>
    </main>
  );
}
