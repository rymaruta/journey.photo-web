// lib/utils/reloadPage.ts
//
// 頁を読み直す1か所（試験で差し替えられるように分けた。jsdom の `location.reload` は差し替えられない）
export function reloadPage(): void {
    window.location.reload();
}
