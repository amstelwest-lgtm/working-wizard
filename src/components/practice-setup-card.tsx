import { Link } from "@tanstack/react-router";

/**
 * Firm Home entry. Opens the practice interview on one example client.
 * Does not render Setup Partner itself.
 */
export function PracticeSetupCard({ exampleClientId }: { exampleClientId: string | null }) {
  return (
    <section
      className="mb-3 rounded-2xl border border-[color:var(--line)] bg-white p-4 shadow-sm dark:bg-[#102A43]"
      aria-label="Set up your practice"
      data-practice-setup=""
    >
      <h2 className="m-0 text-[15px] font-bold leading-tight text-[#102A43] dark:text-[#F4F7FB]">
        Set up your practice
      </h2>
      <p className="sub mt-1 mb-2">
        Map how the firm closes, reviews, signs off, and reports. One client is only an example.
        Connected books and the interview. No desktop access.
      </p>
      {exampleClientId ? (
        <Link
          to="/clients/$clientId"
          params={{ clientId: exampleClientId }}
          search={{ tab: "home", view: "books" }}
          className="btn ghost mini"
        >
          Set up your practice
        </Link>
      ) : (
        <p className="sub m-0">Add a client to use as an example.</p>
      )}
    </section>
  );
}
