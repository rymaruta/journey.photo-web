import type { ReactNode } from "react";
import { siteConfig } from "../../../lib/utils/seo";
export default function ArticleLayout({children}:{children:ReactNode}){
 const url=`${siteConfig.url}/learn/camera-basics`;
 const data={"@context":"https://schema.org","@type":"Article",headline:"カメラの使い方 完全入門",description:"F値、シャッタースピード、ISO感度、ピント、ホワイトバランスを初心者向けに解説",inLanguage:"ja-JP",mainEntityOfPage:url,author:{"@type":"Organization",name:"Journey Photo",url:siteConfig.url},publisher:{"@type":"Organization",name:"Journey Photo",url:siteConfig.url},datePublished:"2026-11-04",dateModified:"2026-11-04"};
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(data).replace(/</g,"\\u003c")}}/>{children}</>;
}