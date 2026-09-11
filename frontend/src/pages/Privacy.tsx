import { LegalPage } from "../components/LegalPage";
import type { LegalSection } from "../components/LegalPage";
import { CONTACT_DETAILS } from "./Contact";

/* ------------------------------------------------------------------ *
 * Privacy notice
 *
 * The wording is the client's own, set as supplied. Three things were
 * corrected because they named a different company: the site address
 * (it read kneeclinics.co.uk), the marketing opt-out address (it read
 * admin@bromsgroveprivateclinic.com) and the two unresolved
 * "[COOKIE POLICY]" placeholders, which now point at the cookies
 * section further down this page.
 *
 * Contact details come from one place — CONTACT_DETAILS — so the
 * address on this page can never drift from the one in the footer or on
 * the contact page. A privacy notice with a stale address is a notice
 * nobody can act on.
 * ------------------------------------------------------------------ */

const EMAIL = CONTACT_DETAILS.email;

/** The date this version of the notice took effect. */
const UPDATED = "2026-09-11";

function MailLink() {
  return <a href={`mailto:${EMAIL}`}>{EMAIL}</a>;
}

const SECTIONS: LegalSection[] = [
  {
    id: "who-we-are",
    heading: "Introduction and contact details",
    body: (
      <>
        <p>
          This privacy notice provides you with details of how we collect and process your personal data through your
          use of our site <strong>www.toplocalspecialists.com</strong>. By providing us with your data, you warrant to
          us that you are over 13 years of age.
        </p>
        <p>
          TopLocalSpecialists.com is the data controller and we are responsible for your personal data (referred to as
          “we”, “us” or “our” in this privacy notice).
        </p>
        <h3>Our full contact details</h3>
        <ul>
          <li>
            <strong>Legal entity:</strong> {CONTACT_DETAILS.legalName}
          </li>
          <li>
            <strong>Email:</strong> <MailLink />
          </li>
          <li>
            <strong>Postal address:</strong> {CONTACT_DETAILS.address.join(", ")}
          </li>
          <li>
            <strong>Telephone:</strong> {CONTACT_DETAILS.phone}
          </li>
        </ul>
        <p>
          It is very important that the information we hold about you is accurate and up to date. Please let us know if
          at any time your personal information changes by emailing us at <MailLink />.
        </p>
      </>
    ),
  },
  {
    id: "data-we-collect",
    heading: "Data we collect, purpose and lawful ground",
    body: (
      <>
        <p>We may process the following categories of personal data about you:</p>
        <dl>
          <div>
            <dt>Communication Data</dt>
            <dd>
              Includes any communication you send to us (contact form, email, text, social media).{" "}
              <strong>Purpose:</strong> communication, record keeping and legal claims. <strong>Ground:</strong>{" "}
              legitimate interests.
            </dd>
          </div>
          <div>
            <dt>Customer Data</dt>
            <dd>
              Relates to purchases (name, address, email, phone, card details). <strong>Purpose:</strong> to supply
              goods and services and keep records. <strong>Ground:</strong> performance of a contract.
            </dd>
          </div>
          <div>
            <dt>User Data</dt>
            <dd>
              Data about how you use our website and online services. <strong>Purpose:</strong> website operation,
              security, backups and administration. <strong>Ground:</strong> legitimate interests.
            </dd>
          </div>
          <div>
            <dt>Technical Data</dt>
            <dd>
              Includes IP address, login data, browser details and page views (from an analytics tracking system).{" "}
              <strong>Purpose:</strong> website analysis, business protection, delivering content and measuring
              advertising effectiveness. <strong>Ground:</strong> legitimate interests (to administer our business and
              decide our marketing strategy).
            </dd>
          </div>
          <div>
            <dt>Marketing Data</dt>
            <dd>
              Your preferences in receiving marketing. <strong>Purpose:</strong> promotions, delivering relevant content
              and advertising, and measuring effectiveness. <strong>Ground:</strong> legitimate interests (to grow our
              business).
            </dd>
          </div>
        </dl>
        <p>
          We may use Customer, User, Technical and Marketing Data to deliver relevant website content and advertisements
          to you and to measure their effectiveness. We may also use such data to send other marketing communications
          based on <strong>consent or legitimate interests</strong> (to grow our business).
        </p>
      </>
    ),
  },
  {
    id: "sensitive-data",
    heading: "Sensitive data",
    body: (
      <p>
        We <strong>do not collect</strong> sensitive data such as race, ethnicity, religious or philosophical beliefs,
        sex life, sexual orientation, political opinions or trade union membership. We <strong>do collect</strong> data
        and information about your <strong>health and biometric data</strong>. We do not collect any information about
        criminal convictions and offences.
      </p>
    ),
  },
  {
    id: "how-we-collect",
    heading: "How we collect data",
    body: (
      <>
        <p>We collect data by:</p>
        <ul>
          <li>
            You providing it <strong>directly to us</strong> (forms, emails).
          </li>
          <li>
            We <strong>automatically collect</strong> certain data as you use our website by using cookies and similar
            technologies — see <a href="#cookies">cookies</a> below.
          </li>
          <li>
            We may receive data from <strong>third parties</strong> such as Google Analytics, advertising networks
            (Facebook), search information providers (Google), technical, payment and delivery service providers, data
            brokers or aggregators.
          </li>
          <li>
            We may also receive data from <strong>publicly available sources</strong> such as Companies House and the
            Electoral Register based inside the EU.
          </li>
        </ul>
        <p>
          We will only use your personal data for the purpose it was collected for, or a reasonably compatible purpose.
          We do not carry out automated decision making or any type of automated profiling.
        </p>
      </>
    ),
  },
  {
    id: "marketing",
    heading: "Marketing communications",
    body: (
      <>
        <p>
          Our lawful ground for processing your personal data for marketing is either your <strong>consent</strong> or
          our <strong>legitimate interests</strong> (to grow our business).
        </p>
        <p>
          You can ask us or third parties to stop sending you marketing messages at any time by following the opt-out
          links on any marketing message sent to you, or by emailing us at <MailLink /> at any time.
        </p>
      </>
    ),
  },
  {
    id: "disclosures",
    heading: "Disclosures of your personal data",
    body: (
      <>
        <p>We may share your personal data with:</p>
        <ul>
          <li>Other companies in our group (TopLocalSpecialists.com).</li>
          <li>Other hospitals where your treatment is being undertaken.</li>
          <li>Service providers (IT, system administration).</li>
          <li>Professional advisers (health professionals, lawyers, bankers, auditors, insurers).</li>
          <li>Government bodies that require reporting.</li>
          <li>Any other third parties (market researchers, fraud prevention agencies, price comparison sites).</li>
          <li>Third parties to whom we sell, transfer or merge parts of our business or assets.</li>
        </ul>
        <p>We require all third parties to respect the security and confidentiality of your data.</p>
      </>
    ),
  },
  {
    id: "international-transfers",
    heading: "International transfers",
    body: (
      <>
        <p>
          Many of our third-party service providers are based outside the European Economic Area (EEA), which involves a
          transfer of data outside the EEA. We ensure a similar degree of data security by implementing safeguards, such
          as:
        </p>
        <ul>
          <li>
            Transferring only to countries approved by the European Commission as providing an adequate level of
            protection.
          </li>
          <li>
            Using specific contracts, codes of conduct or certification mechanisms approved by the European Commission.
          </li>
          <li>If using US-based providers, ensuring they are part of the EU-US Privacy Shield.</li>
        </ul>
        <p>
          If none of the above safeguards is available, we may request your explicit consent to the specific transfer.
        </p>
      </>
    ),
  },
  {
    id: "security-retention",
    heading: "Data security and retention",
    body: (
      <>
        <p>
          We have security measures in place to prevent your personal data from being accidentally lost, used, altered,
          disclosed or accessed without authorisation. Access is limited to those employees and partners who have a
          business need to know.
        </p>
        <p>
          We will only retain your personal data for as long as necessary. For <strong>tax purposes</strong>, the law
          requires us to keep basic information for <strong>six years</strong>. For <strong>healthcare purposes</strong>
          , the law requires us to keep basic information and medical records for at least <strong>10 years</strong>{" "}
          after you stop being a customer.
        </p>
      </>
    ),
  },
  {
    id: "your-rights",
    heading: "Your legal rights",
    body: (
      <>
        <p>
          Under data protection laws, you have rights in relation to your personal data that include the right to
          request access, correction, erasure, restriction, transfer, to object to processing, to portability of data
          and — where consent is the lawful ground — to withdraw consent.
        </p>
        <p>
          You can see more about these rights at the{" "}
          <a
            href="https://ico.org.uk/for-organisations/guide-to-the-general-data-protection-regulation-gdpr/individual-rights/"
            target="_blank"
            rel="noreferrer"
          >
            ICO individual rights guide
          </a>
          .
        </p>
        <p>
          If you wish to exercise any of these rights, please email us at <MailLink />. We try to respond to all
          legitimate requests within <strong>one month</strong>.
        </p>
      </>
    ),
  },
  {
    id: "complaints",
    heading: "Complaints",
    body: (
      <p>
        If you are not happy with any aspect of how we collect and use your data, you have the right to complain to the
        Information Commissioner&apos;s Office (ICO),{" "}
        <a href="https://www.ico.org.uk" target="_blank" rel="noreferrer">
          www.ico.org.uk
        </a>
        . We would be grateful if you would contact us first so we can try to resolve it for you.
      </p>
    ),
  },
  {
    id: "third-party-links",
    heading: "Third-party links",
    body: (
      <p>
        This website may include links to third-party websites, plug-ins and applications. We do not control these
        third-party websites and are not responsible for their privacy statements. When you leave our website, we
        encourage you to read the privacy notice of every website you visit.
      </p>
    ),
  },
  {
    id: "cookies",
    heading: "Cookies",
    body: (
      <>
        <p>
          We use cookies and similar technologies. You can set your browser to refuse all or some browser cookies, or to
          alert you when websites set or access cookies. If you disable or refuse cookies, please note that some parts
          of this website may become inaccessible or stop working properly.
        </p>
        <p>
          Some storage is essential and cannot be switched off: when you sign in to a specialist or administrator
          account, we store a sign-in token in your browser so that you stay signed in between pages. Without it, the
          account area cannot work.
        </p>
        <p>
          If you would like a full list of the cookies and similar technologies in use, email <MailLink /> and we will
          provide one.
        </p>
      </>
    ),
  },
  {
    id: "children",
    heading: "Children’s privacy (COPPA)",
    body: (
      <p>
        We are in compliance with the requirements of the Children&apos;s Online Privacy Protection Act (COPPA). We{" "}
        <strong>do not collect any information from anyone under 13 years of age</strong>. Our website, products and
        services are all directed to people who are at least 13 years old or older.
      </p>
    ),
  },
  {
    id: "remarketing",
    heading: "Remarketing and third-party services",
    body: (
      <p>
        We may use third-party vendor remarketing tracking cookies (including Google Ads and Facebook) to serve ads
        based on past visits to our website. Any user information submitted to us through a Facebook Lead Ad will be
        governed by this privacy policy. We specifically will ensure that no Facebook Lead Ads are targeted to anyone
        below 18 years of age.
      </p>
    ),
  },
  {
    id: "changes",
    heading: "Changes to this notice",
    body: (
      <p>
        We may update this privacy notice from time to time. The date at the top of this page tells you when it was last
        revised. Where a change materially affects how we use your personal data, we will take reasonable steps to tell
        you about it — for example by email, or by a notice on this website.
      </p>
    ),
  },
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Notice"
      kicker="Your data"
      summary="How Top Local Specialists collects and uses personal data, what we do with it, who we share it with, and the rights you have over it."
      updated={UPDATED}
      description="How Top Local Specialists collects, uses, shares and retains personal data, and how to exercise your rights under UK data protection law."
      path="/privacy"
      sections={SECTIONS}
    />
  );
}
