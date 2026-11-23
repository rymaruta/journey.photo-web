import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * **他人の写真は、その人のもの**（journey.photo-ios の CLAUDE.md・2026-11-12 owner・絶対）を、
 * 口を足しても機械で守る見張り（2026-11-23 owner「守れていた、ではなく守れるように」）。
 *
 * 名前ではなく形で探し、下の一覧（ファイルと理由）と突き合わせる。一覧に無い所が増えたら落ちる。
 * 一覧にあるのに見つからなくなった所も落ちる（古い許しを残さない）。
 *
 * 1. 頼みの本文で写真を指す欄（`photoId`・`thumbUrl`・`coverPhoto` など）を受け取る口。
 *    写真の画像を呼び手の物（ストーリー・プロフィール・旅行プラン・スタンプ帳など）に入れるなら、
 *    **持ち主かを確かめる**（`userId ?? uploadedBy` との比べ・`checkSharedPhoto` など）。
 *    人の写真を id で指すだけ（DM の引用・いいね・保存）は理由を書いて許す
 * 2. `srcOriginal`（EXIF を落とす前の原本・GPS 入り）を扱う所。返す口に足さない
 * 3. 画像を取り出す署名つき URL（`GetObjectCommand`）。原本に署名しない
 */

const SRC = join(__dirname, "..");

