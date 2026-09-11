import { isDbConfigured } from "../config/db.js";
import { clinics as clinicRepo } from "../db/repos.js";
import { buildClinicWithRelations, clinics as mockClinics } from "../data/mock.js";

// GET /api/clinics/:slug
export async function getClinicBySlug(req, res) {
  const { slug } = req.params;

  if (!isDbConfigured()) {
    const clinic = mockClinics.find((c) => c.slug === slug);
    if (!clinic) return res.status(404).json({ error: "Clinic not found" });
    return res.json(buildClinicWithRelations(clinic));
  }

  const clinic = await clinicRepo.findBySlug(slug);
  if (!clinic) return res.status(404).json({ error: "Clinic not found" });
  res.json(clinic);
}
