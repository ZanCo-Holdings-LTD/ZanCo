import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_LADDER,
  acknowledgementRate,
  addDays,
  addMonths,
  classify,
  daysBetween,
  decideDispatch,
  degradeChannels,
  detectChange,
  isPlainDate,
  planAlerts,
  underActiveMonitoring,
  widenAudience,
  type AlertRecord,
} from "../src/index";

/**
 * The compliance logic tests.
 *
 * These cover the arithmetic the whole product rests on. A bug here is a missed
 * renewal, so the cases are chosen for the ways dates actually go wrong: month
 * ends, leap years, the boundary between "due soon" and "critical", and the
 * exact day an alert fires.
 */

describe("dates", () => {
  it("adds days across a month boundary", () => {
    assert.equal(addDays("2026-01-30", 3), "2026-02-02");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });

  it("handles leap years", () => {
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2026-02-28", 1), "2026-03-01");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  });

  it("clamps month arithmetic to the last valid day", () => {
    // A licence issued on 31 January and valid a month expires 28 February,
    // not 3 March.
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addMonths("2026-08-31", 1), "2026-09-30");
    assert.equal(addMonths("2026-01-15", 12), "2027-01-15");
  });

  it("counts whole days, signed", () => {
    assert.equal(daysBetween("2026-01-01", "2026-01-31"), 30);
    assert.equal(daysBetween("2026-01-31", "2026-01-01"), -30);
    assert.equal(daysBetween("2026-01-01", "2026-01-01"), 0);
  });

  it("rejects dates that do not exist", () => {
    assert.equal(isPlainDate("2026-02-30"), false);
    assert.equal(isPlainDate("2026-13-01"), false);
    assert.equal(isPlainDate("2026-02-28"), true);
  });
});

describe("classify", () => {
  const asOf = "2026-07-01";

  it("places records in the right band", () => {
    assert.equal(classify({ id: "a", expiresOn: "2026-12-01" }, asOf), "valid");
    assert.equal(classify({ id: "b", expiresOn: "2026-09-01" }, asOf), "due_soon");
    assert.equal(classify({ id: "c", expiresOn: "2026-07-20" }, asOf), "critical");
    assert.equal(classify({ id: "d", expiresOn: "2026-06-30" }, asOf), "expired");
  });

  it("treats the threshold days as inclusive", () => {
    // Exactly 90 days out is due_soon, exactly 30 days out is critical.
    assert.equal(classify({ id: "a", expiresOn: addDays(asOf, 90) }, asOf), "due_soon");
    assert.equal(classify({ id: "b", expiresOn: addDays(asOf, 91) }, asOf), "valid");
    assert.equal(classify({ id: "c", expiresOn: addDays(asOf, 30) }, asOf), "critical");
    assert.equal(classify({ id: "d", expiresOn: addDays(asOf, 31) }, asOf), "due_soon");
  });

  it("expires on the day after, not the day of", () => {
    assert.equal(classify({ id: "a", expiresOn: asOf }, asOf), "critical");
    assert.equal(classify({ id: "b", expiresOn: addDays(asOf, -1) }, asOf), "expired");
  });

  it("treats no-expiry and archived records as dormant", () => {
    assert.equal(classify({ id: "a", expiresOn: null }, asOf), "dormant");
    assert.equal(classify({ id: "b", expiresOn: "2026-01-01", active: false }, asOf), "dormant");
  });
});

describe("detectChange", () => {
  it("reports an escalation when a record worsens", () => {
    const change = detectChange({ id: "a", expiresOn: "2026-07-20" }, "valid", "2026-07-01");
    assert.equal(change?.to, "critical");
    assert.equal(change?.escalated, true);
  });

  it("reports a de-escalation after a renewal", () => {
    const change = detectChange({ id: "a", expiresOn: "2027-07-20" }, "expired", "2026-07-01");
    assert.equal(change?.to, "valid");
    assert.equal(change?.escalated, false);
  });

  it("returns null when nothing changed", () => {
    assert.equal(detectChange({ id: "a", expiresOn: "2026-12-01" }, "valid", "2026-07-01"), null);
  });
});

describe("planAlerts", () => {
  it("schedules the full ladder relative to expiry", () => {
    const planned = planAlerts({ id: "a", expiresOn: "2026-12-31" });
    assert.equal(planned.length, DEFAULT_LADDER.length);

    const ninety = planned.find((alert) => alert.offsetDays === 90);
    assert.equal(ninety?.dueOn, "2026-10-02");

    const one = planned.find((alert) => alert.offsetDays === 1);
    assert.equal(one?.dueOn, "2026-12-30");

    // Negative offsets fire after expiry.
    const overdue = planned.find((alert) => alert.offsetDays === -7);
    assert.equal(overdue?.dueOn, "2027-01-07");
  });

  it("is idempotent — planning twice gives identical rows", () => {
    const first = planAlerts({ id: "a", expiresOn: "2026-12-31" });
    const second = planAlerts({ id: "a", expiresOn: "2026-12-31" });
    assert.deepEqual(first, second);
  });

  it("plans nothing for a record with no expiry", () => {
    assert.deepEqual(planAlerts({ id: "a", expiresOn: null }), []);
    assert.deepEqual(planAlerts({ id: "a", expiresOn: "2026-12-31", active: false }), []);
  });

  it("collapses lapsed rungs into one catch-up alert", () => {
    // A record added 10 days before expiry must not fire six historical alerts;
    // it announces itself once, today.
    const planned = planAlerts(
      { id: "a", expiresOn: "2026-07-11" },
      { catchUpFrom: "2026-07-01" },
    );
    const dueToday = planned.filter((alert) => alert.dueOn === "2026-07-01");
    assert.equal(dueToday.length, 1);
    // The 90, 60, 30 and 14-day rungs have all lapsed; only the latest of them
    // is kept, so the record announces itself once.
    assert.equal(dueToday[0].offsetDays, 14);
    assert.ok(planned.every((alert) => alert.dueOn >= "2026-07-01"));
  });

  it("degrades channels the tier does not include", () => {
    const planned = planAlerts(
      { id: "a", expiresOn: "2026-12-31" },
      { allowedChannels: ["in_app", "email"] },
    );
    assert.ok(planned.every((alert) => !alert.channels.includes("whatsapp")));
    // And never leaves a rung with no channel at all.
    assert.ok(planned.every((alert) => alert.channels.length > 0));
  });
});

describe("degradeChannels", () => {
  it("keeps the intersection when there is one", () => {
    assert.deepEqual(degradeChannels(["email", "whatsapp"], ["in_app", "email"]), ["email"]);
  });

  it("falls back to email rather than going silent", () => {
    assert.deepEqual(degradeChannels(["whatsapp"], ["in_app", "email"]), ["email"]);
  });

  it("falls back to in-app when email is unavailable too", () => {
    assert.deepEqual(degradeChannels(["whatsapp"], ["in_app"]), ["in_app"]);
  });
});

describe("decideDispatch", () => {
  const base: AlertRecord = {
    targetId: "a",
    offsetDays: 30,
    dueOn: "2026-07-01",
    channels: ["email"],
    audience: ["owner"],
    escalateIfUnacknowledged: true,
    sentAt: null,
    acknowledgedAt: null,
  };

  it("sends a due, unsent alert", () => {
    assert.equal(decideDispatch(base, { asOf: "2026-07-01" }).action, "send");
  });

  it("holds an alert that is not due yet", () => {
    const decision = decideDispatch(base, { asOf: "2026-06-30" });
    assert.equal(decision.action, "skip");
    assert.equal(decision.reason, "not_yet_due");
  });

  it("never re-sends an acknowledged alert", () => {
    const decision = decideDispatch(
      { ...base, sentAt: new Date("2026-07-01"), acknowledgedAt: new Date("2026-07-02") },
      { asOf: "2026-07-10" },
    );
    assert.equal(decision.action, "skip");
    assert.equal(decision.reason, "acknowledged");
  });

  it("waits out the cooling-off period before escalating", () => {
    const decision = decideDispatch(
      { ...base, sentAt: new Date("2026-07-01T09:00:00Z") },
      { asOf: "2026-07-02" },
    );
    assert.equal(decision.action, "skip");
    assert.equal(decision.reason, "cooling_off");
  });

  it("escalates an unacknowledged alert to a wider audience", () => {
    const decision = decideDispatch(
      { ...base, sentAt: new Date("2026-07-01T09:00:00Z") },
      { asOf: "2026-07-05" },
    );
    assert.equal(decision.action, "escalate");
    assert.ok(decision.audience.includes("managers"));
  });

  it("stops escalating at the cap", () => {
    const decision = decideDispatch(
      { ...base, sentAt: new Date("2026-07-01T09:00:00Z"), escalationCount: 3 },
      { asOf: "2026-07-30" },
    );
    assert.equal(decision.action, "skip");
    assert.equal(decision.reason, "escalation_cap_reached");
  });

  it("does not escalate a rung that is not marked for it", () => {
    const decision = decideDispatch(
      { ...base, escalateIfUnacknowledged: false, sentAt: new Date("2026-07-01T09:00:00Z") },
      { asOf: "2026-07-30" },
    );
    assert.equal(decision.action, "skip");
    assert.equal(decision.reason, "already_sent");
  });
});

describe("widenAudience", () => {
  it("adds managers, then the entity contact", () => {
    assert.deepEqual(widenAudience(["owner"]), ["owner", "managers"]);
    assert.deepEqual(widenAudience(["owner", "managers"]), ["owner", "managers", "entity_contact"]);
  });
});

describe("metrics", () => {
  it("computes the acknowledgement rate over sent alerts only", () => {
    const alerts = [
      { sentAt: new Date(), acknowledgedAt: new Date() },
      { sentAt: new Date(), acknowledgedAt: null },
      { sentAt: null, acknowledgedAt: null }, // scheduled, not counted
    ];
    assert.equal(acknowledgementRate(alerts), 0.5);
    assert.equal(acknowledgementRate([]), 0);
  });

  it("counts only records genuinely under monitoring", () => {
    assert.equal(
      underActiveMonitoring([
        { id: "a", expiresOn: "2026-12-01" },
        { id: "b", expiresOn: null },
        { id: "c", expiresOn: "2026-12-01", active: false },
      ]),
      1,
    );
  });
});
