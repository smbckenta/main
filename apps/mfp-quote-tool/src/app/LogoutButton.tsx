"use client";

/** ログアウトして、ログイン画面に戻る */
export default function LogoutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
    >
      ログアウト
    </button>
  );
}
