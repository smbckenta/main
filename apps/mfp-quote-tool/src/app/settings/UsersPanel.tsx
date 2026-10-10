"use client";

import { useEffect, useState } from "react";

/**
 * 利用者（ログインID）の管理。
 *
 * このツールは仕切価格と顧客情報を扱うので、使う人ごとにIDを分けておく。
 * 追加・削除と、自分のパスワード変更をここでまとめて行う。
 */
interface PublicUser {
  id: string;
  name?: string;
  createdAt: string;
}

export default function UsersPanel() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 追加する利用者
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // 自分のパスワード変更
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  useEffect(() => {
    fetch("/api/auth/state")
      .then((r) => r.json())
      .then((j) => {
        setMe(j.me ?? null);
        setUsers(j.users ?? []);
      })
      .catch(() => {});
  }, []);

  function show(res: Response, json: { error?: string }, ok: string) {
    if (res.ok) {
      setMessage(ok);
      setError("");
    } else {
      setError(json.error ?? "うまくいきませんでした。");
      setMessage("");
    }
    return res.ok;
  }

  async function addUser() {
    const res = await fetch("/api/auth/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: newId, password: newPassword, name: newName.trim() || undefined }),
    });
    const json = await res.json().catch(() => ({}));
    if (show(res, json, `${newId} を追加しました。`)) {
      setUsers(json.users ?? []);
      setNewId("");
      setNewName("");
      setNewPassword("");
    }
  }

  async function removeUser(id: string) {
    if (!confirm(`${id} を削除します。よろしいですか？`)) return;
    const res = await fetch(`/api/auth/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (show(res, json, `${id} を削除しました。`)) setUsers(json.users ?? []);
  }

  async function updatePassword() {
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const json = await res.json().catch(() => ({}));
    if (show(res, json, "パスワードを変更しました。")) {
      setCurrent("");
      setNext("");
    }
  }

  return (
    <section className="panel">
      <h2>利用者（ログインID）</h2>
      <p className="muted">
        このツールを使う方ごとにIDを分けます。パスワードは暗号化して保存先のフォルダに置かれ、
        元の文字列は残りません。忘れた場合は、ほかの方のIDでログインして一度削除し、作り直してください。
      </p>

      {message && <p className="badge">{message}</p>}
      {error && <p className="error">{error}</p>}

      <table style={{ maxWidth: 560 }}>
        <thead>
          <tr>
            <th>ID</th>
            <th>お名前</th>
            <th>登録日</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                {u.id}
                {u.id === me && <span className="muted">（ログイン中）</span>}
              </td>
              <td>{u.name ?? "－"}</td>
              <td>{u.createdAt.slice(0, 10)}</td>
              <td>
                <button className="danger" disabled={u.id === me} onClick={() => removeUser(u.id)}>
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>利用者を追加する</h3>
      <div className="row">
        <div className="field" style={{ width: 160 }}>
          <label>ID（半角英数字）</label>
          <input value={newId} placeholder="akamine" onChange={(e) => setNewId(e.target.value)} />
        </div>
        <div className="field" style={{ width: 160 }}>
          <label>お名前（任意）</label>
          <input value={newName} placeholder="赤嶺" onChange={(e) => setNewName(e.target.value)} />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>パスワード（8文字以上・英字を含む）</label>
          <input
            type="password"
            value={newPassword}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <button disabled={!newId || !newPassword} onClick={addUser}>
          追加
        </button>
      </div>

      <h3>自分のパスワードを変える</h3>
      <div className="row">
        <div className="field" style={{ width: 200 }}>
          <label>いまのパスワード</label>
          <input
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field" style={{ width: 200 }}>
          <label>新しいパスワード</label>
          <input
            type="password"
            value={next}
            autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <button disabled={!current || !next} onClick={updatePassword}>
          変更する
        </button>
      </div>
    </section>
  );
}
