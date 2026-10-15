import { listDeletionLog, listQuotes, getSettings } from "@/lib/store";
import NewQuoteForm from "./NewQuoteForm";
import QuoteList from "./QuoteList";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [quotes, settings, log] = await Promise.all([
    listQuotes(),
    getSettings(),
    listDeletionLog(),
  ]);

  return (
    <>
      <NewQuoteForm />
      <QuoteList
        quotes={quotes}
        staff={settings.staff}
        log={log}
        passwordSet={Boolean(settings.deletion.passwordHash)}
      />
    </>
  );
}
