"use client";

import { useEffect, useState } from "react";

/**
 * ログイン画面。
 *
 * まだ誰も登録されていないときは、そのまま最初の利用者を作る画面になる。
 * 初期パスワードを配って回る手間をなくし、使い始めでつまずかないようにする。
 */
export default function LoginForm() {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/state")
      .then((r) => r.json())
      .then((j) => setRegistered(Boolean(j.registered)))
      .catch(() => setRegistered(true));
  }, []);

  /** ログイン後に戻る画面（?next= で渡ってくる） */
  function goNext() {
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") ? next : "/";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (registered === false && password !== confirm) {
      setError("確認用のパスワードが一致しません。");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(registered === false ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password, name: name.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) goNext();
      else setError(json.error ?? "ログインできませんでした。");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (registered === null) return <p className="spinner">読み込み中…</p>;
  const first = registered === false;

  return (
    <div className="login-page">
      <form className="panel login-card" onSubmit={submit}>
        <h2>{first ? "最初の利用者を登録します" : "ログイン"}</h2>
        <p className="muted">
          {first
            ? "このツールを使う方のIDとパスワードを決めてください。2人目以降は、ログインしたあと設定画面から追加できます。"
            : "IDとパスワードを入れてください。"}
        </p>

        <div className="field">
          <label>ID</label>
          <input
            value={id}
            autoFocus
            autoComplete="username"
            placeholder="kosaka"
            onChange={(e) => setId(e.target.value)}
          />
        </div>

        {first && (
          <div className="field">
            <label>お名前（任意・画面に出ます）</label>
            <input value={name} placeholder="小坂" onChange={(e) => setName(e.target.value)} />
          </div>
        )}

        <div className="field">
          <label>パスワード{first && "（8文字以上・英字を含む）"}</label>
          <input
            type="password"
            value={password}
            autoComplete={first ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {first && (
          <div className="field">
            <label>パスワード（確認）</label>
            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <button className="primary" type="submit" disabled={busy || !id || !password}>
          {busy ? "確認中…" : first ? "登録してはじめる" : "ログイン"}
        </button>
      </form>
    </div>
  );
}
