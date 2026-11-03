"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import UserAvatar from "../UserAvatar";
import { useAuth } from "../../auth/context";
import { userFetch } from "../../../lib/utils/api";
import { groupStories, hasUnseen, loadSeenStoryIds, markStorySeen, type Story, type StoryGroup } from "../../../lib/stories";
import { RING_UNSEEN, RING_SEEN } from "./ring";
import { ROUTES } from "../../../lib/routes";

const StoryViewer = dynamic(() => import("./StoryViewer"), { ssr: false });

/** iOS StoryAvatar: ストーリーのある人だけ顔から閲覧。ない場合はプロフィールへのリンク。 */
export default function StoryAuthorAvatar({ userId, name, locale }: {
    userId: string; name: string; locale: "ja" | "en";
}) {
    const { isAuthenticated, userId: ownUserId } = useAuth();
    const [groups, setGroups] = useState<StoryGroup[]>([]);
    const [seen, setSeen] = useState<Set<string>>(() => new Set());
    const [open, setOpen] = useState(false);
    const [loadedFor, setLoadedFor] = useState<string | null>(null);
    const requestKey = `${ownUserId ?? ""}:${userId}`;
    useEffect(() => {
        // Switching the photographer or account must not reopen a previously viewed story.
        setOpen(false);
        setLoadedFor(null);
        if (!isAuthenticated || !userId) return;
        let cancelled = false;
        setSeen(loadSeenStoryIds());
        void userFetch("/stories").then(async response => {
            if (!response.ok) return;
            const data: unknown = await response.json();
            if (!cancelled && Array.isArray(data)) {
                setGroups(groupStories(data as Story[], ownUserId ?? undefined));
                setLoadedFor(requestKey);
            }
        }).catch(() => { /* ストーリーが取得できなくてもプロフィールは開ける */ });
        return () => { cancelled = true; };
    }, [isAuthenticated, ownUserId, userId, requestKey]);

    const groupIndex = isAuthenticated && loadedFor === requestKey ? groups.findIndex(group => group.userId === userId) : -1;
    const group = groupIndex >= 0 ? groups[groupIndex] : undefined;
    const unseen = group ? hasUnseen(group, seen) : false;
    const face = <UserAvatar userId={userId} className="w-10 h-10" iconClassName="w-6 h-6" />;
    const label = locale === "en" ? `${name}'s stories` : `${name} のストーリー`;
    return (
        <>
            {group ? (
                <button type="button" onClick={() => setOpen(true)}
                    aria-label={label} data-testid="photo-author-story-ring"
                    className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    style={{ touchAction: "manipulation" }}>
                    <span aria-hidden="true" className="absolute inset-[2px] rounded-full"
                        style={{ background: unseen ? RING_UNSEEN : RING_SEEN }} />
                    <span className="relative rounded-full bg-black p-[3px]">{face}</span>
                </button>
            ) : (
                <Link href={ROUTES.USER_PROFILE(userId)} prefetch={false}
                    aria-label={locale === "en" ? `${name}'s profile` : `${name} のプロフィール`}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
                    {face}
                </Link>
            )}
            {open && groupIndex >= 0 && (
                <StoryViewer groups={groups} initialGroupIndex={groupIndex} locale={locale}
                    ownUserId={ownUserId} isAuthenticated={isAuthenticated}
                    onSeen={id => { markStorySeen(id); setSeen(loadSeenStoryIds()); }}
                    onClose={() => setOpen(false)} />
            )}
        </>
    );
}
