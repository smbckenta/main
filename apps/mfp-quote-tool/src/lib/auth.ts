import { promises as fs } from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DATA_DIR, ensureDataDir } from "./store";

/**
 * 利用者ごとのログイン。
 *
 * このツールは各社のPCで動かす前提だが、仕切価格や顧客情報を扱うため
 * 「誰でも開ける」状態にはしない。IDと合言葉（パスワード）で入口を閉める。
 *
 * 外部のサービスは使わず、保存先のフォルダに置いた users.json だけで完結させる。
 * パスワードは scrypt でハッシュ化して保存し、元の文字列は残さない。
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const USERS_FILE = "users.json";
const SECRET_FILE = "auth-secret";
/** ログインを保つ期間。営業の使い方に合わせて、しばらくは開きっぱなしにする */
const SESSION_DAYS = 30;
export const SESSION_COOKIE = "mfp_session";

/**
 * 権限は3段階。
 *
 * owner  … 最初に登録した人。管理者を任命できる。消されない。
 * admin  … 利用者の追加・削除と、他の人のパスワードの再発行ができる。
 * member … 自分のパスワードだけ変えられる。
 */
export type Role = "owner" | "admin" | "member";

export interface AppUser {
  /** ログインID＝メールアドレス（大文字小文字は区別しない） */
  id: string;
  /** 画面に出す名前（省略時はID） */
  name?: string;
  role: Role;
  salt: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
}

/** 画面に返してよい範囲（ハッシュは渡さない） */
export interface PublicUser {
  id: string;
  name?: string;
  role: Role;
  createdAt: string;
}

const publicOf = (u: AppUser): PublicUser => ({
  id: u.id,
  name: u.name,
  role: u.role,
  createdAt: u.createdAt,
});

const usersPath = () => path.join(DATA_DIR, USERS_FILE);

export async function listUsers(): Promise<AppUser[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(usersPath(), "utf8");
    const list = JSON.parse(raw) as AppUser[];
    if (!Array.isArray(list)) return [];
    // 権限を付ける前に作られたファイルを読んだとき、最初の1人をオーナーとして扱う
    return list.map((u, i) => ({ ...u, role: u.role ?? (i === 0 ? "owner" : "member") }));
  } catch {
    return [];
  }
}

/** 管理者（オーナーを含む）か */
export const isAdmin = (u: { role: Role } | undefined): boolean =>
  u?.role === "owner" || u?.role === "admin";

export async function findUser(id: string): Promise<PublicUser | undefined> {
  const key = normalizeId(id);
  const user = (await listUsers()).find((u) => u.id === key);
  return user && publicOf(user);
}

export async function listPublicUsers(): Promise<PublicUser[]> {
  return (await listUsers()).map(publicOf);
}

