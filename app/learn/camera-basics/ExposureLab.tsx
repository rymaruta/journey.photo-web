"use client";
import { useState } from "react";
const apertures=[1.8,2.8,4,5.6,8,11,16];
const speeds=[30,60,125,250,500,1000];
export default function ExposureLab(){
 const [ap,setAp]=useState(3),[sh,setSh]=useState(2),[iso,setIso]=useState(100);
 const f=apertures[ap],speed=speeds[sh];
 const stops=2*Math.log2(4/f)+Math.log2(125/speed)+Math.log2(iso/100);
 const brightness=Math.max(0.3,Math.min(1.65,1+stops*.13));
 return <section aria-label="露出設定を試すシミュレーター" className="academy-lab">
 <p className="academy-kicker">INTERACTIVE LESSON</p><h2>数字を動かして、写真の変化を体感</h2>
 <p className="academy-note">イラストによる概念図です。実写・実機の露出やぼけを正確に再現するものではありません。</p>
 <div className="academy-lab-scene" role="img" aria-label={`F${f}、シャッター1/${speed}秒、ISO${iso}。背景のぼけと明るさの変化を表す概念図`} style={{filter:`brightness(${brightness})`}}>
  <div className="academy-lab-backdrop" style={{filter:`blur(${Math.max(0,(11-f)*1.9)}px)`}}><span>山並み</span><span>木々</span><span>遠景</span></div>
  <div className="academy-lab-subject">被写体</div>
 </div>
 <div className="academy-lab-controls"><label>F値 <strong>F{f}</strong><input aria-label="F値" type="range" min="0" max="6" value={ap} onChange={e=>setAp(Number(e.target.value))}/></label>
 <label>シャッタースピード <strong>1/{speed}秒</strong><input aria-label="シャッタースピード" type="range" min="0" max="5" value={sh} onChange={e=>setSh(Number(e.target.value))}/></label>
 <label>ISO感度 <strong>ISO {iso}</strong><select aria-label="ISO感度" value={iso} onChange={e=>setIso(Number(e.target.value))}>{[100,200,400,800,1600,3200].map(v=><option key={v} value={v}>{v}</option>)}</select></label></div>
 <p className="academy-note">F値を小さくすると背景がぼけやすくなります。シャッタースピードを速くすると動きは止まりやすくなりますが、光は減ります。ISOを上げると明るさを補えます。</p>
 </section>;
}