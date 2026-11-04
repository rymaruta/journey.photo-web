import type { ReactNode } from "react";
import { siteConfig } from "../../lib/utils/seo";
const base = siteConfig.url;
const json = (value: object) => JSON.stringify(value).replace(/</g,"\\u003c").replace(/>/g,"\\u003e");
export default function LearnLayout({children}:{children:ReactNode}){
 const data={"@context":"https://schema.org","@type":"CollectionPage",name:"写真とカメラの教科書",url:`${base}/learn`,inLanguage:"ja-JP",isPartOf:{"@type":"WebSite",name:"Journey Photo",url:base},hasPart:[{"@type":"WebPage",url:`${base}/learn/camera-basics`,name:"カメラの使い方 完全入門"},{"@type":"WebPage",url:`${base}/learn/camera-brands`,name:"カメラメーカーの特徴を比較"}]};
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:json(data)}}/>{children}</>;
}