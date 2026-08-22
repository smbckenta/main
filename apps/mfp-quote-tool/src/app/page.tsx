import Link from "next/link";
import { listQuotes } from "@/lib/store";
import NewQuoteForm from "./NewQuoteForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const quotes = await listQuotes();

  return (
    <>
      <NewQuoteForm />

      <section className="panel">
        <h2>案件一覧</h2>
        {quotes.length === 0 ? (
          <p className="muted">
            まだ案件がありません。上の「資料から新規作成」でリース契約書と印刷明細を読み込んでください。
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>見積日</th>
                <th>見積番号</th>
                <th>お客様</th>
                <th>件名</th>
                <th>エリア</th>
                <th>提案</th>
                <th>更新</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td>{q.quoteDate}</td>
                  <td>{q.quoteNo}</td>
                  <td>
                    <Link href={`/quotes/${q.id}`}>{q.customerName || "(未入力)"}</Link>
                  </td>
                  <td>{q.title}</td>
                  <td>{q.area}</td>
                  <td>{q.proposals.length}社</td>
                  <td className="muted">{q.updatedAt.slice(0, 16).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
