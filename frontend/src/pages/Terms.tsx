import { Link } from "react-router-dom";
import { LegalPage } from "../components/LegalPage";
import type { LegalSection } from "../components/LegalPage";
import { CONTACT_DETAILS } from "./Contact";

/* ------------------------------------------------------------------ *
 * Terms of use
 *
 * Written for what this site actually is: a directory that checks a
 * professional's registration and then publishes a listing. Two things
 * shape almost every clause here.
 *
 * The first is that we are not in the room. The care is given by the
 * practitioner, the contract for it is between them and the patient,
 * and a verified badge says their registration was checked — not that
 * their clinical judgement is endorsed. Saying that plainly protects
 * patients from a false impression and the company from a claim it
 * never meant to underwrite.
 *
 * The second is that a listing can exist before its owner does. Profiles
 * are imported and unclaimed until somebody proves the registration is
 * theirs, so the terms have to cover a person who has never agreed to
 * them — which is why the correction and removal route for an unclaimed
 * listing is stated here rather than buried in a help article.
 *
 * This is a plain-English draft, not legal advice. It needs a UK
 * solicitor's eye before launch — particularly the liability, billing
 * and consumer-cancellation clauses.
 * ------------------------------------------------------------------ */

const EMAIL = CONTACT_DETAILS.email;

/** The date this version of the terms took effect. */
const UPDATED = "2026-09-11";

function MailLink() {
  return <a href={`mailto:${EMAIL}`}>{EMAIL}</a>;
}