async function writeUsers(list: AppUser[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(usersPath(), `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/** まだ誰も登録されていないか（初回の登録画面を出すかの判断に使う） */
export async function hasAnyUser(): Promise<boolean> {
  return (await listUsers()).length > 0;
}

/** IDは大文字小文字を区別しない。前後の空白も無視する */
const normalizeId = (id: string): string => id.trim().toLowerCase();

/**
 * ログインIDはメールアドレス。
 *
 * 社内で「誰のIDか」を言い当てられるようにしておくと、
 * 退職や異動のときに消し忘れが起きにくい。
 */
const MAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function checkUserId(id: string): string | undefined {
  const key = normalizeId(id);
  if (!key) return "IDを入れてください。";
  if (!MAIL.test(key)) return "IDはメールアドレスで入れてください。（例：name@example.co.jp）";
  return undefined;
}

/** パスワードの決まり。弱いものを最初から弾く */
export function checkPassword(password: string): string | undefined {
  if (password.length < 8) return "パスワードは8文字以上で入れてください。";
  if (/^\d+$/.test(password)) return "数字だけのパスワードは使えません。英字も混ぜてください。";
  return undefined;
}

/** IDと合言葉の決まり。弱いものを最初から弾く */
export function checkCredentials(id: string, password: string): string | undefined {
  return checkUserId(id) ?? checkPassword(password);
}

/**
 * 再発行用のパスワードを作る。
 *
 * 口頭やメールで伝えることになるので、紛らわしい文字（0とO、1とlなど）は使わない。
 */
export function makePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  return `Lf-${Array.from(bytes, (b) => chars[b % chars.length]).join("")}`;
}

async function hashPassword(password: string, salt: Buffer): Promise<string> {
  return (await scrypt(password.normalize("NFKC"), salt, 32)).toString("hex");
}

/**
 * 利用者を作る。
 *
 * いちばん最初の1人は自動的にオーナーになる（ツールを立ち上げた本人）。
 * 2人目以降は、既定では member。
 */
export async function createUser(
  id: string,
  password: string,
  name?: string,
  role: Role = "member",
): Promise<PublicUser> {
  const problem = checkCredentials(id, password);
  if (problem) throw new Error(problem);

  const key = normalizeId(id);
  const list = await listUsers();
  if (list.some((u) => u.id === key)) throw new Error(`ID「${key}」はすでに登録されています。`);

  const salt = randomBytes(16);
  const now = new Date().toISOString();
  const user: AppUser = {
    id: key,
    name: name?.trim() || undefined,
    // オーナーは1人だけ。2人目以降がオーナーを名乗ることはできない
    role: list.length === 0 ? "owner" : role === "owner" ? "admin" : role,
    salt: salt.toString("hex"),
    hash: await hashPassword(password, salt),
    createdAt: now,
    updatedAt: now,
  };
  await writeUsers([...list, user]);
  return publicOf(user);
}

/**
 * 権限を変える。任命できるのはオーナーだけ。
 *
 * 「管理者を増やす」はオーナーの判断として残しておきたいので、
 * 管理者どうしで権限を配り合えないようにしている。
 */
export async function setRole(actorId: string, targetId: string, role: Role): Promise<PublicUser[]> {
  const list = await listUsers();
  const actor = list.find((u) => u.id === normalizeId(actorId));
  if (actor?.role !== "owner") throw new Error("権限を変えられるのはオーナーだけです。");

  const key = normalizeId(targetId);
  const target = list.find((u) => u.id === key);
  if (!target) throw new Error("その利用者は登録されていません。");
  if (target.role === "owner") throw new Error("オーナーの権限は変えられません。");
  if (role === "owner") throw new Error("オーナーは1人だけです。");

  const next = list.map((u) =>
    u.id === key ? { ...u, role, updatedAt: new Date().toISOString() } : u,
  );
  await writeUsers(next);
  return next.map(publicOf);
}

/** IDと合言葉が合っているか。合っていれば利用者を返す */
export async function verifyUser(id: string, password: string): Promise<PublicUser | undefined> {
  const key = normalizeId(id);
  const user = (await listUsers()).find((u) => u.id === key);
  if (!user) return undefined;
  const hash = await hashPassword(password, Buffer.from(user.salt, "hex"));
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(user.hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return publicOf(user);
}

/** パスワードを書き換える（呼ぶ前に、誰がやってよいかを確かめておくこと） */
async function writePassword(id: string, password: string): Promise<void> {
  const problem = checkPassword(password);
  if (problem) throw new Error(problem);

  // 書き込む前にハッシュまで作る（途中で止まっても古いままで、ログインできなくならない）
  const key = normalizeId(id);
  const salt = randomBytes(16);
  const hash = await hashPassword(password, salt);
  const list = await listUsers();
  if (!list.some((u) => u.id === key)) throw new Error("その利用者は登録されていません。");
  await writeUsers(
    list.map((u) =>
      u.id === key
        ? { ...u, salt: salt.toString("hex"), hash, updatedAt: new Date().toISOString() }
        : u,
    ),
  );
}

/** 自分のパスワードを変える。いまのパスワードが要る */
export async function changePassword(id: string, current: string, next: string): Promise<void> {
  const ok = await verifyUser(id, current);
  if (!ok) throw new Error("いまのパスワードが違います。");
  await writePassword(id, next);
}

/**
 * 管理者が、他の人のパスワードを再発行する。
 *
 * パスワードを忘れた人のために作り直す口。新しいパスワードは画面に1度だけ出し、
 * 本人に伝えてもらう。保存されるのはハッシュだけなので、あとから読み出すことはできない。
 */
export async function resetPassword(
  actorId: string,
  targetId: string,
  password?: string,
): Promise<string> {
  const list = await listUsers();
  const actor = list.find((u) => u.id === normalizeId(actorId));
  if (!isAdmin(actor)) throw new Error("パスワードの再発行ができるのは管理者だけです。");

  const target = list.find((u) => u.id === normalizeId(targetId));
  if (!target) throw new Error("その利用者は登録されていません。");
  if (target.role === "owner" && actor?.role !== "owner") {
    throw new Error("オーナーのパスワードは、オーナー本人だけが変えられます。");
  }

  const next = password?.trim() || makePassword();
  await writePassword(target.id, next);
  return next;
}

/** 利用者を消す。オーナーと最後の1人は消せない（誰も入れなくなるため） */
export async function deleteUser(actorId: string, targetId: string): Promise<void> {
  const list = await listUsers();
  const actor = list.find((u) => u.id === normalizeId(actorId));
  if (!isAdmin(actor)) throw new Error("利用者を削除できるのは管理者だけです。");

  const key = normalizeId(targetId);
  const target = list.find((u) => u.id === key);
  if (!target) throw new Error("その利用者は登録されていません。");
  if (target.role === "owner") throw new Error("オーナーは削除できません。");
  if (target.id === actor?.id) throw new Error("自分自身は削除できません。");
  if (list.length <= 1) throw new Error("最後の利用者は削除できません（誰もログインできなくなります）。");
  await writeUsers(list.filter((u) => u.id !== key));
}

/* ---------------- ログインの保持（署名つきクッキー） ---------------- */

let secretCache: Buffer | null = null;

/** クッキーの署名に使う鍵。無ければ作って保存先に置く */
export async function sessionSecret(): Promise<Buffer> {
  if (secretCache) return secretCache;
  await ensureDataDir();
  const file = path.join(DATA_DIR, SECRET_FILE);
  try {
    const hex = (await fs.readFile(file, "utf8")).trim();
    if (hex.length >= 32) {
      secretCache = Buffer.from(hex, "hex");
      return secretCache;
    }
  } catch {
    /* 無ければ作る */
  }
  const secret = randomBytes(32);
  await fs.writeFile(file, `${secret.toString("hex")}\n`, { encoding: "utf8", mode: 0o600 });
  secretCache = secret;
  return secret;
}

const sign = (data: string, secret: Buffer): string =>
  createHmac("sha256", secret).update(data).digest("base64url");

/** ログイン済みであることを示す文字列を作る（ID・期限・署名） */
export async function createSessionToken(id: string): Promise<string> {
  const payload = Buffer.from(
    JSON.stringify({ id: normalizeId(id), exp: Date.now() + SESSION_DAYS * 86_400_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload, await sessionSecret())}`;
}

/** 文字列を確かめて、ログインしている利用者のIDを返す */
export async function readSessionToken(token: string | undefined): Promise<string | undefined> {
  if (!token) return undefined;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return undefined;

  const expected = sign(payload, await sessionSecret());
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;

  try {
    const { id, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      id?: string;
      exp?: number;
    };
    if (!id || !exp || exp < Date.now()) return undefined;
    return id;
  } catch {
    return undefined;
  }
}

/** クッキーに載せる設定（ローカル実行なので Secure は付けない） */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 86_400,
};
