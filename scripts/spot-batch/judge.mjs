// 機械の照合（docs/spot-batch-runbook.md の段9）。
//   SPOT_BATCH_DIR=… node scripts/spot-batch/judge.mjs out/A.json out/B.json …   → judged.json と問題の一覧
// 組のファイルを全部渡す（組の間の重なりも見るため）。ファイルを渡さないと rows 0 になる。
import fs from "node:fs";
import path from "node:path";
import { numericClaims, articleHasNumber, regionNames, placeNames, sameSubject, subjectKey } from "../check-spot-wikipedia.mjs";
const DIR = process.env.SPOT_BATCH_DIR;
if (!DIR) throw new Error("SPOT_BATCH_DIR に作業用フォルダを渡す");
const at = (f) => path.join(DIR, f);
const arts = JSON.parse(fs.readFileSync(at("articles.json"), "utf8"));
const ledger = JSON.parse(fs.readFileSync(at("ledger_base.json"), "utf8"));
const L = JSON.parse(fs.readFileSync(at("ledger_index.json"), "utf8"));
const ledgerQ = new Set(L.qids), ledgerSlugs = new Set(L.slugs);
const ledgerNames = new Set(); for (const s of ledger) { ledgerNames.add(subjectKey(s.name)); for (const a of s.aliases ?? []) ledgerNames.add(subjectKey(a)); }
const raw = JSON.parse(fs.readFileSync(at("cands_raw.json"), "utf8"));
const prefsOf = new Map(); for (const [p, items] of Object.entries(raw)) for (const it of items) { if (!prefsOf.has(it.qid)) prefsOf.set(it.qid, new Set()); prefsOf.get(it.qid).add(p); }
const files = process.argv.slice(2).map((f) => path.resolve(DIR, f));
const rows = files.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")).rows.map((r) => ({ ...r, _file: f })));
const SEASONS = new Set(["spring", "summer", "autumn", "winter"]), TIMES = new Set(["dawn", "morning", "day", "goldenHour", "dusk", "night"]);
const LATEST_TRIGGER = /閉鎖|閉館|休館|休止|運休|規制|立入禁止|立ち入り禁止|通行止め|工事|再整備|更新事業|予約|拝観|開洞|開門|閉門|開館|開園|料金|有料|定休|廃止|休園|不定期|年現在|時点|現在/; // s21_add_latest_note.py と同じ語
const DESIG = ["国宝", "重要文化財", "名勝", "天然記念物", "特別史跡", "史跡", "百選", "百景", "日本一", "最大", "最古", "最長", "最高", "唯一", "最も", "世界遺産", "日本三", "重要伝統的建造物群", "国立公園", "国定公園", "特別", "ラムサール", "ジオパーク", "随一", "屈指", "有数", "代表する", "知られ", "名所", "国指定", "県指定", "登録有形"];
const BANNED = ["撮りどき", "撮影地", "この場所", "ガイド", "捨て", "**"];
// 記事の題と名前が違うが、記事の中の呼び名と照らして同じ対象と確かめたもの
const SUBJECT_OK = new Set(JSON.parse(fs.readFileSync(at("subject_ok.json"), "utf8")));
const seenSlug = new Set(), seenQ = new Set(), seenName = new Set();
const out = [];
for (const r of rows) {
    const p = [];
    const a = arts[r.qid];
    if (!a) { p.push("記事の控えに無い qid"); out.push({ r, p }); continue; }
    const text = a.extract;
    for (const k of ["slug", "name", "nameEn", "reading", "region", "category", "summary", "description", "highlights", "seasonalGuide", "timeOfDayGuide", "compositionTips"]) if (!r[k] || (Array.isArray(r[k]) && !r[k].length)) p.push(`${k} が無い`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug ?? "")) p.push("slug の形");
    if (ledgerSlugs.has(r.slug) || seenSlug.has(r.slug)) p.push("slug が重なる"); seenSlug.add(r.slug);
    if (ledgerQ.has(r.qid) || seenQ.has(r.qid)) p.push("QID が台帳・束の中で重なる"); seenQ.add(r.qid);
    for (const n of [r.name, ...(r.aliases ?? [])]) { const k = subjectKey(n); if (ledgerNames.has(k)) p.push(`名前・別名「${n}」が台帳と同じ`); if (seenName.has(k)) p.push(`名前・別名「${n}」が束の中で重なる`); }
    for (const n of [r.name, ...(r.aliases ?? [])]) seenName.add(subjectKey(n));
    if (a.disambig) p.push("曖昧さ回避の記事");
    if (!SUBJECT_OK.has(r.slug) && !sameSubject({ name: r.name }, a.title)) p.push(`記事の題「${a.title}」と名前「${r.name}」が合わない`);
    if (r.region?.country !== "日本" || !(prefsOf.get(r.qid) ?? new Set([a.pref])).has(r.region?.prefecture)) p.push("県が候補と違う");
    if (!regionNames(r.region).some((n) => text.includes(n))) p.push("記事に県名が無い");
    const cities = placeNames(r.region?.city); if (cities.length && !cities.some((n) => text.includes(n))) p.push(`記事に市町村「${r.region?.city}」が無い`);
    if ((r.summary ?? "").length < 40) p.push(`紹介文が40字未満(${(r.summary ?? "").length})`);
    if ((r.description ?? "").length < 60) p.push(`説明が60字未満(${(r.description ?? "").length})`);
    const sg = r.seasonalGuide ?? [], tg = r.timeOfDayGuide ?? [];
    if (sg.length < 2) p.push("季節の案内が2つ未満"); if (tg.length < 2) p.push("時間帯の案内が2つ未満");
    for (const g of sg) { if (!SEASONS.has(g.season)) p.push(`季節の値 ${g.season}`); if ((g.text ?? "").length < 12) p.push(`季節の案内が12字未満: ${g.text}`); }
    for (const g of tg) { if (!TIMES.has(g.time)) p.push(`時間帯の値 ${g.time}`); if ((g.text ?? "").length < 12) p.push(`時間帯の案内が12字未満: ${g.text}`); }
    if (new Set(sg.map((g) => g.season)).size !== sg.length) p.push("季節が重なる");
    if (new Set(tg.map((g) => g.time)).size !== tg.length) p.push("時間帯が重なる");
    const all = [r.summary, r.description, ...(r.highlights ?? []), ...sg.map((g) => g.text), ...tg.map((g) => g.text), ...(r.compositionTips ?? [])].filter(Boolean).join("\n");
    for (const c of numericClaims(all)) if (!articleHasNumber(text, c)) p.push(`数「${c.raw}」が記事に無い`);
    for (const w of DESIG) if (all.includes(w) && !text.includes(w)) p.push(`語「${w}」が記事に無い`);
    for (const w of BANNED) if (all.includes(w)) p.push(`使わない語「${w}」`);
    // 時期で変わる情報（閉鎖・休止・拝観・工事・予約・料金・開館時間・「〇年現在」など）がある行は、説明の末尾に「※最新の情報は〇〇でご確認ください。」を付ける（2026-11-13 owner）
    if (LATEST_TRIGGER.test(all) && !(r.description ?? "").includes("※最新の情報は")) p.push("最新の情報の注記が無い（説明の末尾に「※最新の情報は〇〇でご確認ください。」）");
    if (/[A-Za-z]/.test(all)) p.push("本文に英字");
    if (r.officialWebsiteUrl && !/^https:\/\//.test(r.officialWebsiteUrl)) p.push("公式サイトが https でない");
    out.push({ r, p });
}
fs.writeFileSync(at("judged.json"), JSON.stringify(out, null, 1));
const bad = out.filter((x) => x.p.length);
console.log(`rows ${out.length}・問題あり ${bad.length}`);
for (const x of bad) console.log(`${path.basename(x.r._file)} ${x.r.slug} (${x.r.qid}): ${x.p.join(" / ")}`);
