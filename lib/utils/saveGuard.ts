// 写真・動画を「名前を付けて保存」・ドラッグで落とさせない判定（`DisableSave` が使う）。
//
// **URL の形では選ばない。** 利用者の写真は同じオリジンの `/uploads/…`・CDN・
// 署名つきの CloudFront・下書きの `blob:` と形がいくつもあり、URL の一覧で選ぶと
// 新しい形が増えたとき黙って抜ける。画像と動画は全部止め、どうしても保存させたい
// 所だけ `data-allow-save` の中に置く（今は無い）。
//
// 止めるのは画像・動画そのものの上だけ。文字・入力欄・リンクの文字の右クリック
// （コピー・貼り付け・新しいタブで開く）は今までどおり。

const MEDIA_TAGS = new Set(["IMG", "VIDEO", "PICTURE", "SOURCE"]);

export function blocksSave(target: EventTarget | null): boolean {
    if (!target || typeof (target as Element).tagName !== "string") return false;
    const el = target as Element;
    if (!MEDIA_TAGS.has(el.tagName.toUpperCase())) return false;
    return !el.closest("[data-allow-save]");
}
