import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Node / Lambda の CommonJS では require を許可。_ 始まりの変数は未使用でも許可
  {
    files: ["api/**/*.js", "scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
    },
  },
  // **React Compiler の検査のうち、eslint-plugin-react-hooks 7.1 で見つけ方が広がった5つは、当面「警告」にする**
  // （2026-11-25・部品の版の一括の上げ）。7.1 は ESLint 10 に対応した版で、同時に
  // 「1件目で止めずに全部出す」「setState・ref の見落としを減らす」ようになり、前からある書き方が
  // 42 ファイル 112 件、新しく誤りとして出た（ESLint 9 に戻しても同じ数で、ESLint 10 のせいではない）。
  // 直すと画面の動きが変わりうるので、部品の上げとは別の PR で少しずつ直す。
  // **外す条件: この5つの警告が 0 件になったら、この塊ごと消して「誤り」に戻す。**
  {
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Compiled Lambda bundles (esbuild output)
    "api-user/dist/**",
    "api-user/node_modules/**",
    // レビューや変異テストの一時置き場。中身は本物のソースのコピーなので、
    // 拾うと lint も vitest も二重になる（vitest.config.ts にも同じ除外あり）。
    "**/__ztmp/**",
  ]),
]);

export default eslintConfig;