/** 注釈を落とす（注釈に名前を書いても引っかけない） */
function stripComments(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/(^|[^:"'`\\])\/\/.*$/, "$1"))
        .join("\n");
}

type Source = { path: string; code: string };

function load(): Source[] {
    return readdirSync(SRC)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
        .map((f) => ({ path: f, code: stripComments(readFileSync(join(SRC, f), "utf8")) }));
}

/** 頼みの本文を読む */
const READS_BODY = /event\.body|parseBody\(/;
/** 写真を指す欄 */
const PHOTO_REF = /\b\w*(photoId|PhotoId|photoIds|PhotoIds|imageUrl|ImageUrl|imageUrls|thumbUrl|ThumbUrl|photoSrc|PhotoSrc|coverPhoto|CoverPhoto|tripCovers|extraImages|sharedPhoto|cardPhoto|stampPhoto|slotPhoto)\w*\b/;
/** 持ち主かの確かめ（写真の行の持ち主と、呼び手の id を比べる） */
const OWNER_CHECK = /userId\s*\?\?\s*[\w.]*uploadedBy|ownerOf\(|isLivePhotoOf\(|checkSharedPhoto\(|isOwnUploadUrl\(|isOwnPhoto\(|photoOwner\(/;

function photoRefHandlers(sources: Source[]): string[] {
    return sources.filter((s) => READS_BODY.test(s.code) && PHOTO_REF.test(s.code)).map((s) => s.path).sort();
}

function originalUsers(sources: Source[]): string[] {
    return sources.filter((s) => /srcOriginal/.test(s.code)).map((s) => s.path).sort();
}

function signedGetters(sources: Source[]): string[] {
    return sources.filter((s) => /GetObjectCommand/.test(s.code) && /getSignedUrl/.test(s.code)).map((s) => s.path).sort();
}

/** `owner` は、その口で持ち主を確かめている呼び出し（`check`）が必ず在ること */
type Entry = { kind: "owner"; check: string; why: string } | { kind: "reference"; why: string };

/** 写真を指す欄を受け取る口 → 確かめ方 */
const PHOTO_REF_HANDLERS: Record<string, Entry> = {
    "stories.ts": { kind: "owner", check: "await checkSharedPhoto(", why: "ストーリーで写真を紹介（`sharedPhotoId`）は自分の写真だけ（`checkSharedPhoto`・人の写真は 403）" },
    "storyKeep.ts": { kind: "owner", check: "isOwnUploadUrl(body.thumbUrl, userId)", why: "自分のストーリーを写真に残す。縮小画像は自分が上げた物だけ（`isOwnUploadUrl`）" },
    "userProfile.ts": { kind: "owner", check: "!await isLivePhotoOf(pinOp.id, userId)", why: "プロフィールに留める写真は自分の公開写真だけ（`isLivePhotoOf`）" },
    "upload.ts": { kind: "owner", check: "isOwnUploadUrl(thumbUrl, userId)", why: "自分の写真を上げる（上げた物の URL だけ）" },
    "trunk.ts": { kind: "owner", check: "(row.userId ?? row.uploadedBy) === uid", why: "トランクの札は自分の公開写真だけ" },
    "albums.ts": { kind: "reference", why: "共同アルバムは写真の id を並べるだけ。写真が入るのは本人が上げた・直した自分の写真だけ（`upload.ts`・`photoUpdate.ts` の `addPhotoToAlbum`）で、本文から写真を足す口は無い" },
    "comments.ts": { kind: "reference", why: "コメントする写真の id（持ち主の写真へ連れて行くだけ）" },
    "storyAnswers.ts": { kind: "reference", why: "ストーリーの質問の答え（写真は id で指すだけ）" },
    "storyReplies.ts": { kind: "reference", why: "ストーリーへの返事（写真は id で指すだけ）" },
    "dm.ts": { kind: "reference", why: "DM で写真を引用して送る（持ち主の写真へ連れて行くだけ・見える写真だけ `readVisiblePhoto`）" },
    "report.ts": { kind: "reference", why: "写真の通報（運営へ）" },
};

/** `srcOriginal` を扱ってよいファイル（どれも外へ返さない） */
const ORIGINAL_USERS: Record<string, string> = {
    "privateFields.ts": "外に出さない項目の一覧そのもの",
    "types.ts": "行の型",
    "upload.ts": "上げた写真の行を書く（原本の在りかは返さない）",
    "photoReplace.ts": "差し替えで古い実体を消す一覧",
    "mediaKeys.ts": "消すときの一覧",
};

/** 画像を取り出す署名つき URL を作ってよいファイル（今は無い） */
const SIGNED_GETTERS: Record<string, string> = {};

describe("他人の写真の見張り（サーバー）", () => {
    const sources = load();

    it("写真を指す欄を受け取る口は一覧にある", () => {
        expect(sources.length).toBeGreaterThan(50);
        const found = photoRefHandlers(sources);
        expect(found.filter((f) => !PHOTO_REF_HANDLERS[f]),
            "写真を指す欄を受け取る口が増えた。人の写真の画像を呼び手の物に入れない（入れるなら持ち主を確かめる）ことを確かめて一覧に足す").toEqual([]);
        expect(Object.keys(PHOTO_REF_HANDLERS).filter((f) => !found.includes(f)), "一覧にあるのに見つからない").toEqual([]);
    });

    it("呼び手の物に入れる口は、持ち主かを確かめている", () => {
        for (const [path, entry] of Object.entries(PHOTO_REF_HANDLERS)) {
            if (entry.kind !== "owner") continue;
            const code = sources.find((s) => s.path === path)?.code ?? "";
            expect(OWNER_CHECK.test(code), `${path} が持ち主を確かめていない`).toBe(true);
            expect(code.includes(entry.check), `${path} の持ち主の確かめ（${entry.check}）が無くなった`).toBe(true);
        }
    });

    it("原本（srcOriginal）を扱う所は増えない", () => {
        const found = originalUsers(sources);
        expect(found.filter((f) => !ORIGINAL_USERS[f]), "原本の在りかを扱う所が増えた。返す口に載せていないか確かめて一覧に足す").toEqual([]);
        expect(Object.keys(ORIGINAL_USERS).filter((f) => !found.includes(f)), "一覧にあるのに見つからない").toEqual([]);
    });

    it("画像を取り出す署名つき URL を作らない", () => {
        const found = signedGetters(sources);
        expect(found.filter((f) => !SIGNED_GETTERS[f]), "画像を取り出す署名つき URL を作る所が増えた。原本と人の写真に署名しない").toEqual([]);
    });

    it("見張りそのものが効いている（わざと破った見本）", () => {
        const planted: Source[] = [
            { path: "tripStopPhoto.ts", code: "const b = JSON.parse(event.body ?? '{}'); const slotPhotoId = b.photoId; await put({ slotPhotoId });" },
            { path: "stampBook.ts", code: "const body = parseBody(event); const stampPhotoSrc = body.photoSrc;" },
            { path: "quiet.ts", code: "// event.body の photoId（注釈）\nconst x = 1;" },
        ];
        const stripped = planted.map((p) => ({ ...p, code: stripComments(p.code) }));
        expect(photoRefHandlers(stripped)).toEqual(["stampBook.ts", "tripStopPhoto.ts"]);
        expect(OWNER_CHECK.test(planted[0].code)).toBe(false);
        expect(OWNER_CHECK.test("if ((row.userId ?? row.uploadedBy) !== userId) return forbidden();")).toBe(true);
        expect(originalUsers([{ path: "x.ts", code: "return { url: row.srcOriginal };" }])).toEqual(["x.ts"]);
        expect(signedGetters([{ path: "y.ts", code: "await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }))" }])).toEqual(["y.ts"]);
        expect(stripComments("const u = \"https://x\"; // note")).toBe("const u = \"https://x\"; ");
    });
});
