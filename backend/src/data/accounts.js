// Demo-mode account store.
//
// Demo mode has no database, so accounts live in memory for the life of
// the process. It exposes the same handful of operations the Mongo path
// uses, which is what lets the auth controller carry one implementation
// instead of two.
//
// Two accounts are seeded so the dashboard can be opened immediately:
//
//   admin@tls.test        / demo1234   — admin
//   j.whitfield@example.com / demo1234 — a specialist (Mr James Whitfield)
//
// These are DEMO credentials on a demo dataset. A real deployment runs
// against MongoDB, where accounts are created by registration and the
// first admin is made deliberately.

import { hashPassword } from "../lib/auth.js";
import { specialists } from "./mock.js";

let nextId = 1;
const users = [];

function create({ email, password, fullName, role = "specialist", specialistId = null }) {
  const user = {
    id: `usr-${nextId++}`,
    email: String(email).toLowerCase().trim(),
    passwordHash: hashPassword(password),
    fullName,
    role,
    specialistId,
    lastLoginAt: null,
    active: true,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  return user;
}

// Seed the two demo logins.
create({ email: "admin@tls.test", password: "demo1234", fullName: "TLS Admin", role: "admin" });
const seededSpecialist = specialists.find((s) => s.slug === "mr-james-whitfield");
if (seededSpecialist) {
  create({
    email: seededSpecialist.contactEmail ?? "j.whitfield@example.com",
    password: "demo1234",
    fullName: seededSpecialist.fullName,
    role: "specialist",
    specialistId: seededSpecialist.id,
  });
}

export const demoAccounts = {
  findByEmail: (email) => users.find((u) => u.email === String(email).toLowerCase().trim()) ?? null,
  findById: (id) => users.find((u) => u.id === id) ?? null,
  create,
  update(id, patch) {
    const user = users.find((u) => u.id === id);
    if (user) Object.assign(user, patch);
    return user ?? null;
  },
  all: () => users,
};
