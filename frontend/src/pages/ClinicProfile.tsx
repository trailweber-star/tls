import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getClinicBySlug, getSpecialistBySlug } from "../lib/api";
import { SpecialistCard } from "../components/SpecialistCard";
import NotFound from "./NotFound";
import type { ClinicWithRelations, SpecialistWithRelations } from "../lib/types";

export default function ClinicProfile() {
  const { slug = "" } = useParams();
  const [clinic, setClinic] = useState<ClinicWithRelations | null | undefined>(undefined);
  const [specialists, setSpecialists] = useState<SpecialistWithRelations[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setClinic(undefined);
    getClinicBySlug(slug)
      .then(async (c) => {
        setClinic(c);
        if (c) {
          const full = await Promise.all(c.specialists.map((s) => getSpecialistBySlug(s.slug)));
          setSpecialists(full.filter((s): s is SpecialistWithRelations => s !== null));
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load this clinic"));
  }, [slug]);

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl flex-1 px-4 py-24 text-center">
        <h1 className="text-xl font-bold text-ink">Can&apos;t reach the server</h1>
        <p className="mt-2 text-sm text-ink-muted">{loadError}</p>
      </main>
    );
  }
  if (clinic === undefined) {
    return <main className="flex-1 px-4 py-24 text-center text-sm text-ink-muted">Loading…</main>;
  }
  if (clinic === null) {
    return <NotFound />;
  }

  return (
    <main className="flex flex-1 flex-col">
      <section className="border-b border-line bg-paper-muted px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-2xl font-bold text-ink">{clinic.name}</h1>
          {clinic.description && <p className="mt-2 max-w-2xl text-sm text-ink-muted">{clinic.description}</p>}

          <div className="mt-4 flex flex-col gap-1 text-sm text-ink-muted">
            {clinic.locations.map((loc) => (
              <span key={loc.id}>
                {loc.address}
                {loc.postcode ? `, ${loc.postcode}` : ""}
                {loc.city ? ` · ${loc.city.name}` : ""}
                {loc.phone ? ` · ${loc.phone}` : ""}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <h2 className="text-lg font-bold text-ink">Specialists at this practice</h2>
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {specialists.map((specialist) => (
            <SpecialistCard key={specialist.id} specialist={specialist} />
          ))}
        </div>
      </section>
    </main>
  );
}