const SECTIONS: LegalSection[] = [
  {
    id: "about",
    heading: "About these terms",
    body: (
      <>
        <p>
          These terms of use explain the rules for using www.toplocalspecialists.com (the “site”), which is operated by{" "}
          <strong>{CONTACT_DETAILS.legalName}</strong> of {CONTACT_DETAILS.address.join(", ")} (“we”, “us”, “our”).
        </p>
        <p>
          They apply to everyone who uses the site: patients and members of the public searching for care, and
          healthcare professionals, clinics, hospitals, care homes and pharmacies who hold or claim a listing on it. By
          using the site you accept these terms. If you do not accept them, please do not use the site.
        </p>
        <p>
          Separate terms apply to how we handle personal data — see our{" "}
          <Link to="/privacy">privacy notice</Link>.
        </p>
      </>
    ),
  },
  {
    id: "what-we-are",
    heading: "What we are, and what we are not",
    body: (
      <>
        <p>
          Top Local Specialists is a directory. We publish listings for healthcare professionals and care settings, and
          we check a professional&apos;s registration with their regulator before their listing is marked as verified.
        </p>
        <p>
          <strong>We do not provide healthcare</strong>, we do not give medical advice, and nothing on this site is a
          diagnosis, a treatment recommendation or a substitute for a consultation with a qualified professional. Any
          care you receive is provided by the practitioner or organisation you choose, under a contract between you and
          them. We are not a party to it.
        </p>
        <p>
          <strong>Verification is not endorsement.</strong> A verified listing means that at the time of checking, we
          were satisfied that the person exists, is registered with the regulator they named, and is entitled to
          practise. It is not an assessment of their clinical skill, their outcomes or their suitability for you, and it
          is not a recommendation. Registration status can change after we check it.
        </p>
        <p>
          <strong>In an emergency, do not use this site.</strong> Call 999, or contact NHS 111 if the situation is
          urgent but not life-threatening.
        </p>
      </>
    ),
  },
  {
    id: "using-the-site",
    heading: "Using the site as a patient",
    body: (
      <>
        <p>
          You may search the directory, read listings and reviews, and send an enquiry to a listed professional. You
          must be at least 13 years old to use the site, and at least 18 to send an enquiry or leave a review.
        </p>
        <p>
          When you send an enquiry, its contents are passed to the professional or organisation you selected so that
          they can respond. Please only include what is necessary. Do not send clinical documents, images or detailed
          medical history through an enquiry form — the practitioner will tell you how to share those securely once you
          are in contact.
        </p>
        <p>
          We cannot promise that any professional will reply, accept you as a patient, or offer an appointment within
          any particular time. Prices, availability, locations and services shown on a listing are supplied by the
          member and may change; confirm them directly before committing to anything.
        </p>
      </>
    ),
  },
  {
    id: "reviews",
    heading: "Reviews",
    body: (
      <>
        <p>
          Reviews exist to help other patients. You may leave one only where you have genuine first-hand experience of
          the care or service you are describing, and what you write must be honest and your own.
        </p>
        <p>You must not:</p>
        <ul>
          <li>write a review about yourself, your own practice, a competitor, or on behalf of someone else;</li>
          <li>offer, accept or solicit any payment, discount or other incentive in exchange for a review;</li>
          <li>include the names or identifying details of other patients or of staff;</li>
          <li>post anything defamatory, abusive, discriminatory or unlawful;</li>
          <li>describe clinical outcomes in a way that is misleading, or make claims you cannot support.</li>
        </ul>
        <p>
          Reviews are moderated before they appear. We may decline to publish, edit for length or clarity, or remove a
          review that breaks these rules, and we may remove one where the person reviewed raises a substantiated
          objection. We do not remove a review simply because its subject dislikes it. A member may ask us to publish a
          right of reply.
        </p>
        <p>
          A clinical complaint is not a review: if you believe a professional has put a patient at risk, raise it with
          their regulator and, where appropriate, with the provider directly.
        </p>
      </>
    ),
  },
  {
    id: "listings-and-claiming",
    heading: "Listings, claiming and verification",
    body: (
      <>
        <p>
          Some listings are created by us from public sources so that patients can find a professional before that
          professional has joined. An unclaimed listing carries only factual, publicly available information and is
          marked as unclaimed. It does not imply any relationship between us.
        </p>
        <p>
          If a listing describes you, you may claim it. To do so you must be that person, or be authorised in writing by
          them or by the organisation concerned, and you must give the registration number under which you practise. We
          check it against the relevant register — GMC, GDC, NMC, HCPC or the appropriate regulator — before approving a
          claim.
        </p>
        <p>
          We may decline a claim, ask for further evidence, or reverse an approval where the information given turns out
          to be wrong. Deliberately claiming a listing that is not yours is a serious matter and we will report it to
          the regulator concerned.
        </p>
        <p>
          If you are the subject of an unclaimed listing and you want it corrected or removed, email <MailLink /> from
          an address we can verify and we will deal with it. You do not have to become a member to have your listing
          taken down.
        </p>
      </>
    ),
  },
  {
    id: "member-obligations",
    heading: "If you hold a listing: your obligations",
    body: (
      <>
        <p>By holding a listing you confirm, for as long as it is published, that:</p>
        <ul>
          <li>
            you are registered with your regulator and entitled to practise, and you will tell us promptly if that
            changes — including any conditions, undertakings, suspension or removal;
          </li>
          <li>you hold appropriate professional indemnity cover;</li>
          <li>
            everything on your profile is accurate, current and yours to publish — qualifications, titles,
            specialties, prices, locations, photographs and video;
          </li>
          <li>
            your profile complies with the advertising rules that apply to you, including the CAP Code and your
            regulator&apos;s guidance on advertising and on claims about treatment;
          </li>
          <li>
            you have written consent for any patient image, testimonial or case study you upload, and you will not
            publish anything that identifies a patient without it;
          </li>
          <li>
            you will handle any personal data you receive through the site — enquiries above all — in line with UK data
            protection law, as the controller of it.
          </li>
        </ul>
        <p>
          You are responsible for everything published on your profile and for everyone you allow to access your
          account. Keep your password to yourself and tell us at once if you think someone else has used it.
        </p>
      </>
    ),
  },
  {
    id: "membership-and-billing",
    heading: "Membership, billing and cancellation",
    body: (
      <>
        <p>
          Listings are offered on membership plans. What each plan includes, and what it costs, is set out on our{" "}
          <Link to="/pricing">pricing page</Link>, which forms part of these terms. Prices are in pounds sterling and,
          where VAT applies, it is shown at checkout.
        </p>
        <p>
          A paid plan begins when your first payment is taken and your listing is approved, and it renews automatically
          for further periods of the same length until you cancel. You can cancel at any time from your dashboard or by
          emailing <MailLink />: your plan then runs to the end of the period you have already paid for and does not
          renew. We do not refund part-used periods except where the law requires it or where we have not delivered what
          you paid for.
        </p>
        <p>
          If a payment fails we may retry it, and we may suspend the paid features of your listing until it is settled.
          We will always tell you before that happens.
        </p>
        <p>
          We may change our prices. An increase never applies to a period you have already paid for, and we will give
          you at least 30 days&apos; notice before it affects a renewal, so that you can cancel first.
        </p>
        <p>
          Memberships are sold to professionals and organisations for business purposes. If you are contracting as a
          consumer, you may have a right to cancel within 14 days of purchase under the Consumer Contracts Regulations
          2013; where you have asked us to publish your listing immediately, that right may be lost once the service has
          been fully performed.
        </p>
      </>
    ),
  },
  {
    id: "your-content",
    heading: "Content you give us",
    body: (
      <>
        <p>
          You keep ownership of everything you upload — text, photographs, logos, video. By uploading it you give us a
          non-exclusive, worldwide, royalty-free licence to host, store, reproduce and display it for the purpose of
          operating and promoting the site and your listing on it. That licence ends when the content is removed, except
          for copies kept in backups or where we must keep a record by law.
        </p>
        <p>
          You confirm that you own the content or have permission to use it, and that publishing it here breaks nobody
          else&apos;s rights. We may remove content that we reasonably believe breaches these terms, infringes somebody
          else&apos;s rights, or is unlawful — and we will tell you why.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    heading: "Acceptable use",
    body: (
      <>
        <p>You must not:</p>
        <ul>
          <li>
            copy, scrape or systematically extract listings or any other part of the directory, by hand or by software,
            or use it to build or populate a competing database;
          </li>
          <li>use contact details from the site to send unsolicited marketing;</li>
          <li>impersonate anyone, or misrepresent your qualifications, registration or affiliation;</li>
          <li>
            interfere with the site&apos;s operation or security, attempt to gain access to any account or system you
            are not entitled to, or introduce anything malicious;
          </li>
          <li>use the site for anything unlawful, or in any way that could damage or overburden it.</li>
        </ul>
        <p>
          We monitor for misuse. Where we find it we may restrict or close the account concerned and, where it is
          serious, report it to the relevant authority.
        </p>
      </>
    ),
  },
  {
    id: "our-content",
    heading: "Our intellectual property",
    body: (
      <p>
        The site, its design, its software and its content — other than content supplied by members — belong to us or
        our licensors and are protected by copyright and other rights. Our name and logo are our trade marks. You may
        view and print pages for your own use, and link to the site fairly and without suggesting an endorsement we have
        not given, but you may not otherwise reproduce or exploit any part of it without our written permission.
      </p>
    ),
  },
  {
    id: "availability",
    heading: "Availability and changes to the site",
    body: (
      <p>
        We work to keep the site available, but we do not guarantee that it will be uninterrupted or error-free. We may
        change, withdraw or suspend any part of it, including features on a membership plan, and we will give notice
        where a change materially affects what a paying member receives. Access may be unavailable during maintenance or
        for reasons outside our control.
      </p>
    ),
  },
  {
    id: "suspension",
    heading: "Suspension and termination",
    body: (
      <>
        <p>We may suspend or remove a listing, or close an account, where:</p>
        <ul>
          <li>a registration cannot be verified, has lapsed, or is subject to conditions, suspension or removal;</li>
          <li>these terms are broken, or the content of a listing is misleading or unlawful;</li>
          <li>payment is not made;</li>
          <li>we are required to by a regulator, a court or the law.</li>
        </ul>
        <p>
          Except where the problem is urgent or the law requires otherwise, we will tell you what is wrong and give you
          a reasonable chance to put it right first. Where we remove a paid listing for a reason that is not your fault,
          we refund the unused part of the period.
        </p>
        <p>
          You may close your account at any time. We keep the records the law requires us to keep — see the{" "}
          <Link to="/privacy#security-retention">privacy notice</Link>.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    heading: "Our liability",
    body: (
      <>
        <p>
          Nothing in these terms limits our liability for death or personal injury caused by our negligence, for fraud
          or fraudulent misrepresentation, or for anything else that cannot lawfully be limited.
        </p>
        <p>
          Subject to that: information on a listing comes from the member who supplied it or from public sources, and
          while we check registration, we do not independently verify every claim on every profile. We are not
          responsible for the care you receive, for any decision you take about treatment, or for any dealings between a
          patient and a professional.
        </p>
        <p>
          <strong>If you are a consumer:</strong> we are responsible for loss you suffer that is a foreseeable result of
          our breaking these terms or failing to use reasonable care and skill, but not for anything unforeseeable. We
          provide the site for domestic and private use; we have no liability for business loss.
        </p>
        <p>
          <strong>If you are a business user:</strong> we exclude all implied warranties to the extent the law allows;
          we are not liable for loss of profit, business, goodwill, anticipated savings, data, or any indirect or
          consequential loss; and our total liability arising from your use of the site in any twelve-month period is
          limited to the membership fees you paid us in that period, or £100 if you have paid us nothing.
        </p>
      </>
    ),
  },
  {
    id: "indemnity",
    heading: "Indemnity",
    body: (
      <p>
        If you use the site in the course of a business, you agree to cover us against any claim, loss or cost we suffer
        arising from content you have published on the site, from your breach of these terms, or from any care you have
        provided to a patient who found you through it.
      </p>
    ),
  },
  {
    id: "concerns",
    heading: "Complaints and concerns about a professional",
    body: (
      <>
        <p>
          If you have a concern about a listing — an inaccuracy, a misleading claim, or a professional whose
          registration you believe has changed — email <MailLink /> with the listing and what you have seen. We
          investigate and will take a listing down while we do so where patient safety may be at stake.
        </p>
        <p>
          Concerns about clinical care belong with the provider&apos;s own complaints process and with their regulator,
          who can investigate in a way that we cannot. We will tell you who that regulator is if you are not sure.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    heading: "Changes to these terms",
    body: (
      <p>
        We may amend these terms. The date at the top of this page shows when the current version took effect. Where a
        change materially affects members, we will give reasonable notice by email or on the site before it applies, and
        a member who does not accept the change may cancel.
      </p>
    ),
  },
  {
    id: "law",
    heading: "Governing law",
    body: (
      <p>
        These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive
        jurisdiction — except that if you are a consumer resident elsewhere in the United Kingdom, you may also bring
        proceedings in the courts of the country you live in.
      </p>
    ),
  },
  {
    id: "contact",
    heading: "How to contact us",
    body: (
      <>
        <p>
          Email <MailLink />, call {CONTACT_DETAILS.phone}, or write to {CONTACT_DETAILS.legalName},{" "}
          {CONTACT_DETAILS.address.join(", ")}.
        </p>
        <p>
          You can also use the form on our <Link to="/contact">contact page</Link>. We aim to answer within two working
          days.
        </p>
      </>
    ),
  },
];

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Use"
      kicker="The rules"
      summary="What you can expect from Top Local Specialists, what we expect from you, and where responsibility sits between a directory, a professional and a patient."
      updated={UPDATED}
      description="The terms governing use of Top Local Specialists — for patients searching the directory and for professionals holding a listing on it."
      path="/terms"
      sections={SECTIONS}
    />
  );
}
