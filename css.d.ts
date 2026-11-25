// CSS を読むだけの import（`import './globals.css'` など）の型。
// TypeScript 6 から、読むだけの import でも先のファイルの型を探すようになった
// （noUncheckedSideEffectImports が既定で有効）。CSS は Next が組むので、型は「在る」とだけ伝える。
declare module "*.css";
