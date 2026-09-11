// Demo-mode enquiry store.
//
// The MongoDB path writes Lead documents; demo mode has nowhere to write
// to, so enquiries live here for the life of the process. Same operations,
// same field names, so the dashboard controller carries one code path.
//
// A few enquiries are seeded against the demo specialist account so the
// Enquiries workspace has something in it on first open.

let nextId = 1;
const leads = [];

function create(lead) {
  const record = {
    id: `lead-${nextId++}`,
    patientName: lead.patientName,
    email: lead.email || null,
    phone: lead.phone || null,
    message: lead.message || null,
    specialistId: lead.specialistId || null,
    clinicId: lead.clinicId || null,
    facilityId: lead.facilityId || null,
    status: "new",
    response: null,
    respondedAt: null,
    source: "website_enquiry",
    createdAt: lead.createdAt ?? new Date().toISOString(),
  };
  leads.unshift(record);
  return record;
}

export const demoLeads = {
  create,
  forSpecialist: (specialistId) =>
    leads
      .filter((l) => l.specialistId === specialistId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  findForSpecialist: (id, specialistId) =>
    leads.find((l) => l.id === id && l.specialistId === specialistId) ?? null,
  update(id, patch) {
    const lead = leads.find((l) => l.id === id);
    if (lead) Object.assign(lead, patch);
    return lead ?? null;
  },
  all: () => leads,
};

// Seeded enquiries for the demo specialist (Mr James Whitfield), so the
// dashboard isn't empty before anyone submits one.
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
[
  { patientName: "Emma Davis", email: "emma.davis@example.com", message: "Persistent knee pain after running — could I be seen?", createdAt: hoursAgo(2) },
  { patientName: "James Wilson", email: "j.wilson@example.com", message: "Asking about hip replacement waiting times.", createdAt: hoursAgo(4) },
  { patientName: "Olivia Martin", email: "o.martin@example.com", message: "Sports injury — torn something in my shoulder.", createdAt: hoursAgo(6) },
  { patientName: "Daniel White", email: "d.white@example.com", message: "Shoulder pain that hasn't settled in three months.", createdAt: hoursAgo(8) },
].forEach((l) => create({ ...l, specialistId: "spc-mr-james-whitfield" }));
