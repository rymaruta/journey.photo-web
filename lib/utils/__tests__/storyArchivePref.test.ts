import { describe, it, expect, beforeEach } from "vitest";
import {
    readStoryArchive, writeStoryArchive, removeStoryArchiveUserData, STORY_ARCHIVE_DEFAULT,
} from "../storyArchivePref";

// ストーリーの「アーカイブに自動保存」の覚え（2026-11-11 判断・iOS の `StoryArchivePreference` とそろえる）
describe("storyArchivePref", () => {
    beforeEach(() => localStorage.clear());

    it("覚えが無い人・ログインしていないときは入", () => {
        expect(STORY_ARCHIVE_DEFAULT).toBe(true);
        expect(readStoryArchive("a")).toBe(true);
        expect(readStoryArchive(null)).toBe(true);
        expect(readStoryArchive(undefined)).toBe(true);
    });

    it("最後に選んだ値を人ごとに覚える", () => {
        writeStoryArchive("a", false);
        expect(readStoryArchive("a")).toBe(false);
        expect(readStoryArchive("b")).toBe(true);
        writeStoryArchive("a", true);
        expect(readStoryArchive("a")).toBe(true);
    });

    it("持ち主が分からない操作は書かない", () => {
        writeStoryArchive(null, false);
        expect(localStorage.length).toBe(0);
    });

    it("退会したら消す（別の人の値は残る）", () => {
        writeStoryArchive("gone", false);
        writeStoryArchive("stays", false);
        removeStoryArchiveUserData("gone");
        expect(localStorage.getItem("jp_story_archive:gone")).toBeNull();
        expect(readStoryArchive("stays")).toBe(false);
    });

    it("読めない値は入", () => {
        localStorage.setItem("jp_story_archive:a", "garbage");
        expect(readStoryArchive("a")).toBe(true);
    });
});
