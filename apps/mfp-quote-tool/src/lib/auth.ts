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

export interface AppUser {
  /** ログインID（英数字・記号。大文字小文字は区別しない） */
  id: string;
  /** 画面に出す名前（省略時はID） */
  name?: string;
  salt: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
}

/** 画面に返してよい範囲（ハッシュは渡さない） */
export interface PublicUser {
  id: string;
  name?: string;
  createdAt: string;
}

const publicOf = (u: AppUser): PublicUser => ({ id: u.id, name: u.name, createdAt: u.createdAt });

const usersPath = () => path.join(DATA_DIR, USERS_FILE);

export async function listUsers(): Promise<AppUser[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(usersPath(), "utf8");
    const list = JSON.parse(raw) as AppUser[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
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

/** IDと合言葉の決まり。弱いものを最初から弾く */
export function checkCredentials(id: string, password: string): string | undefined {
  const key = normalizeId(id);
  if (key.length < 3) return "IDは3文字以上で入れてください。";
  if (!/^[a-z0-9._@-]+$/.test(key)) return "IDに使えるのは半角の英数字と . _ - @ です。";
  if (password.length < 8) return "パスワードは8文字以上で入れてください。";
  if (/^\d+$/.test(password)) return "数字だけのパスワードは使えません。英字も混ぜてください。";
  return undefined;
}

async function hashPassword(password: string, salt: Buffer): Promise<string> {
  return (await scrypt(password.normalize("NFKC"), salt, 32)).toString("hex");
}

export async function createUser(id: string, password: string, name?: string): Promise<PublicUser> {
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
    salt: salt.toString("hex"),
    hash: await hashPassword(password, salt),
    createdAt: now,
    updatedAt: now,
  };
  await writeUsers([...list, user]);
  return publicOf(user);
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

export async function changePassword(id: string, current: string, next: string): Promise<void> {
  const ok = await verifyUser(id, current);
  if (!ok) throw new Error("いまのパスワードが違います。");
  const problem = checkCredentials(id, next);
  if (problem) throw new Error(problem);

  // 書き込む前にハッシュまで作る（途中で止まっても古いままで、ログインできなくならない）
  const key = normalizeId(id);
  const salt = randomBytes(16);
  const hash = await hashPassword(next, salt);
  const list = await listUsers();
  await writeUsers(
    list.map((u) =>
      u.id === key
        ? { ...u, salt: salt.toString("hex"), hash, updatedAt: new Date().toISOString() }
        : u,
    ),
  );
}

/** 利用者を消す。最後の1人は消せない（誰も入れなくなるため） */
export async function deleteUser(id: string): Promise<void> {
  const key = normalizeId(id);
  const list = await listUsers();
  if (!list.some((u) => u.id === key)) throw new Error("その利用者は登録されていません。");
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
