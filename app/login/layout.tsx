import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";
import { loadAllPhotos } from "../../lib/server/photos";

export const metadata: Metadata = appPageMetadata("/login", "ログイン");

/**
 * iOS SignInView に合わせ、公開写真のサムネイルだけをログイン背景に並べる。
 * 非公開・センシティブな写真を HTML に混ぜない。失敗時は黒背景のまま。
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
    const photos = await loadAllPhotos().catch(() => []);
    const tiles = photos
        .filter((p) => p.published === true && !p.sensitive && Boolean(p.thumbSm || p.thumbSrc))
        .slice(0, 12);

    return (
        <div className="relative isolate min-h-screen overflow-hidden bg-black">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[380px] overflow-hidden" aria-hidden="true">
                <div className="absolute -inset-x-5 -top-8 grid grid-cols-4 gap-[3px] -rotate-[4deg]">
                    {Array.from({ length: 12 }, (_, index) => (
                        <div key={index} className="aspect-square overflow-hidden bg-white/[0.06]">
                            {tiles[index] && (
                                // Decorative images: intentionally small public thumbnails, not originals.
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={tiles[index].thumbSm || tiles[index].thumbSrc}
                                    alt=""
                                    loading={index < 4 ? "eager" : "lazy"}
                                    decoding="async"
                                    className="h-full w-full object-cover"
                                />
                            )}
                        </div>
                    ))}
                </div>
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/40 to-black" />
            </div>
            <div className="relative z-10">{children}</div>
        </div>
    );
}
