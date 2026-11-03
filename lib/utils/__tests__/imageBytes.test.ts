import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchImageBytes } from "../imageBytes";

beforeEach(() => { vi.unstubAllGlobals(); });

describe("fetchImageBytes: iOS-style in-flight deduplication", () => {
    it("coalesces concurrent downloads of the same full-quality image, then releases the promise", async () => {
        let finish!: (value: Response) => void;
        const mockFetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
        vi.stubGlobal("fetch", mockFetch);
        const src = "/uploads/original.jpg";
        const first = fetchImageBytes(src);
        const second = fetchImageBytes(src);
        expect(first).toBe(second);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        finish(new Response(new Blob(["original-image"]), { status: 200 }));
        expect(await (await first).text()).toBe("original-image");
        await Promise.resolve();
        await fetchImageBytes(src);
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does not retain a failed download, allowing a retry", async () => {
        const mockFetch = vi.fn()
            .mockRejectedValueOnce(new Error("offline"))
            .mockResolvedValueOnce(new Response(new Blob(["recovered"]), { status: 200 }));
        vi.stubGlobal("fetch", mockFetch);
        await expect(fetchImageBytes("/uploads/retry.jpg")).rejects.toThrow("offline");
        await Promise.resolve();
        expect(await (await fetchImageBytes("/uploads/retry.jpg")).text()).toBe("recovered");
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });
});
