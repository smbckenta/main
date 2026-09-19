/**
 * APIキーの形の点検。
 *
 * いちばん多い取り違えは、Claude Console の一覧に表示されている
 * 「sk-ant-api03-C7J...3gAA」をそのままコピーしてしまうこと。
 * これは伏せ字で、本物のキーは100文字ほどあり、作成した直後にしか表示されない。
 *
 * 形がおかしいキーでも「キーは入っている」ようには見えてしまうため、
 * 読み取りの直前に黙ってOCRへ落ちる原因になる。送る前にここで止める。
 */

/** 伏せ字・貼り付けミスを見つける。問題なければ undefined */
export function checkApiKey(key: string): string | undefined {
  if (/\.\.\.|…/.test(key)) {
    return (
      "APIキーの中に「…」が入っています。Claude Consoleの一覧に表示されているキー" +
      "（sk-ant-api03-C7J...3gAA のような表記）は伏せ字なので、そのままでは使えません。" +
      "「＋キーを作成」で新しいキーを作り、作成直後に表示される100文字ほどの文字列を" +
      "コピーして貼り付けてください（一覧に戻ると二度と表示されません）。"
    );
  }
  if (/\s/.test(key)) {
    return "APIキーの途中に空白や改行が入っています。貼り付け直してください。";
  }
  if (!key.startsWith("sk-ant-")) {
    return "APIキーが「sk-ant-」で始まっていません。別の文字列を貼り付けている可能性があります。";
  }
  if (key.length < 90) {
    return (
      `APIキーが${key.length}文字しかありません（本物は100文字ほどです）。` +
      "貼り付けが途中で切れているか、Claude Consoleの一覧に表示されている伏せ字を" +
      "コピーしている可能性があります。「＋キーを作成」で新しいキーを作り、" +
      "作成直後に表示される文字列をコピーして貼り付けてください。"
    );
  }
  return undefined;
}

/**
 * 伏せ字にしたキー。頭と尻尾だけ見せて長さを添える。
 * 貼り付けミスは見た目では分からないので、長さが手がかりになる。
 * キー全体は絶対に画面へ返さない。
 */
export function maskApiKey(key: string): string {
  if (key.length <= 16) return `${key.slice(0, 8)}…（${key.length}文字）`;
  return `${key.slice(0, 12)}…${key.slice(-4)}（${key.length}文字）`;
}
