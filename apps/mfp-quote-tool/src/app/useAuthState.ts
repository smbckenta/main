"use client";

import { useEffect, useState } from "react";

/**
 * ログインしている人と、その権限を画面側で知るための読み取り。
 *
 * 仕切表・機種スペックDB・設定は、押しても403で断られるボタンを
 * 出しておくより、最初から出さないほうがよい。
 * 実際の可否はサーバー側で決めているので、ここは見た目のためだけ。
 */
export type Role = "owner" | "admin" | "member";

export interface AuthState {
  me: string | null;
  role: Role | null;
  /** 仕切表・機種DB・設定を直せるか（管理者とオーナー） */
  canEditMasters: boolean;
  /** 読み込みが終わったか。終わるまでは編集欄を出さない */
  ready: boolean;
}

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({
    me: null,
    role: null,
    canEditMasters: false,
    ready: false,
  });

  useEffect(() => {
    fetch("/api/auth/state")
      .then((r) => r.json())
      .then((j) => {
        const role = (j.role ?? null) as Role | null;
        setState({
          me: j.me ?? null,
          role,
          canEditMasters: role === "owner" || role === "admin",
          ready: true,
        });
      })
      .catch(() => setState((s) => ({ ...s, ready: true })));
  }, []);

  return state;
}

/** 権限が足りないときに出す案内（画面ごとに同じ文言にする） */
export const MASTER_READONLY_NOTE =
  "この内容は全員が同じものを見て見積を作るための土台なので、変更できるのは管理者だけです。閲覧はできます。変更が必要なときは管理者にご依頼ください。";
