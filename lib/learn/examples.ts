// lib/learn/examples.ts
//
// **「このサイトの実例」の選び方**（/learn の各頁・2026-11-04）。
//
// ビルド時に `photos.json`（DynamoDB から同期した本物の写真）の EXIF を読み、レッスンの条件
// （F2.8 より明るい・1/1000 秒より速い・ISO 1600 以上 …）に合う写真を選ぶ。
// 条件に合う写真が無ければ空を返す——**画面は空の枠を作らない**（呼ぶ側で塊ごと出さない）。
//
// 載せてよい写真の判定は撮影地・タグの集約頁と同じ（`published !== false`）。公開範囲を絞った写真は
// そもそも `photos.json` に載らない（同期が公開一覧だけを書く）。
//
// 保存されている EXIF の書き方は割れている（Web は "1/125s"、アプリは "1/125"・"f/2.8"・"F2.8"・
// ISO は数か "ISO 100"）。ここで数に直してから比べる。読めない値は条件に合わない扱い。

import type { Photo } from "@/lib/data/photos";
import { dedupeCameraName } from "@/lib/utils/cameraName";

export type ExampleRule = {
    id: string;
    /** 塊の見出し（例: 「F2.8 より小さい F 値で撮った写真」） */
    heading: string;
    /** 合う写真か */
    match: (s: ParsedSettings) => boolean;
    /** 並べる順（小さいほど先）。条件を強く満たす写真から見せる */
    rank: (s: ParsedSettings) => number;
};

export type ParsedSettings = {
    aperture?: number;
    shutterSeconds?: number;
    iso?: number;
    focalLength?: number;
    /** 機種（メーカー名の重なりを畳んだもの） */
    camera?: string;
};

/** "f/2.8" "F2.8" "2.8" → 2.8 */
export function parseAperture(v: unknown): number | undefined {
    if (typeof v === "number") return v > 0 ? v : undefined;
    if (typeof v !== "string") return undefined;
    const m = v.trim().match(/^(?:f\s*\/?\s*)?(\d+(?:\.\d+)?)$/i);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "1/1000s" "1/125" "30s" "0.5" "2秒" → 秒 */
export function parseShutter(v: unknown): number | undefined {
    if (typeof v === "number") return v > 0 ? v : undefined;
    if (typeof v !== "string") return undefined;
    const s = v.trim().replace(/\s*(s|sec|秒)$/i, "").trim();
    const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (frac) {
        const n = Number(frac[1]) / Number(frac[2]);
        return Number.isFinite(n) && n > 0 ? n : undefined;
    }
    const n = /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 100 "ISO 100" "100" → 100 */
export function parseIso(v: unknown): number | undefined {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(/^iso\s*/i, "")) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "28mm" "28 mm" "28" → 28 */
export function parseFocal(v: unknown): number | undefined {
    if (typeof v === "number") return v > 0 ? v : undefined;
    if (typeof v !== "string") return undefined;
    const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*(mm)?$/i);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseSettings(exif: Photo["exif"]): ParsedSettings {
    const e = (exif ?? {}) as Record<string, unknown>;
    return {
        aperture: parseAperture(e.aperture),
        shutterSeconds: parseShutter(e.exposure),
        iso: parseIso(e.iso),
        focalLength: parseFocal(e.focalLength),
        camera: dedupeCameraName(typeof e.camera === "string" ? e.camera : undefined),
    };
}

/** 実例に出してよい写真（公開・画像が在る） */
export function isExampleCandidate(p: Photo): boolean {
    return p.published !== false && !!(p.thumbSrc || p.src) && !!p.id;
}

/**
 * 条件に合う写真を、強く満たす順に最大 `limit` 枚。
 * 同じ順位は新しい写真から（`date` → `createdAt`）。何も合わなければ空。
 */
export function pickExamples(photos: Photo[], rule: ExampleRule, limit = 4): Photo[] {
    const stamp = (p: Photo) => String(p.date || p.createdAt || "");
    return photos
        .filter(isExampleCandidate)
        .map((p) => ({ p, s: parseSettings(p.exif) }))
        .filter(({ s }) => rule.match(s))
        .sort((a, b) => rule.rank(a.s) - rule.rank(b.s) || stamp(b.p).localeCompare(stamp(a.p)))
        .slice(0, limit)
        .map(({ p }) => p);
}

/** 写真の機種（メーカー名の重なりを畳んだもの）。無ければ undefined */
export function cameraOf(p: Photo): string | undefined {
    return dedupeCameraName(p.exif?.camera);
}
