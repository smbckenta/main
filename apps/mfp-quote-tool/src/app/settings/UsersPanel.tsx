"use client";

import { useEffect, useState } from "react";

/**
 * 利用者（ログインID）の管理。
 *
 * このツールは仕切価格と顧客情報を扱うので、使う人ごとにIDを分けておく。
 * IDはメールアドレスにそろえてあるので、誰のIDかを人の記憶に頼らずに分かる。
 *
 * 権限は3段階。
 *   オーナー … 管理者を任命できる。1人だけで、消せない。
 *   管理者   … 利用者の追加・削除と、パスワードの再発行ができる。
 *   利用者   … 自分のパスワードだけ変えられる。
 */
type Role = "owner" | "admin" | "member";

interface PublicUser {
  id: string;
  name?: string;
  role: Role;
  createdAt: string;
}

const ROLE_LABEL: Record<Role, string> = {
  owner: "オーナー",
  admin: "管理者",
  member: "利用者",
};

export default function UsersPanel() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** 再発行したパスワード。この画面を離れると二度と見られない */
  const [issued, setIssued] = useState<{ id: string; password: string } | null>(null);

  // 追加する利用者
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"member" | "admin">("member");

  // 自分のパスワード変更
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  useEffect(() => {
    fetch("/api/auth/state")
      .then((r) => r.json())
      .then((j) => {
        setMe(j.me ?? null);
        setRole(j.role ?? null);
        setUsers(j.users ?? []);
      })
      .catch(() => {});
  }, []);

  const isAdmin = role === "owner" || role === "admin";
  const isOwner = role === "owner";

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
      body: JSON.stringify({
        id: newId,
        password: newPassword,
        name: newName.trim() || undefined,
        role: newRole,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (show(res, json, `${newId} を追加しました。`)) {
      setUsers(json.users ?? []);
      setNewId("");
      setNewName("");
      setNewPassword("");
      setNewRole("member");
    }
  }

  async function removeUser(id: string) {
    if (!confirm(`${id} を削除します。よろしいですか？`)) return;
    const res = await fetch(`/api/auth/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (show(res, json, `${id} を削除しました。`)) setUsers(json.users ?? []);
  }

  async function changeRole(id: string, value: Role) {
    const res = await fetch("/api/auth/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role: value }),
    });
    const json = await res.json().catch(() => ({}));
    if (show(res, json, `${id} を${ROLE_LABEL[value]}にしました。`)) setUsers(json.users ?? []);
  }

  async function reissue(id: string) {
    if (!confirm(`${id} のパスワードを作り直します。いまのパスワードは使えなくなります。`)) return;
    const res = await fetch("/api/auth/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const json = await res.json().catch(() => ({}));
    if (show(res, json, "")) {
      setIssued({ id, password: json.password });
      setUsers(json.users ?? users);
    }
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
        ログインIDはメールアドレスです。パスワードはご本人が決めます。暗号化して保存先のフォルダに置かれ、
        元の文字列は残りません。忘れたときは、管理者が「再発行」で新しいパスワードを作ってお渡しください。
      </p>

      {message && <p className="badge">{message}</p>}
      {error && <p className="error">{error}</p>}

      {issued && (
        <div className="issued">
          <strong>{issued.id}</strong> の新しいパスワード
          <code>{issued.password}</code>
          <p className="muted">
            この画面を離れると二度と表示できません。ご本人にお伝えのうえ、
            ログイン後にご自身で変えてもらってください。
          </p>
          <button className="secondary" onClick={() => setIssued(null)}>
            閉じる
          </button>
        </div>
      )}

      <table style={{ maxWidth: 720 }}>
        <thead>
          <tr>
            <th>ID（メールアドレス）</th>
            <th>お名前</th>
            <th>権限</th>
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
              <td>
                {/* 権限を配れるのはオーナーだけ。オーナー自身の権限は動かせない */}
                {isOwner && u.role !== "owner" ? (
                  <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value as Role)}>
                    <option value="member">利用者</option>
                    <option value="admin">管理者</option>
                  </select>
                ) : (
                  ROLE_LABEL[u.role]
                )}
              </td>
              <td>{u.createdAt.slice(0, 10)}</td>
              <td>
                {isAdmin && (
                  <>
                    <button className="secondary" onClick={() => reissue(u.id)}>
                      パスワード再発行
                    </button>
                    <button
                      className="danger"
                      disabled={u.id === me || u.role === "owner"}
                      onClick={() => removeUser(u.id)}
                    >
                      削除
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {isAdmin && (
        <>
          <h3>利用者を追加する</h3>
          <div className="row">
            <div className="field" style={{ width: 240 }}>
              <label>ID（メールアドレス）</label>
              <input
                value={newId}
                placeholder="akamine@denrai.net"
                onChange={(e) => setNewId(e.target.value)}
              />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>お名前（任意）</label>
              <input value={newName} placeholder="赤嶺" onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="field" style={{ width: 200 }}>
              <label>最初のパスワード（8文字以上・英字を含む）</label>
              <input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            {isOwner && (
              <div className="field" style={{ width: 110 }}>
                <label>権限</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "member" | "admin")}
                >
                  <option value="member">利用者</option>
                  <option value="admin">管理者</option>
                </select>
              </div>
            )}
            <button disabled={!newId || !newPassword} onClick={addUser}>
              追加
            </button>
          </div>
          <p className="muted">
            最初のパスワードはこちらで決めて構いません。ログインしたあと、ご本人に変えてもらってください。
          </p>
        </>
      )}

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
