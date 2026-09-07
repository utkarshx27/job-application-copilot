import { useEffect, useState, type ChangeEvent } from "react";
import { emptyCareerPreferences, type CareerPreferences } from "@copilot/candidate-schema";
import {
  CareerSetupDraftSchema,
  ProfileVaultSchema,
  careerReadiness,
  profileToDraft,
  type ProfileVault,
} from "@copilot/profile-core";
import { readResumeFile } from "../resume-file";
import { sendPanelRequest, type Notice } from "./panel-shared";

const listKeys = [
  "targetRoles",
  "targetLocations",
  "excludedCompanies",
  "excludedKeywords",
] as const;
const listLabels = {
  targetRoles: "Target roles",
  targetLocations: "Preferred locations",
  excludedCompanies: "Companies to exclude",
  excludedKeywords: "Job keywords to exclude",
};
const split = (text: string) => [
  ...new Set(
    text
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
type MoneyInput = { amount: string; currency: string; period: "HOUR" | "MONTH" | "YEAR" };
const moneyInput = (value: CareerPreferences["currentCompensation"]): MoneyInput => ({
  amount: value ? String(value.amount) : "",
  currency: value?.currency ?? "INR",
  period: value?.period ?? "YEAR",
});

function MoneyFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: MoneyInput;
  onChange: (value: MoneyInput) => void;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <p className="help">Leave the amount blank if unknown or you prefer not to share it.</p>
      <label>
        {title} amount
        <input
          type="number"
          min="0"
          max="1000000000"
          step="any"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
        />
      </label>
      <div className="two-column">
        <label>
          {title} currency
          <input
            maxLength={3}
            pattern="[A-Z]{3}"
            value={value.currency}
            onChange={(e) => onChange({ ...value, currency: e.target.value.toUpperCase() })}
          />
        </label>
        <label>
          {title} period
          <select
            value={value.period}
            onChange={(e) => onChange({ ...value, period: e.target.value as MoneyInput["period"] })}
          >
            <option value="YEAR">Per year</option>
            <option value="MONTH">Per month</option>
            <option value="HOUR">Per hour</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}

function importedFacts(value: unknown, path = ""): { label: string; value: string }[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (record.status === "VERIFIED_DOCUMENT")
    return [
      {
        label: path.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll(".", " "),
        value: typeof record.value === "string" ? record.value : JSON.stringify(record.value),
      },
    ];
  return Object.entries(record).flatMap(([key, child]) =>
    importedFacts(child, path ? `${path}.${key}` : key),
  );
}

export function Onboarding({
  vault,
  onVault,
  onAdvanced,
  onReady,
}: {
  vault: ProfileVault;
  onVault: (vault: ProfileVault) => void;
  onAdvanced: () => void;
  onReady: () => void;
}) {
  const profile = vault.currentProfile;
  const initial = profile.careerSetup?.preferences ?? emptyCareerPreferences();
  const [contact, setContact] = useState(() => profileToDraft(profile));
  const [preferences, setPreferences] = useState(initial);
  const [lists, setLists] = useState(
    () =>
      Object.fromEntries(listKeys.map((key) => [key, initial[key].join(", ")])) as Record<
        (typeof listKeys)[number],
        string
      >,
  );
  const [currentPay, setCurrentPay] = useState(() => moneyInput(initial.currentCompensation));
  const [expectedPay, setExpectedPay] = useState(() => moneyInput(initial.expectedCompensation));
  const [notes, setNotes] = useState(profile.careerSetup?.backgroundNotes ?? "");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const readiness = careerReadiness(vault);
  const facts = importedFacts(profile);
  useEffect(() => {
    setContact(profileToDraft(vault.currentProfile));
    setReviewed(false);
  }, [vault]);

  async function update(request: unknown, message: string) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendPanelRequest(request);
      if (!result.ok) throw new Error(result.error.message);
      onVault(ProfileVaultSchema.parse(result.data));
      setNotice({ kind: "success", message });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save your changes.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setNotice(null);
    try {
      const parsed = await readResumeFile(file);
      await update(
        { type: "PANEL_PROFILE_IMPORT_RESUME", ...parsed },
        "Résumé imported. Review the extracted details below.",
      );
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not read this résumé.",
      });
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    try {
      const pay = (input: MoneyInput) =>
        input.amount === "" ? null : { ...input, amount: Number(input.amount) };
      const draft = CareerSetupDraftSchema.parse({
        expectedProfileVersion: profile.profileVersion,
        identity: contact.identity,
        email: contact.email.trim(),
        phone: contact.phone.trim(),
        preferences: {
          ...preferences,
          ...Object.fromEntries(listKeys.map((key) => [key, split(lists[key])])),
          currentCompensation: pay(currentPay),
          expectedCompensation: pay(expectedPay),
        },
        backgroundNotes: notes,
        reviewed,
      });
      await update(
        { type: "PANEL_PROFILE_SETUP_SAVE", draft },
        "Your reviewed setup is saved. Check the readiness summary for anything still needed.",
      );
    } catch {
      setNotice({
        kind: "error",
        message:
          "Check your name, email, international phone format, currency codes, and numeric values. Confirm that you reviewed this setup.",
      });
    }
  }
  return (
    <section className="onboarding" aria-labelledby="setup-title">
      <h2 id="setup-title">Set up your job search</h2>
      <p>Import your résumé, review your details, and tell us what you want next.</p>
      <button type="button" className="secondary" onClick={onAdvanced}>
        Edit full profile
      </button>
      {notice && (
        <p className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      )}
      <form
        onChange={(event) => {
          if (!(event.target instanceof HTMLInputElement) || event.target.name !== "setup-reviewed")
            setReviewed(false);
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <legend>1. Your background</legend>
          <label className="file-button">
            Import résumé (PDF or DOCX)
            <input type="file" accept=".pdf,.docx" onChange={(e) => void importFile(e)} />
          </label>
          <p className="help">
            Files are read locally. You review extracted details before they can be used.
          </p>
          <label>
            Background notes
            <textarea
              rows={4}
              maxLength={20000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe your background, interests, and goals. Optional labelled lines: Name: …, Email: …, Phone: +…"
            />
          </label>
          <p className="help">
            Notes are context. Only labelled contact details can be suggested here; goals do not
            become experience claims.
          </p>
          <button
            type="button"
            disabled={!notes.trim() || facts.length > 0 || vault.conflicts.length > 0}
            onClick={() =>
              void update(
                {
                  type: "PANEL_PROFILE_IMPORT_NARRATIVE",
                  text: notes,
                  expectedProfileVersion: profile.profileVersion,
                },
                "Labelled details imported for review. Your remaining notes stay as context when you save setup.",
              )
            }
          >
            Suggest contact details from notes
          </button>
        </fieldset>
        {vault.conflicts.length > 0 && (
          <div role="alert" className="notice error">
            Some imported details conflict with your profile. Open Edit full profile to compare and
            resolve them.
          </div>
        )}
        {facts.length > 0 && (
          <section className="import-card" aria-label="Review extracted details">
            <h3>Review extracted details</h3>
            <dl>
              {facts.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
            <p>Use Edit full profile to correct any extracted detail before confirming it.</p>
            <button
              type="button"
              disabled={busy || vault.conflicts.length > 0}
              onClick={() =>
                void update(
                  { type: "PANEL_PROFILE_VERIFY_IMPORTED" },
                  "Extracted details reviewed and saved.",
                )
              }
            >
              I reviewed these extracted details
            </button>
          </section>
        )}
        <fieldset disabled={busy}>
          <legend>2. Check your contact details</legend>
          <label>
            Full legal name
            <input
              required
              value={contact.identity.full}
              onChange={(e) => {
                setContact({ ...contact, identity: { ...contact.identity, full: e.target.value } });
                setReviewed(false);
              }}
            />
          </label>
          <div className="two-column">
            <label>
              Given name
              <input
                required
                value={contact.identity.given}
                onChange={(e) =>
                  setContact({
                    ...contact,
                    identity: { ...contact.identity, given: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Family name (optional)
              <input
                value={contact.identity.family}
                onChange={(e) =>
                  setContact({
                    ...contact,
                    identity: { ...contact.identity, family: e.target.value },
                  })
                }
              />
            </label>
          </div>
          <label>
            Email
            <input
              type="email"
              required
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
            />
          </label>
          <label>
            Phone (optional, with country code)
            <input
              type="tel"
              pattern="\+[1-9][0-9]{6,14}"
              placeholder="+919876543210"
              value={contact.phone}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })}
            />
          </label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>3. Your next role</legend>
          {listKeys.slice(0, 2).map((key) => (
            <label key={key}>
              {listLabels[key]}
              <input
                value={lists[key]}
                onChange={(e) => setLists({ ...lists, [key]: e.target.value })}
                placeholder="Separate entries with commas"
              />
            </label>
          ))}
          <div role="group" aria-label="Work arrangements">
            {(["REMOTE", "HYBRID", "ONSITE"] as const).map((choice) => (
              <label className="check" key={choice}>
                <input
                  type="checkbox"
                  checked={preferences.workArrangements.includes(choice)}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      workArrangements: e.target.checked
                        ? [...preferences.workArrangements, choice]
                        : preferences.workArrangements.filter((item) => item !== choice),
                    })
                  }
                />
                {{ REMOTE: "Remote", HYBRID: "Hybrid", ONSITE: "On-site" }[choice]}
              </label>
            ))}
          </div>
          <label>
            Current location
            <input
              value={preferences.currentLocation}
              onChange={(e) => setPreferences({ ...preferences, currentLocation: e.target.value })}
            />
          </label>
          <div className="two-column">
            <label>
              Total experience (months, optional)
              <input
                type="number"
                min="0"
                max="960"
                step="1"
                value={preferences.totalExperienceMonths ?? ""}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    totalExperienceMonths: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Notice period (days, optional)
              <input
                type="number"
                min="0"
                max="730"
                step="1"
                value={preferences.noticePeriodDays ?? ""}
                onChange={(e) =>
                  setPreferences({
                    ...preferences,
                    noticePeriodDays: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <details>
            <summary>Compensation and exclusions (optional)</summary>
            <MoneyFields title="Current compensation" value={currentPay} onChange={setCurrentPay} />
            <MoneyFields
              title="Expected compensation"
              value={expectedPay}
              onChange={setExpectedPay}
            />
            {listKeys.slice(2).map((key) => (
              <label key={key}>
                {listLabels[key]}
                <input
                  value={lists[key]}
                  onChange={(e) => setLists({ ...lists, [key]: e.target.value })}
                />
              </label>
            ))}
          </details>
          <label className="check">
            <input
              type="checkbox"
              name="setup-reviewed"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed my contact details and job preferences
          </label>
          <button className="primary" disabled={!reviewed || vault.conflicts.length > 0}>
            Save my setup
          </button>
        </fieldset>
      </form>
      <section className="readiness" aria-label="Setup readiness">
        <h3>{readiness.ready ? "Your setup is ready" : "Still needed for your setup"}</h3>
        {readiness.missing.length > 0 && (
          <ul>
            {readiness.missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <p>Each application may still ask for additional answers or documents.</p>
        {readiness.ready && (
          <button type="button" className="primary" onClick={onReady}>
            Review an application form
          </button>
        )}
      </section>
    </section>
  );
}
