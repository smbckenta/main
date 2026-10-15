/**
 * 置き場所に関する設定。
 *
 * このツールは今は1台のWindows PCで動かしているが、いずれ基幹システムの
 * 一部として動かすことになる。そのときに書き換えることになる値を、
 * コードの中に散らばらせず、環境変数として1か所にまとめておく。
 *
 * 環境変数はPCごと・サーバーごとに違ってよいものだけを置く。
 * 会社の情報や仕切率のような「業務の中身」は settings.json 側に置く。
 */

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value || undefined;
};

/**
 * 基幹システムの中の、このツールの住所。
 *
 * 例：ポータルの `/mfp` にぶら下げるなら MFP_BASE_PATH=/mfp。
 * 画面のリンクもAPIの宛先もここを基準にするので、ここだけ変えれば移せる。
 */
export const BASE_PATH = (() => {
  const raw = env("MFP_BASE_PATH");
  if (!raw) return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "");
})();

/**
 * ログインしている人を、誰が決めるか。
 *
 * "local"  … このツール自身のログイン画面（いまの動き）
 * "header" … 前に立つ基幹システムが、確かめ済みの利用者をヘッダーで渡す
 *
 * 基幹システムに入ると、入口は1つであるべきで、ツールごとに
 * ログイン画面があるのはかえって危ない（パスワードが散らばる）。
 * 切り替えだけで寄せられるようにしておく。
 */
export type IdentitySource = "local" | "header";

export const IDENTITY_SOURCE: IdentitySource = env("MFP_IDENTITY") === "header" ? "header" : "local";

/**
 * 基幹システムが利用者を載せてくるヘッダー名。
 *
 * ヘッダーは誰でも名乗れてしまうので、前段（リバースプロキシや
 * 基幹システム本体）が必ず上書きする構成でのみ使うこと。
 * 直接インターネットに出すサーバーでこれを有効にしてはいけない。
 */
export const IDENTITY_HEADER = env("MFP_IDENTITY_HEADER") ?? "x-denrai-user";

/**
 * 基幹システムから呼ばれるときの合言葉。
 *
 * 設定してあるとき、ヘッダーで利用者を受け取る口は
 * この合言葉が一致したリクエストしか信用しない。
 */
export const TRUSTED_PROXY_TOKEN = env("MFP_PROXY_TOKEN");
